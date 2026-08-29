// GameLoop.js — rAF loop, state machine, and the simulation.
// Owns all mutable game state. Renders through the injected Renderer.
import { getBezierXY, distToSegment, clamp } from "./MathUtils.js";
import { COMIC_WORDS } from "./Renderer.js";

export const STATE = { PLAYING: "playing", WON: "won", LOST: "lost", PAUSED: "paused" };

// Radius of the cut circle. Sparks die when they travel within this distance
// of a cut point; wick-severing counts use the same value so the "+N" popup
// always matches what actually happens in _update.
const CUT_RADIUS = 15;

export class GameLoop {
    constructor({ canvas, renderer, audio, analytics, platform }) {
        this.canvas = canvas;
        this.renderer = renderer;
        this.audio = audio;
        this.analytics = analytics;
        this.platform = platform;

        // Mutable state.
        this.gameState = STATE.PLAYING;
        this.frameCount = 0;
        this.camera = { x: 0, y: 0, zoom: 1 };
        this.snipsRemaining = 2;
        this.snipsUsed = 0;
        this.nodes = [];
        this.fuses = [];
        this.sparks = [];
        this.cuts = [];
        this.cutFlashes = []; // { x, y, angle, life } — vivid slash burst on snip
        this.particles = [];
        this.fadingSlashes = [];
        this.hintActive = false;
        this.failCount = 0;
        this.ddaTier = 0;
        this.level = null;
        this.levelIndex = 0;
        this.levelMode = "story"; // "story" | "daily" — tags analytics events
        this.attempts = 0;
        this.startedAt = 0;
        this.lastLevelWin = null;
        this.lostAt = null; // frameCount when the bomb detonated (drives the blast FX)
        this.wonAt = null; // frameCount when the level was defused (drives the win text)
        this.comicWord = null; // comic word for the win/lose beat, picked per attempt
        this.tutorialActive = false;
        this.multikills = []; // { x, y, count, at } — one snip severed N wicks (banking popup)
        this._chime = null; // ascending coin-chime queue for multi-cuts

        // Callbacks (wired by main.js).
        this.onSnipsChange = null;
        this.onLevelComplete = null;
        this.onDdaTierChanged = null;
        this.onTutorialStep = null;
        this.onNoSnips = null;

        this._rafId = null;
        this._lastT = 0;
        this._running = false;
    }

    // ---- Level loading ------------------------------------------------------

    loadLevel(level, levelIndex) {
        this.level = level;
        this.levelIndex = levelIndex;
        this.resetLevel();
    }

    resetLevel() {
        this.gameState = STATE.PLAYING;
        this.frameCount = 0;
        this.cuts = [];
        this.cutFlashes = [];
        this.particles = [];
        this.fadingSlashes = [];
        this.snipsUsed = 0;
        this.failCount = 0;
        this.ddaTier = 0;
        this.hintActive = false;
        this.tutorialActive = false;
        this.lostAt = null;
        this.wonAt = null;

        this.snipsRemaining = this.level.snipsAllowed;
        this.nodes = this.level.nodes;
        this.fuses = this.level.fuses;
        this.sparks = this.level.sparks;
        // Out-of-snips feedback: the denied swipe slash + the "NO MORE SNIPS!"
        // popup, and a one-time "LAST SNIP!" heads-up when dropping to 1.
        this.deniedSlash = null; // { start, end, life }
        this.noSnipsAt = null;   // { at, x, y }
        this.lastSnipAt = null;  // frameCount when the final snip warning fired
        // PERFECT SNIP: a cut placed right ahead of a burning spark. Reward for
        // the fast-clear playstyle (each close-cut spends a snip, so the snip
        // economy and the speed race stay in tension).
        this.perfectSnips = 0;
        this.perfectSnipsAt = []; // { x, y, at } — drive the PERFECT! popups
        this.multikills = [];
        this._chime = null;
        // Reset fuse burn + sparks to fresh.
        for (const f of this.fuses) f.burntProgress = 0;
        for (const s of this.sparks) {
            s.progress = 0;
            s.active = true;
            s.ignited = false;
            s.ignitedAt = null; // frameCount when this spark lit (drives reaction words)
            s.diedAt = null;    // frameCount when it was snuffed by a cut
            s.triggered = false; // chained sparks start dark, lit by their parent
        }

        this.camera = this.level.camera
            ? { x: this.level.camera.x, y: this.level.camera.y, zoom: this.level.camera.zoom }
            : this.renderer.computeFitCamera?.(this.level) || { x: 0, y: 0, zoom: 1 };

        this.attempts++;
        this.startedAt = this.frameCount;
        if (this.analytics) {
            this.analytics.track("level_start", {
                level: this.level.level_id,
                attempts: this.attempts,
                mode: this.levelMode,
            });
        }

        if (this.onSnipsChange) this.onSnipsChange(this.snipsRemaining);
        if (this.onDdaTierChanged) this.onDdaTierChanged(this.ddaTier);
    }

