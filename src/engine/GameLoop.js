// GameLoop.js — rAF loop, state machine, and the simulation.
// Owns all mutable game state. Renders through the injected Renderer.
import { getBezierXY, distToSegment, clamp } from "./MathUtils.js";
import { COMIC_WORDS } from "./Renderer.js";

export const STATE = { PLAYING: "playing", WON: "won", LOST: "lost", PAUSED: "paused" };

// Radius of the cut circle. Sparks die when they travel within this distance
// of a cut point; wick-severing counts use the same value so the "+N" popup
// always matches what actually happens in _update.
const CUT_RADIUS = 15;

// A denied red-wire cut must match what the player SEES: the swipe has to
// actually slice the forbidden wick (within this distance of its visible
// line), not merely land anywhere in the generous 15px severing radius.
// The severing radius stays forgiving for safe wicks; the punishment zone
// hugs the line so cutting a blue wick that merely passes near the red
// doesn't trip the warning.
const FORBIDDEN_TOUCH_RADIUS = 8;

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
        this.onStarBanked = null; // a gold star banked a bonus snip

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
        // Forbidden-wire rule state: first offense is denied with a warning,
        // the second detonates.
        this.wireOffenses = 0;
        this.wireOffenseAt = null; // { at, x, y } — "WRONG WIRE!" popup
        this.wireDeniedSlash = null; // red denied slash for the denied cut
        // Re-cutting a severed wick: denied with a grey slash + "ALREADY CUT!".
        this.deadCutAt = null; // { at, x, y } — "ALREADY CUT!" popup
        // Bonus snips banked by touching a gold pickup star.
        this.bonusSnipsAt = []; // { x, y, at } — "SNIP +1" popups
        // Reset fuse burn + sparks to fresh, and clear per-attempt mechanic state.
        for (const f of this.fuses) {
            f.burntProgress = 0;
            f.hits = 0;
        }
        for (const s of this.sparks) {
            s.progress = 0;
            s.active = true;
            s.ignited = false;
            s.ignitedAt = null; // frameCount when this spark lit (drives reaction words)
            s.diedAt = null;    // frameCount when it was snuffed by a cut
            s.triggered = false; // chained sparks start dark, lit by their parent
            s.doused = false;
        }
        // Pickup stars reset to uncollected; douse points resolve per fuse index.
        this.pickups = (this.level.pickups || []).map((p) => ({ ...p, collected: false }));
        this._douseMap = new Map((this.level.douse || []).map((d) => [d.fuseIndex, d.at]));
        this.detonatedNodeId = null; // payload node a spark actually reached (drives the blast)

        this.camera = this.level.camera
            ? { x: this.level.camera.x, y: this.level.camera.y, zoom: this.level.camera.zoom }
            : this.renderer.computeFitCamera?.(this.level) || { x: 0, y: 0, zoom: 1 };

        // Hint markers, precomputed once per level. Green X's must never sit on
        // a forbidden wire — a mixed crossroad shares its intersection with a
        // red decoy, so a safe wick's marker slides to the nearest clear spot
        // on its own line, and forbidden decoys get no marker at all.
        this.hintTargets = this._computeHintTargets();

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

    /** A fuse is "dead" when its spark can no longer be stopped by being near a
     *  cut — any hit severs it. */
    _fuseFullySevered(fuse) {
        return (fuse.hits || 0) >= 1;
    }

    /** Whether a fuse is a forbidden color under this level's wire rule. */
    _isForbiddenFuse(fuse) {
        const wr = this.level?.wireRule;
        if (!wr || !fuse.color) return false;
        return wr.legend[fuse.color] === "no";
    }

    /** Fuses whose curve passes within `radius` of the cut point, excluding
     *  already-dead fuses. Spark-independent, so a forbidden decoy is caught
     *  even while its wick never lights. The default radius is the forgiving
     *  severing distance; the forbidden-wire check passes a tighter radius so
     *  a red wick only trips when the cut lands close to its visible line. */
    _fusesTouchedByCut(snipPoint, radius = CUT_RADIUS) {
        const touched = [];
        for (const fuse of this.fuses) {
            if (this._fuseFullySevered(fuse)) continue;
            let minD = Infinity, minT = 0;
            for (let t = 0; t <= 1; t += 0.02) {
                const pt = getBezierXY(t, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
                const d = Math.hypot(pt.x - snipPoint.x, pt.y - snipPoint.y);
                if (d < minD) {
                    minD = d;
                    minT = t;
                }
            }
            if (minD < radius) touched.push({ fuse, minT });
        }
        return touched;
    }

    /** Green-X hint markers: one per cuttable fuse, placed where a swipe
     *  actually severs it. Forbidden decoys get none (they are never cut). A
     *  safe wick whose intersection point hugs a forbidden curve (mixed
     *  crossroad) slides its marker to the nearest clear point on its own
     *  line, so the hint never points at a cut that would trip the rule. */
    _computeHintTargets() {
        const forbidden = this.fuses.filter((f) => this._isForbiddenFuse(f));
        const margin = FORBIDDEN_TOUCH_RADIUS + 4; // a little visual slack past the deny radius
        const targets = [];
        for (const fuse of this.fuses) {
            if (this._isForbiddenFuse(fuse)) continue;
            const point = this._hintPointFor(fuse, forbidden, margin);
            targets.push({ fuse, point });
        }
        return targets;
    }

    _hintPointFor(fuse, forbidden, margin) {
        const it = fuse.intersectionPt;
        const clear = (x, y) => {
            for (const fb of forbidden) {
                if (this._distToFuseAt(x, y, fb) < margin) return false;
            }
            return true;
        };
        if (it && clear(it.x, it.y)) return it;
        // Slide along the curve to the clear sample nearest the intersection,
        // so the X stays on the wick and as close to the teachable spot as the
        // forbidden overlap allows.
        let best = null;
        let bestD = Infinity;
        for (let t = 0; t <= 1; t += 0.02) {
            const pt = getBezierXY(t, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
            if (!clear(pt.x, pt.y)) continue;
            const d = it ? Math.hypot(pt.x - it.x, pt.y - it.y) : t;
            if (d < bestD) {
                bestD = d;
                best = pt;
            }
        }
        return best || it;
    }

    /** Coarse min distance from a point to a fuse's bezier curve. */
    _distToFuseAt(x, y, fuse) {
        let m = Infinity;
        for (let t = 0; t <= 1; t += 0.02) {
            const p = getBezierXY(t, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
            const d = Math.hypot(p.x - x, p.y - y);
            if (d < m) m = d;
        }
        return m;
    }

    tryCut(swipeStart, swipeEnd, trail) {
        // No cutting while a teaching card is up — the level starts on OK.
        if (this.gameState !== STATE.PLAYING || this.tutorialActive || this.snipsRemaining <= 0) return false;

        // Track the closest point on every fuse, then pick the best *eligible*
        // one. A fuse is ineligible when it is already fully severed, or when it
        // already has a cut within 30 units (its spark is already dead there).
        // At a shared chokepoint this lets the 2nd snip hit the other wick
        // instead of the dead one.
        let best = null;
        let deadBest = null; // closest already-severed wick (for re-cut feedback)
        for (const fuse of this.fuses) {
            const p0 = fuse.startNode;
            const p3 = fuse.endNode;
            const severed = this._fuseFullySevered(fuse);
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

            if (severed) {
                if (minDist < CUT_RADIUS && (!deadBest || minDist < deadBest.dist)) deadBest = { fuse, dist: minDist };
                continue;
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

        const liveBest = best && best.dist < 25 ? best : null;
        // A swipe on an already-severed wick must not silently do nothing — and
        // when the only live candidate it fell through to is a forbidden wire,
        // the player is re-cutting a dead safe wick, not the trap: deny it as
        // "already cut" instead of charging a wire offense. A closer live target
        // still wins (shared chokepoints keep cutting the other wick).
        if (deadBest && (!liveBest || (this._isForbiddenFuse(liveBest.fuse) && deadBest.dist <= liveBest.dist))) {
            this._denyDeadWick(swipeStart, swipeEnd);
            return false;
        }
        if (!liveBest) return false;
        const snipFuse = liveBest.fuse;
        const snipPoint = liveBest.point;
        const snipT = liveBest.t;

        // Forbidden-wire rule: before committing, check every fuse this cut
        // would touch — but with a TIGHT radius so a red wick only trips when
        // the cut actually lands on its visible line, not anywhere in the
        // generous severing radius. A forbidden color is denied on the first
        // offense (warning, no snip) and detonates on the second.
        const touched = this._fusesTouchedByCut(snipPoint);
        if (this.level?.wireRule) {
            const bad = this._fusesTouchedByCut(snipPoint, FORBIDDEN_TOUCH_RADIUS)
                .find(({ fuse }) => this._isForbiddenFuse(fuse));
            if (bad) {
                this.wireOffenses++;
                if (this.wireOffenses >= 2) {
                    // Detonation: the offending wick chars end-to-end so the
                    // whole red line reads burned, not just left red.
                    bad.fuse.burntProgress = 1;
                    this._finishLevel(false);
                    return false;
                }
                // Warning: deny the cut, flash red, pop "WRONG WIRE!".
                const swipeAngle = Math.atan2(swipeEnd.y - swipeStart.y, swipeEnd.x - swipeStart.x);
                this.wireOffenseAt = { at: this.frameCount, x: snipPoint.x, y: snipPoint.y, fuse: bad.fuse.id };
                this.wireDeniedSlash = { start: { ...swipeStart }, end: { ...swipeEnd }, life: 1, angle: swipeAngle };
                if (this.audio) this.audio.play("dud");
                if (this.analytics) this.analytics.track("wire_offense", { level: this.level.level_id, offense: this.wireOffenses });
                return false;
            }
        }

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
            // those sparks die as they burn into the gap. N>=2 is
            // the dopamine moment: a banking "+N" popup, an ascending coin chime,
            // and a bonus star per extra wick banked at level clear.
            let newlySevered = 0;
            for (const { fuse, minT } of touched) {
                if (fuse.neverLights) continue; // decoys never burn — nothing to sever
                const s = this.sparks[this.fuses.indexOf(fuse)];
                if (!s || !s.active) continue;
                // The cut must sit at-or-ahead of the spark (one sample step of
                // tolerance covers a cut landing right on the spark).
                if (minT < s.progress - 0.02) continue;
                fuse.hits++;
                if (this._fuseFullySevered(fuse)) newlySevered++;
            }
            if (newlySevered >= 2) {
                this.multikills.push({ x: snipPoint.x, y: snipPoint.y, count: newlySevered, at: this.frameCount });
                if (this.audio) this.audio.play("win_star", { rate: 1.0 });
                this._chime = { total: newlySevered - 1, step: 0, next: performance.now() + 70 };
            }
            // Gold pickup star: a cut whose circle touches an uncollected star
            // banks +1 snip (chime + "SNIP +1" popup).
            for (const p of this.pickups || []) {
                if (p.collected || p.fuseIndex == null) continue;
                if (Math.hypot(snipPoint.x - p.x, snipPoint.y - p.y) < 26) {
                    p.collected = true;
                    this.snipsRemaining++;
                    this.bonusSnipsAt.push({ x: p.x, y: p.y, at: this.frameCount });
                    if (this.audio) this.audio.play("win_star", { rate: 1.2 });
                    if (this.onSnipsChange) this.onSnipsChange(this.snipsRemaining);
                    if (this.onStarBanked) this.onStarBanked(this.snipsRemaining);
                }
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

    /** Feedback for a swipe that lands on an already-severed wick (its line is
     *  still visible on the board, so a re-cut must never feel ignored): grey
     *  denied slash + "ALREADY CUT!" bubble. Throttled so frantic swiping
     *  doesn't spam the popup. */
    _denyDeadWick(swipeStart, swipeEnd) {
        if (this.deadCutAt && this.frameCount - this.deadCutAt.at < 45) return;
        this.deniedSlash = { start: { ...swipeStart }, end: { ...swipeEnd }, life: 1 };
        this.deadCutAt = { at: this.frameCount, x: swipeEnd.x, y: swipeEnd.y };
        if (this.audio) this.audio.play("dud");
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
            // Forbidden decoy wires never light nor threaten — their spark is
            // a dummy that stays dark and doesn't count toward the win check.
            if (spark.decoy) continue;

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

            // Water drop: a doused fuse's spark is snuffed at the drop point —
            // that wick needs no cut at all. The ash trail stops at the drop.
            const douseAt = this._douseMap?.get(spark.fuseIndex);
            if (douseAt != null && spark.progress >= douseAt) {
                spark.active = false;
                spark.diedAt = this.frameCount;
                spark.doused = true;
                fuse.burntProgress = Math.max(fuse.burntProgress, douseAt);
                if (this.audio) this.audio.play("dud");
                const dp = getBezierXY(douseAt, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
                for (let p = 0; p < 18; p++) {
                    this.particles.push({
                        x: dp.x, y: dp.y,
                        vx: (Math.random() - 0.5) * 5, vy: -Math.random() * 5 - 1,
                        life: 1.0, size: Math.random() * 4 + 2, color: p % 3 === 0 ? "#bae6fd" : "#60a5fa",
                    });
                }
                continue;
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

            if (fellIntoGap && this._fuseFullySevered(fuse)) {
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
                    this.detonatedNodeId = fuse.endNode.id;
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
        // Wrong-wire denied slash fades a touch slower than a generic denial so
        // the warning reads on fast displays (the popup carries it too).
        if (this.wireDeniedSlash) {
            this.wireDeniedSlash.life -= 0.05;
            if (this.wireDeniedSlash.life <= 0) this.wireDeniedSlash = null;
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