    // ---- Public controls -----------------------------------------------------

    changeZoom(amount) {
        this.camera.zoom = clamp(this.camera.zoom + amount, 0.3, 3);
    }

    panCamera(dx, dy) {
        this.camera.x += dx / this.camera.zoom;
        this.camera.y += dy / this.camera.zoom;
    }

    toggleHint() {
        this.hintActive = !this.hintActive;
        return this.hintActive;
    }

    setHint(on) {
        this.hintActive = !!on;
    }

    // ---- Cutting (spatial, from the prototype's handlePointerUp) -------------

    tryCut(swipeStart, swipeEnd, trail) {
        // No cutting while a teaching card is up — the level starts on OK.
        if (this.gameState !== STATE.PLAYING || this.tutorialActive || this.snipsRemaining <= 0) return false;

        // Track the closest point on every fuse, then pick the best *eligible*
        // one. A fuse is ineligible when it already has a cut within 30 units
        // (its spark is already dead there). At a shared chokepoint this lets
        // the 2nd snip hit the other wick instead of the dead one — otherwise
        // the distance tie-break always re-selects the first fuse and the
        // second snip in the same area feels dead.
        let best = null;
        for (const fuse of this.fuses) {
            const p0 = fuse.startNode;
            const p3 = fuse.endNode;
            let minDist = Infinity;
            let minPt = null;
            let minT = 0;
            for (let t = 0; t <= 1; t += 0.02) {
                const pt = getBezierXY(t, p0, fuse.cp1, fuse.cp2, p3);
                const dist = distToSegment(pt, swipeStart, swipeEnd);
                if (dist < minDist) {
                    minDist = dist;
                    minPt = pt;
                    minT = t;
                }
            }

            let deduped = false;
            for (const c of this.cuts) {
                if (c.fuseId === fuse.id && Math.hypot(minPt.x - c.x, minPt.y - c.y) < 30) {
                    deduped = true;
                    break;
                }
            }
            if (deduped) continue;

            if (!best || minDist < best.dist) best = { fuse, point: minPt, t: minT, dist: minDist };
        }

        if (!best || best.dist >= 25) return false;
        const snipFuse = best.fuse;
        const snipPoint = best.point;
        const snipT = best.t;

        {
            const swipeAngle = Math.atan2(swipeEnd.y - swipeStart.y, swipeEnd.x - swipeStart.x);
            this.cuts.push({ x: snipPoint.x, y: snipPoint.y, radius: CUT_RADIUS, angle: swipeAngle, fuseId: snipFuse.id, snipT });
            this.cutFlashes.push({ x: snipPoint.x, y: snipPoint.y, angle: swipeAngle, life: 1 });

            // The fading blade-trail slash follows the finger path (Cut-the-Rope
            // style), falling back to a straight swipe if no trail was recorded.
            const trailPts = Array.isArray(trail) && trail.length >= 2
                ? trail.map((p) => ({ x: p.x, y: p.y }))
                : [{ ...swipeStart }, { ...swipeEnd }];
            this.fadingSlashes.push({ trail: trailPts, life: 1.0 });

            this.snipsRemaining--;
            this.snipsUsed++;
            // PERFECT SNIP: the cut landed just ahead of a spark that's burning
            // right now (within ~42 world px of it). The spark dies in a few
            // frames, clearing that fuse faster — the reward for speed.
            const spark = this.sparks[this.fuses.indexOf(snipFuse)];
            if (spark && spark.ignited && spark.active) {
                const sparkPos = getBezierXY(spark.progress, snipFuse.startNode, snipFuse.cp1, snipFuse.cp2, snipFuse.endNode);
                if (snipT > spark.progress + 0.005 && Math.hypot(snipPoint.x - sparkPos.x, snipPoint.y - sparkPos.y) < 42) {
                    this.perfectSnips++;
                    this.perfectSnipsAt.push({ x: snipPoint.x, y: snipPoint.y, at: this.frameCount });
                }
            }
            // MULTI-CUT: count the live wicks this one snip severs. A wick counts
            // when its curve passes within the cut circle AHEAD of its spark —
            // those sparks die as they burn into the gap (same rule _update uses).
            // N>=2 is the dopamine moment: a banking "+N" popup, an ascending coin
            // chime, and a bonus star per extra wick banked at level clear.
            let severed = 0;
            for (let i = 0; i < this.sparks.length; i++) {
                const s = this.sparks[i];
                if (!s.active) continue;
                const fuse = this.fuses[s.fuseIndex];
                let minD = Infinity, minT = 0;
                for (let t = s.progress; t <= 1; t += 0.02) {
                    const pt = getBezierXY(t, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
                    const d = Math.hypot(pt.x - snipPoint.x, pt.y - snipPoint.y);
                    if (d < minD) { minD = d; minT = t; }
                }
                if (minD < CUT_RADIUS && minT > s.progress + 0.005) severed++;
            }
            if (severed >= 2) {
                this.multikills.push({ x: snipPoint.x, y: snipPoint.y, count: severed, at: this.frameCount });
                if (this.audio) this.audio.play("win_star", { rate: 1.0 });
                this._chime = { total: severed - 1, step: 0, next: performance.now() + 70 };
            }
            // Heads-up that the budget is nearly spent (only worth saying when
            // the level started with more than one cut).
            if (this.snipsRemaining === 1 && this.level.snipsAllowed > 1) {
                this.lastSnipAt = this.frameCount;
            }
            if (this.onSnipsChange) this.onSnipsChange(this.snipsRemaining);
            if (this.audio) this.audio.play("snip");
            if (this.analytics) this.analytics.track("snips_used", { level: this.level.level_id });

            for (let p = 0; p < 15; p++) {
                this.particles.push({
                    x: snipPoint.x, y: snipPoint.y,
                    vx: (Math.random() - 0.5) * 12, vy: (Math.random() - 0.5) * 12,
                    life: 1.0, size: Math.random() * 8 + 4, color: "#fef08a",
                });
            }
            return true;
        }
    }

    /** Feedback when the player tries to cut with no snips left. The swipe must
     *  visibly "do something" (grey denied slash + NO MORE SNIPS! bubble + the
     *  counter shaking red), otherwise hitting the limit feels like the game
     *  stopped responding. Throttled so frantic swiping doesn't spam popups. */
    notifyNoSnips(swipeStart, swipeEnd) {
        if (this.gameState !== STATE.PLAYING) return false;
        if (this.noSnipsAt && this.frameCount - this.noSnipsAt.at < 45) return false;
        const end = { x: swipeEnd.x, y: swipeEnd.y };
        this.deniedSlash = { start: { ...swipeStart }, end, life: 1 };
        this.noSnipsAt = { at: this.frameCount, x: end.x, y: end.y };
        if (this.audio) this.audio.play("dud");
        if (this.onNoSnips) this.onNoSnips();
        return true;
    }

    // ---- DDA: adaptive difficulty tier ladder --------------------------------

    offerDdaIfNeeded() {
        const dda = this.level.dda;
        const threshold = dda?.failThreshold ?? 3;
        if (this.failCount < threshold) return;
        const maxTier = dda?.tierSteps?.length || 3;
        if (this.ddaTier >= maxTier) return;
        if (this.onDdaTierChanged) this.onDdaTierChanged(this.ddaTier, true);
    }

    acceptDda() {
        const dda = this.level.dda;
        const steps = dda?.tierSteps || ["snip", "slow", "hint"];
        const next = this.ddaTier + 1;
        if (next > steps.length) return;

        this.ddaTier = next;
        const step = steps[next - 1]; // tier 1 applies steps[0], tier 2 applies steps[1]...

        if (step === "snip") {
            this.snipsRemaining++;
            if (this.onSnipsChange) this.onSnipsChange(this.snipsRemaining);
        } else if (step === "slow") {
            for (const s of this.sparks) s.speed *= 0.7;
        } else if (step === "hint") {
            this.setHint(true);
        }

        if (this.analytics) this.analytics.track("dda_accept", { level: this.level.level_id, tier: this.ddaTier });
        if (this.onDdaTierChanged) this.onDdaTierChanged(this.ddaTier, false);
    }

    declineDda() {
        if (this.analytics) this.analytics.track("dda_decline", { level: this.level.level_id, tier: this.ddaTier });
    }

    // ---- Star scoring ----------------------------------------------------------

    computeStars() {
        // Every level now carries at least one spare snip, so 3 stars is always
        // achievable: 3★ = finish with a snip left, 2★ = used the whole budget.
        if (this.snipsRemaining >= 1) return 3;
        return 2;
    }

    /** Efficiency score: fewer snips used → more points. 100 for a clear, +100
     *  per snip left over, +25 per perfect snip and per extra wick sliced in a
     *  multi-cut — both reward reading the maze and placing fewer, smarter cuts. */
    computeScore() {
        const snipsLeft = Math.max(0, (this.level?.snipsAllowed ?? 0) - this.snipsUsed);
        return 100 + 100 * snipsLeft + 25 * (this.perfectSnips + this.multikillStars);
    }

    /** Total bonus stars from multi-cuts this attempt (one per extra wick). */
    get multikillStars() {
        return (this.multikills || []).reduce((a, m) => a + (m.count - 1), 0);
    }

    /** Level-clear duration in frames (start → win/lose), for the speed record. */
    get clearFrames() {
        return this.frameCount - this.startedAt;
    }

    // ---- State transitions ------------------------------------------------------

    _finishLevel(win) {
        if (this.gameState !== STATE.PLAYING) return;
        this.audio?.stopLoop("wick_crackle");
        if (win) {
            const stars = this.computeStars();
            this.gameState = STATE.WON;
            this.wonAt = this.frameCount;
            this.lastLevelWin = stars;
            this.comicWord = COMIC_WORDS.won[Math.floor(Math.random() * COMIC_WORDS.won.length)];
            if (this.analytics) {
                this.analytics.track("level_win", {
                    level: this.level.level_id, stars, attempts: this.attempts,
                    duration: this.frameCount - this.startedAt, snips_used: this.snipsUsed,
                    multikills: this.multikills.length, score: this.computeScore(),
                    mode: this.levelMode,
                });
            }
            if (this.platform) this.platform.gameplayStop();
            if (this.onLevelComplete) this.onLevelComplete(this.level.level_id, stars, true);
        } else {
            this.gameState = STATE.LOST;
            this.lostAt = this.frameCount;
            this.failCount++;
            this.comicWord = COMIC_WORDS.lost[Math.floor(Math.random() * COMIC_WORDS.lost.length)];
            if (this.audio) this.audio.play("blast");
            if (this.analytics) {
                this.analytics.track("level_fail", {
                    level: this.level.level_id, attempts: this.attempts,
                    duration: this.frameCount - this.startedAt,
                    mode: this.levelMode,
                });
            }
            if (this.platform) this.platform.gameplayStop();
            if (this.onLevelComplete) this.onLevelComplete(this.level.level_id, 0, false);
        }
    }

    // ---- Loop -------------------------------------------------------------------

    start() {
        if (this._running) return;
        this._running = true;
        this._lastT = performance.now();
        this._rafId = requestAnimationFrame((t) => this._frame(t));
    }

    stop() {
        this._running = false;
        if (this._rafId) cancelAnimationFrame(this._rafId);
        this._rafId = null;
    }

    setPaused(paused) {
        if (paused && this.gameState === STATE.PLAYING) {
            this.gameState = STATE.PAUSED;
        } else if (!paused && this.gameState === STATE.PAUSED) {
            this.gameState = STATE.PLAYING;
            this._lastT = performance.now();
        }
    }

    _frame(t) {
        if (!this._running) return;
        const dt = Math.min(32, t - this._lastT);
        this._lastT = t;

        // Teaching cards freeze the simulation: sparks don't ignite, delay
        // timers don't tick, and the clear-time clock doesn't run until the
        // player dismisses the card and the level actually starts.
        if (this.gameState !== STATE.PAUSED && !this.tutorialActive) {
            this.frameCount++;
            this._update();
        }
        this.renderer.draw(this);
        this._rafId = requestAnimationFrame((nt) => this._frame(nt));
    }

    _update() {
        if (this.gameState !== STATE.PLAYING) return;

        let activeSparks = 0;
        let anyBurning = false;

        for (const spark of this.sparks) {
            if (!spark.active) continue;

            // Chained spark: dark until its parent's burn crosses the trigger
            // point. While dark it doesn't count toward the win condition.
            // Triggering happens in the PARENT's pass (see below), so this check
            // only handles the chain-break case: a parent that died before
            // reaching the trigger point means this wick will never ignite.
            if (spark.chain) {
                const parent = this.sparks[spark.chain.fromFuseIndex];
                if (!spark.triggered && !parent.active) {
                    spark.active = false;
                    spark.diedAt = this.frameCount;
                    continue;
                }
                if (!spark.triggered) continue; // still waiting for the parent
            }

            activeSparks++;

            if (this.frameCount < spark.delay && !spark.ignited) continue;
            if (!spark.ignited) {
                spark.ignited = true;
                spark.ignitedAt = this.frameCount;
                if (this.audio) this.audio.play("ignite");
            }
            anyBurning = true;

            const fuse = this.fuses[spark.fuseIndex];
            spark.progress += spark.speed;
            fuse.burntProgress = Math.max(fuse.burntProgress, spark.progress);

            // When a parent's burn crosses a chained child's trigger point, the
            // child lights IMMEDIATELY — even if the parent is cut this frame.
            // Doing it in the parent's pass keeps triggering order-independent
            // of spark array position.
            for (const child of this.sparks) {
                if (child.chain && child.chain.fromFuseIndex === spark.fuseIndex && !child.triggered && spark.progress >= child.chain.at) {
                    child.triggered = true;
                    child.ignited = true;
                    child.ignitedAt = this.frameCount;
                    if (this.audio) this.audio.play("ignite");
                }
            }

            const pos = getBezierXY(spark.progress, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);

            // Cut-circle collision: a spark dies if it travels through ANY cut
            // that reaches its position — one snip severs every wick it crosses,
            // including lines that overlap or merge near the bomb. (A previous
            // version scoped each cut to the fuse it was placed on; a visible
            // gap then passed a converging spark by, so cut marks that looked
            // like they should stop the fire didn't. Spatial cutting keeps the
            // visual and the mechanic consistent: where the blade lands, the
            // fire dies.)
            let fellIntoGap = false;
            for (const cut of this.cuts) {
                if (Math.hypot(pos.x - cut.x, pos.y - cut.y) < cut.radius) {
                    fellIntoGap = true;
                    break;
                }
            }

            if (fellIntoGap) {
                spark.active = false;
                spark.diedAt = this.frameCount;
                if (this.audio) this.audio.play("dud");
                for (let p = 0; p < 15; p++) {
                    this.particles.push({
                        x: pos.x, y: pos.y, vx: (Math.random() - 0.5) * 3.5, vy: (Math.random() - 0.5) * 3.5,
                        life: 1.0, size: Math.random() * 3.5 + 1.5, color: "#9ca3af",
                    });
                }
                continue;
            }

            if (Math.random() > 0.4) {
                this.particles.push({
                    x: pos.x, y: pos.y, vx: (Math.random() - 0.5) * 2.8, vy: (Math.random() - 0.5) * 2.8,
                    life: 1.0, size: Math.random() * 4 + 2, color: "#292524",
                });
            }

            if (spark.progress >= 1) {
                if (fuse.endNode.type === "payload") {
                    this._finishLevel(false);
                    return;
                }
            }
        }

        // Particles.
        for (let i = this.particles.length - 1; i >= 0; i--) {
            const p = this.particles[i];
            p.x += p.vx;
            p.y += p.vy;
            p.life -= 0.04;
            if (p.life <= 0) this.particles.splice(i, 1);
        }

        // Fading slashes (fast fade = snappy blade trail, like Cut the Rope).
        for (let i = this.fadingSlashes.length - 1; i >= 0; i--) {
            this.fadingSlashes[i].life -= 0.11;
            if (this.fadingSlashes[i].life <= 0) this.fadingSlashes.splice(i, 1);
        }

        // Cut flashes: the vivid snip burst fades out almost as fast as the slash.
        for (let i = this.cutFlashes.length - 1; i >= 0; i--) {
            this.cutFlashes[i].life -= 0.1;
            if (this.cutFlashes[i].life <= 0) this.cutFlashes.splice(i, 1);
        }

        // Denied slash (out-of-snips swipe) fades out quickly too.
        if (this.deniedSlash) {
            this.deniedSlash.life -= 0.09;
            if (this.deniedSlash.life <= 0) this.deniedSlash = null;
        }

        // Multi-cut coin chime: one ascending note per extra wick sliced. Time-
        // based (not frame-based) so the spacing clears AudioManager's 60ms
        // rate limit on every refresh rate.
        if (this._chime) {
            const now = performance.now();
            while (this._chime.step < this._chime.total && now >= this._chime.next) {
                this._chime.step++;
                this._chime.next = now + 70;
                if (this.audio) this.audio.play("win_star", { rate: 1.0 + this._chime.step * 0.25 });
            }
            if (this._chime.step >= this._chime.total) this._chime = null;
        }

        // Win condition: all sparks snuffed (or all delays not yet fired is still playable).
        if (activeSparks === 0 && this.gameState === STATE.PLAYING) {
            this._finishLevel(true);
        }

        // Wick-crackle loop follows the burn state.
        if (anyBurning) this.audio?.startLoop("wick_crackle");
        else this.audio?.stopLoop("wick_crackle");
    }
}
