// Renderer.js — all canvas drawing + dynamic asset loading.
// Preserves the prototype's draw order, styling, and state swapping.
import { getBezierXY, getBezierTangent } from "./MathUtils.js";
import { computeFitCamera } from "./LevelManager.js";

// Relative prefix so the game works from any subdirectory host (itch, Poki, Playables zips).
const ASSET_PREFIX = "assets/";

// Reaction words for the small character reactions. Picked deterministically by
// level + character so each level uses a different set, but never flickers.
const REACTION_WORDS = {
    payloadDanger: ["AHH!", "HELP!", "PANIC!", "NOOO!", "YIKES!", "GULP!"],
    spawnLit: ["EEK!", "OH!", "HOT!", "YIKES!", "UH OH!", "HEY!"],
    spawnDud: ["?", "WHEW", "OK?", "PHEW", "SAFE", "..."],
};

/** Deterministic pick from a word list keyed on level + node id, so a character
 *  always says the same thing within a level but it varies across levels. */
function pickReactionWord(levelId, nodeId, list) {
    const seed = String(levelId) + ":" + nodeId;
    let h = 0;
    for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    return list[h % list.length];
}

// How long a reaction word stays on screen. Short on ignite so it doesn't block
// the play field; the fail beat re-shows it as the blast settles.
const REACTION_SHOW_FRAMES = 55;
const REACTION_LOST_FRAMES = 60;

export class Renderer {
    constructor(canvas) {
        this.canvas = canvas;
        this.ctx = canvas.getContext("2d");
        // HiDPI: the backing store is device-pixel sized so phones (dpr 2-3)
        // render art crisply instead of the browser upscaling a 1x canvas.
        // All game math uses logical CSS-pixel width/height below.
        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        canvas.width = Math.round(this.width * this.dpr);
        canvas.height = Math.round(this.height * this.dpr);
        canvas.style.width = this.width + "px";
        canvas.style.height = this.height + "px";
        this.ctx.imageSmoothingEnabled = true;
        this.ctx.imageSmoothingQuality = "high";
        this.images = {};
        // Sliding-hand demo pointer (level-1 onboarding) — same asset the UFO
        // puzzle animates along its hint path. Content bbox is computed lazily.
        this._handImg = new Image();
        this._handImg.src = ASSET_PREFIX + "ui/ui-hand-pointer.png";
        this._handBBox = null;
        this._pending = new Set();
        this._onAssetsReady = null;
        this._assetOk = new Map(); // src -> boolean (exists), cached per session
    }

    // ---- Responsive sizing ------------------------------------------------------

    resize() {
        this.width = window.innerWidth;
        this.height = window.innerHeight;
        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(this.width * this.dpr);
        this.canvas.height = Math.round(this.height * this.dpr);
        this.canvas.style.width = this.width + "px";
        this.canvas.style.height = this.height + "px";
    }

    computeFitCamera(level) {
        return computeFitCamera(level, { width: this.width, height: this.height });
    }

    // ---- Asset loading (dynamic, transparent PNGs) --------------------------------

    loadAssets(assetMap) {
        // assetMap: { playing, win, lose } or { idle, ignition, dud } etc.
        for (const key of Object.keys(assetMap)) {
            const src = ASSET_PREFIX + assetMap[key];
            if (this.images[src]) continue;
            const img = new Image();
            this._pending.add(src);
            img.onload = () => {
                this._pending.delete(src);
                if (this._pending.size === 0 && this._onAssetsReady) this._onAssetsReady();
            };
            img.onerror = () => this._pending.delete(src);
            img.src = src;
            this.images[src] = img;
        }
    }

    onAssetsReady(cb) {
        this._onAssetsReady = cb;
        if (this._pending.size === 0) cb();
    }

    /** Probe whether an asset file exists (used by live asset resolution so a
     *  missing per-level art file falls back to the placeholder set). Cached. */
    async hasAsset(name) {
        const src = ASSET_PREFIX + name;
        if (this._assetOk.has(src)) return this._assetOk.get(src);
        const ok = await new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(true);
            img.onerror = () => resolve(false);
            img.src = src;
        });
        this._assetOk.set(src, ok);
        return ok;
    }

    _img(src) {
        const img = this.images[src];
        return img && img.complete && img.height > 0 ? img : null;
    }

    // ---- Main draw ---------------------------------------------------------------

    draw(game) {
        const ctx = this.ctx;
        // Scale to device pixels once per frame; everything after this uses
        // logical CSS-pixel coordinates (this.width / this.height).
        ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
        // canvas.width changes (resize) reset context state, so re-assert high
        // quality downscaling for the sprites every frame.
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = "high";
        ctx.clearRect(0, 0, this.width, this.height);

        ctx.save();
        // Camera transform (prototype).
        ctx.translate(this.width / 2, this.height / 2);
        ctx.scale(game.camera.zoom, game.camera.zoom);
        ctx.translate(-this.width / 2 + game.camera.x, -this.height / 2 + game.camera.y);

        this._drawHint(game);
        this._drawFuses(game);
        this._drawCuts(game);
        this._drawCutFlash(game);
        // Spark effects draw before the assets so the burning head passes
        // behind the matchstick and banana, not over them.
        if (game.gameState === "playing") this._drawSparkEffects(game);
        this._drawAssets(game);
        if (game.gameState === "lost") this._drawComicText(game, "KABOOM!", "#ef4444", game.lostAt);
        if (game.gameState === "won") this._drawComicText(game, "PHEW!", "#22c55e", game.wonAt);
        this._drawSwipePreview(game);
        // Onboarding demo hand rides on top of everything while the tutorial is up.
        this._drawTutorialDemo(game);

        ctx.restore();
    }

    _drawHint(game) {
        if (!game.hintActive) return;
        const ctx = this.ctx;

        ctx.lineWidth = 1;
        ctx.strokeStyle = "rgba(28, 25, 23, 0.2)";
        ctx.setLineDash([5, 5]);
        for (const fuse of game.fuses) {
            ctx.beginPath();
            ctx.moveTo(fuse.startNode.x, fuse.startNode.y);
            ctx.lineTo(fuse.endNode.x, fuse.endNode.y);
            ctx.stroke();
        }
        ctx.setLineDash([]);

        // Glowing green crosshairs on the exact [x,y] target intersections.
        const seen = new Set();
        for (const fuse of game.fuses) {
            const it = fuse.intersectionPt;
            const key = `${it.x},${it.y}`;
            if (seen.has(key)) continue;
            seen.add(key);

            ctx.beginPath();
            ctx.arc(it.x, it.y, 25, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(34, 197, 94, 0.8)";
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(it.x - 35, it.y);
            ctx.lineTo(it.x + 35, it.y);
            ctx.moveTo(it.x, it.y - 35);
            ctx.lineTo(it.x, it.y + 35);
            ctx.stroke();
        }
    }

    _drawFuses(game) {
        const ctx = this.ctx;
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        for (let fIdx = 0; fIdx < game.fuses.length; fIdx++) {
            const fuse = game.fuses[fIdx];
            const p0 = fuse.startNode;
            const p3 = fuse.endNode;
            const burnt = fuse.burntProgress || 0;
            // Deterministic per-fuse seed so jitter/wobble is stable across frames.
            const seed = fuse.id
                ? [...String(fuse.id)].reduce((s, ch) => s + ch.charCodeAt(0), 0)
                : fIdx * 7 + 3;

            // ---- Burned section: flat, settled ash ---------------------------
            if (burnt > 0) {
                const ashAt = (u) => {
                    const pt = getBezierXY(u, p0, fuse.cp1, fuse.cp2, p3);
                    const t = getBezierTangent(u, p0, fuse.cp1, fuse.cp2, p3);
                    const amp = Math.sin(u * 41 + seed * 1.7) * 1.1 + Math.sin(u * 13 + seed) * 0.5;
                    return { x: pt.x - t.y * amp, y: pt.y + t.x * amp };
                };
                // Collapsed dark wick — flat ash, no outline.
                ctx.beginPath();
                ctx.strokeStyle = "rgba(41, 37, 36, 0.85)";
                ctx.lineWidth = 3;
                ctx.moveTo(ashAt(0).x, ashAt(0).y);
                for (let u = 0.02; u <= burnt; u += 0.02) {
                    const pt = ashAt(u);
                    ctx.lineTo(pt.x, pt.y);
                }
                ctx.stroke();
            }

            // ---- Live section: a "live wire" with a subtle gradient pulse ----
            if (burnt < 1) {
                const wob = (u) => {
                    const pt = getBezierXY(u, p0, fuse.cp1, fuse.cp2, p3);
                    const t = getBezierTangent(u, p0, fuse.cp1, fuse.cp2, p3);
                    // Static organic jitter only — no time-based vibration.
                    const amp = 0.35 * Math.sin(u * 27 + seed) + 0.15 * Math.sin(u * 9 + seed * 2);
                    return { x: pt.x - t.y * amp, y: pt.y + t.x * amp };
                };

                // Amber body with a steady soft glow (no breathing pulse).
                ctx.beginPath();
                ctx.shadowColor = "rgba(249, 115, 22, 0.5)";
                ctx.shadowBlur = 6;
                ctx.moveTo(wob(burnt).x, wob(burnt).y);
                for (let u = Math.min(1, burnt + 0.02); u <= 1; u += 0.02) {
                    const pt = wob(u);
                    ctx.lineTo(pt.x, pt.y);
                }
                ctx.strokeStyle = this._liveWireGradient(game, fuse, wob, burnt);
                ctx.lineWidth = 4.5;
                ctx.stroke();
                ctx.shadowBlur = 0;

                // Ember glow at the burn front (ties the wire to the spark head).
                const ember = wob(Math.max(0.001, burnt));
                const grad = this._radialGradient(ember.x, ember.y, 0, ember.x, ember.y, 16);
                grad.addColorStop(0, "rgba(254, 240, 138, 0.9)");
                grad.addColorStop(0.35, "rgba(249, 115, 22, 0.55)");
                grad.addColorStop(1, "rgba(249, 115, 22, 0)");
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(ember.x, ember.y, 16, 0, Math.PI * 2);
                ctx.fill();
            }
        }
    }

    /** Gradient along the live wire: hot at the burn front, cooling toward the
     *  payload. A slow drift of the hot band reads as energy flowing (replaces
     *  the bright traveling slug). */
    _liveWireGradient(game, fuse, wob, burnt) {
        const hot = wob(Math.max(0.001, burnt));
        const cool = wob(1);
        const grad = this._linearGradient(hot.x, hot.y, cool.x, cool.y);
        const drift = 0.15 * Math.sin(game.frameCount * 0.05 + burnt * 2);
        grad.addColorStop(0, "#f59e0b");
        grad.addColorStop(0.35 + drift, "#fbbf24");
        grad.addColorStop(0.65 + drift, "#d97706");
        grad.addColorStop(1, "#b45309");
        return grad;
    }

    _drawCuts(game) {
        const ctx = this.ctx;
        if (game.cuts.length === 0) return;

        // Punch a razor gap through the fuse (destination-out) shaped like the
        // blade-trail slash: a tapered eye — widest across the fuse, sharp points
        // at both ends — so the cut and the slash read as the same stroke.
        ctx.globalCompositeOperation = "destination-out";
        for (const cut of game.cuts) this._punchTaperedGap(cut);
        ctx.globalCompositeOperation = "source-over";
    }

    /** Fill an eye/lens shaped gap along the swipe angle (destination-out). */
    _punchTaperedGap(cut) {
        const ctx = this.ctx;
        const dx = Math.cos(cut.angle);
        const dy = Math.sin(cut.angle);
        const nx = -dy; // perpendicular
        const ny = dx;
        const halfLen = 18;
        const maxHalfWidth = 3; // middle width ~6px — a thin slash, just wider than the wick

        ctx.beginPath();
        const steps = 16;
        let started = false;
        for (let i = 0; i <= steps; i++) {
            const u = i / steps;
            const halfWidth = maxHalfWidth * Math.sin(Math.PI * u); // taper to points
            const px = cut.x + (u - 0.5) * 2 * halfLen * dx;
            const py = cut.y + (u - 0.5) * 2 * halfLen * dy;
            const tx = px + nx * halfWidth;
            const ty = py + ny * halfWidth;
            if (!started) { ctx.moveTo(tx, ty); started = true; }
            else ctx.lineTo(tx, ty);
        }
        for (let i = steps; i >= 0; i--) {
            const u = i / steps;
            const halfWidth = maxHalfWidth * Math.sin(Math.PI * u);
            const px = cut.x + (u - 0.5) * 2 * halfLen * dx;
            const py = cut.y + (u - 0.5) * 2 * halfLen * dy;
            ctx.lineTo(px - nx * halfWidth, py - ny * halfWidth);
        }
        ctx.closePath();
        // destination-out only cares about the shape's alpha; force an opaque fill
        // so a leftover gradient fillStyle (e.g. the ember glow) can't zero it out.
        ctx.fillStyle = "#000";
        ctx.fill();
    }

    /** Vivid "snip" burst right when a cut lands: a red slash along the cut angle
     *  with an expanding shock ring. The destination-out gap stays as white
     *  spacing, but the instant of the cut reads clearly even on the cream paper. */
    _drawCutFlash(game) {
        const ctx = this.ctx;
        for (const f of game.cutFlashes) {
            const t = 1 - f.life; // 0 → 1 over the flash lifetime
            const alpha = Math.max(0, f.life);
            ctx.save();
            ctx.translate(f.x, f.y);
            ctx.rotate(f.angle);
            ctx.lineCap = "round";
            // Wide red slash — the "snip" moment.
            ctx.strokeStyle = `rgba(239, 68, 68, ${(0.8 * alpha).toFixed(3)})`;
            ctx.lineWidth = 13 * (1 - t * 0.4);
            ctx.beginPath();
            ctx.moveTo(-24 - t * 10, 0);
            ctx.lineTo(24 + t * 10, 0);
            ctx.stroke();
            // Amber mid band + white-hot core.
            ctx.strokeStyle = `rgba(251, 191, 36, ${(0.9 * alpha).toFixed(3)})`;
            ctx.lineWidth = 7;
            ctx.beginPath();
            ctx.moveTo(-19 - t * 10, 0);
            ctx.lineTo(19 + t * 10, 0);
            ctx.stroke();
            ctx.strokeStyle = `rgba(255, 255, 255, ${(0.95 * alpha).toFixed(3)})`;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(-14 - t * 10, 0);
            ctx.lineTo(14 + t * 10, 0);
            ctx.stroke();
            // Expanding shock ring.
            ctx.globalAlpha = alpha * 0.6;
            ctx.strokeStyle = "#ef4444";
            ctx.lineWidth = 4 * (1 - t);
            ctx.beginPath();
            ctx.arc(0, 0, 10 + t * 32, 0, Math.PI * 2);
            ctx.stroke();
            ctx.restore();
        }
    }

    _drawAssets(game) {
        const ctx = this.ctx;
        for (const node of game.nodes) {
            if (node.type === "payload") {
                this._drawPayload(game, node);
            } else if (node.type === "spawn") {
                this._drawSpawn(game, node);
            }
        }
    }

    _drawPayload(game, node) {
        const ctx = this.ctx;
        let src = game.level.payloadAssets.playing;
        if (game.gameState === "won") src = game.level.payloadAssets.win;
        else if (game.gameState === "lost") src = game.level.payloadAssets.lose;

        const img = this._img(ASSET_PREFIX + src);
        if (!img) return;

        ctx.save();
        ctx.translate(node.x, node.y);

        let scaleX = 1;
        let scaleY = 1;
        let rot = 0;
        let dy = 0;

        if (game.gameState === "playing") {
            rot = Math.sin(game.frameCount * 0.1) * 0.05;
        } else if (game.gameState === "lost" && game.lostAt != null) {
            // Cartoon blast backdrop behind the art, then bounce the PNG with it.
            this._drawBlast(game, node);

            const t = Math.min(1, (game.frameCount - game.lostAt) / 55);
            const ease = 1 - Math.pow(1 - t, 3);
            const recoil = Math.exp(-t * 7);
            scaleX = 1 + 0.25 * recoil;
            scaleY = 1 - 0.25 * recoil;
            const rise = Math.sin(ease * Math.PI); // 1 at the top of the hop
            dy = -52 * rise;
            scaleY *= 1 + 0.12 * rise;
            scaleX *= 1 - 0.06 * rise;
            rot = Math.sin(t * 20) * 0.12 * (1 - t);
        }

        ctx.rotate(rot);
        ctx.scale(scaleX, scaleY);
        ctx.translate(0, dy);

        const targetHeight = 200;
        const aspect = img.width / img.height;
        const targetWidth = targetHeight * aspect;

        ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
        ctx.restore();

        // Dramatic reaction word above the banana — pops in the moment a spark
        // lights, fades out so it doesn't block the view, and reappears on fail.
        if (game.gameState === "playing") {
            let latestIgnite = -1;
            for (const s of game.sparks) {
                if (s.active && s.ignited && s.ignitedAt != null && s.progress < 1) {
                    latestIgnite = Math.max(latestIgnite, s.ignitedAt);
                }
            }
            if (latestIgnite >= 0) {
                this._drawReactionText(
                    game, node,
                    pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.payloadDanger),
                    "#ef4444", 40, -128, latestIgnite, REACTION_SHOW_FRAMES
                );
            }
        } else if (game.gameState === "lost" && game.lostAt != null) {
            // Reappear as the blast settles, tucked above the KABOOM! word.
            this._drawReactionText(
                game, node,
                pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.payloadDanger),
                "#ef4444", 34, -172, game.lostAt + 18, REACTION_LOST_FRAMES
            );
        }
    }

    /** Expanding flash, shockwave rings and starburst rays behind the payload.
     *  Called inside the payload's node transform, so it draws at (0,0). */
    _drawBlast(game, node) {
        const ctx = this.ctx;
        const t = Math.min(1, (game.frameCount - game.lostAt) / 55);
        const alpha = 1 - t;
        if (alpha <= 0) return;

        ctx.save();

        // Instant white-hot flash.
        const flashR = 40 + (1 - Math.pow(1 - t, 3)) * 115;
        const fg = this._radialGradient(0, 0, 0, 0, 0, flashR);
        fg.addColorStop(0, `rgba(255, 255, 255, ${(0.85 * alpha).toFixed(3)})`);
        fg.addColorStop(0.5, `rgba(254, 240, 138, ${(0.5 * alpha).toFixed(3)})`);
        fg.addColorStop(1, "rgba(249, 115, 22, 0)");
        ctx.fillStyle = fg;
        ctx.beginPath();
        ctx.arc(0, 0, flashR, 0, Math.PI * 2);
        ctx.fill();

        // Two shockwave rings, the second trailing the first.
        for (let r = 0; r < 2; r++) {
            const ringT = Math.max(0, Math.min(1, t - r * 0.13));
            if (ringT <= 0) continue;
            const ringR = 18 + (1 - Math.pow(1 - ringT, 3)) * 155;
            ctx.strokeStyle = `rgba(${r === 0 ? "249, 115, 22" : "239, 68, 68"}, ${(0.7 * (1 - ringT)).toFixed(3)})`;
            ctx.lineWidth = 6 * (1 - ringT) + 1;
            ctx.beginPath();
            ctx.arc(0, 0, ringR, 0, Math.PI * 2);
            ctx.stroke();
        }

        // Starburst rays.
        ctx.lineCap = "round";
        for (let i = 0; i < 12; i++) {
            const a = (i / 12) * Math.PI * 2 + i * 0.2;
            const len = 24 + (1 - Math.pow(1 - t, 3)) * 115 * (0.7 + 0.3 * Math.sin(i * 2.7));
            const cosA = Math.cos(a);
            const sinA = Math.sin(a);
            ctx.strokeStyle = `rgba(251, 191, 36, ${(0.55 * alpha).toFixed(3)})`;
            ctx.lineWidth = 5 * (1 - alpha * 0.5);
            ctx.beginPath();
            ctx.moveTo(cosA * 14, sinA * 14);
            ctx.lineTo(cosA * len, sinA * len);
            ctx.stroke();
        }

        ctx.restore();
    }

    /** Comic word popping up over the payload — "KABOOM!" on a blast, "PHEW!" on
     *  a defuse. Drawn on the canvas so it lives with the action, not in a modal. */
    _drawComicText(game, text, color, atFrame) {
        const node = game.nodes.find((n) => n.type === "payload");
        if (!node || atFrame == null) return;
        const t = Math.min(1, (game.frameCount - atFrame) / 40);
        if (t <= 0) return;

        const ctx = this.ctx;
        // Quick pop-in that settles, then a slight wobble while it hangs.
        const pop = 1.5 - 0.5 * Math.exp(-t * 6);
        const wobble = Math.sin(t * 16) * 0.07 * (1 - t);

        // Sit just above the banana, and clamp so it never runs off the top of
        // the frame (payloads near the screen edge in some levels).
        let ty = node.y - 130;
        const cam = game.camera;
        const sy = this.height / 2 + (ty - (this.height / 2 - cam.y)) * cam.zoom;
        if (sy < 70) ty += (70 - sy) / cam.zoom;

        ctx.save();
        ctx.translate(node.x, ty);
        ctx.rotate(-0.08 + wobble);
        ctx.scale(pop, pop);
        ctx.font = "36px 'Luckiest Guy', 'Courier New', Courier, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = 10;
        ctx.strokeStyle = "#1c1917";
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    /** Comic reaction word ("AHH!", "EEK!", "?") floating above a character, drawn
     *  in the same poster font as the PHEW!/KABOOM! text so it matches the UI.
     *  Only appears within [startFrame, startFrame + duration] and fades in/out,
     *  so it pops on ignite / at the fail beat instead of blocking the play field.
     *  No ink outline — these are small, chatty marks and a thick stroke makes
     *  them look heavy next to the sprite. */
    _drawReactionText(game, node, text, color, size, offsetY, startFrame, duration) {
        if (startFrame == null) return;
        const ctx = this.ctx;

        const elapsed = game.frameCount - startFrame;
        if (elapsed < 0 || elapsed > duration) return;

        // Keep it on screen like the comic words.
        let ty = node.y + offsetY;
        const cam = game.camera;
        const sy = this.height / 2 + (ty - (this.height / 2 - cam.y)) * cam.zoom;
        if (sy < 70) ty += (70 - sy) / cam.zoom;

        const t = game.frameCount;
        const pop = 1 + Math.sin(t * 0.16) * 0.07;
        const wobble = Math.sin(t * 0.09 + node.id.length) * 0.04;
        const jig = Math.sin(t * 0.12) * 2;

        const fadeIn = Math.min(1, elapsed / 8);
        const fadeOut = Math.min(1, (duration - elapsed) / 14);

        ctx.save();
        ctx.globalAlpha = Math.min(fadeIn, fadeOut);
        ctx.translate(node.x, ty + jig);
        ctx.rotate(wobble);
        ctx.scale(pop, pop);
        ctx.font = `${size}px 'Luckiest Guy', 'Courier New', Courier, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    _drawSpawn(game, node) {
        const ctx = this.ctx;
        const assets = game.level.spawnAssets;

        const fuseIndex = game.fuses.findIndex((f) => f.start === node.id);
        const spark = fuseIndex >= 0 ? game.sparks[fuseIndex] : null;

        let src = assets.idle;
        if (game.gameState === "won" || (spark && !spark.active && spark.progress > 0)) {
            src = assets.dud;
        } else if (spark && spark.active && game.frameCount >= spark.delay) {
            src = assets.ignition;
        }

        const img = this._img(ASSET_PREFIX + src);
        if (!img) return;

        ctx.save();
        ctx.translate(node.x, node.y);
        if (game.gameState === "playing") ctx.rotate(Math.sin(game.frameCount * 0.05 + node.id.length) * 0.1);

        const targetHeight = 80;
        const aspect = img.width / img.height;
        const targetWidth = targetHeight * aspect;

        ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
        ctx.restore();

        // Reaction word: panic word pops when this matchstick's fuse lights and
        // fades out; it reappears on the fail beat. The "?" pops when the fuse
        // is cut (dud).
        if (src === assets.ignition) {
            const startFrame = game.gameState === "lost" ? game.lostAt : (spark ? spark.ignitedAt : null);
            const duration = game.gameState === "lost" ? REACTION_LOST_FRAMES : REACTION_SHOW_FRAMES;
            this._drawReactionText(
                game, node,
                pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.spawnLit),
                "#f97316", 22, -58, startFrame, duration
            );
        } else if (src === assets.dud) {
            this._drawReactionText(
                game, node,
                pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.spawnDud),
                "#292524", 26, -58, spark ? spark.diedAt : null, 60
            );
        }
    }

    _drawSparkEffects(game) {
        const ctx = this.ctx;

        // Sparks themselves.
        for (const spark of game.sparks) {
            if (!spark.active) continue;
            if (game.frameCount < spark.delay) continue;
            const fuse = game.fuses[spark.fuseIndex];
            const pos = getBezierXY(spark.progress, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
            this._drawRetroSpark(pos.x, pos.y, game.frameCount);
        }

        // Particles: little 4-point sparkle stars, not squares.
        for (const p of game.particles) {
            this._drawParticleStar(p);
        }
    }

    /** Draw a single flying spark as a tiny 4-point sparkle star. The rotation
     *  is derived from position so each particle keeps a stable orientation
     *  while it tumbles across the screen. */
    _drawParticleStar(p) {
        const ctx = this.ctx;
        const size = Math.max(1.5, p.size);
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.x * 0.11 + p.y * 0.07);
        ctx.globalAlpha = Math.max(0, p.life);
        ctx.fillStyle = p.color;

        ctx.beginPath();
        const spikes = 4;
        for (let i = 0; i < spikes * 2; i++) {
            // Long points at the 4 cardinal directions, short dips between.
            const radius = i % 2 === 0 ? size : size * 0.3;
            const angle = (i * Math.PI) / spikes;
            const pX = Math.cos(angle) * radius;
            const pY = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(pX, pY);
            else ctx.lineTo(pX, pY);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
    }

    _drawRetroSpark(x, y, frameCount) {
        const ctx = this.ctx;
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(frameCount * 0.2);
        const scale = 1 + Math.sin(frameCount * 0.5) * 0.2;
        ctx.scale(scale, scale);

        ctx.beginPath();
        const spikes = 7;
        for (let i = 0; i < spikes * 2; i++) {
            const radius = i % 2 === 0 ? 12 : 5;
            const angle = (i * Math.PI) / spikes;
            const pX = Math.cos(angle) * radius;
            const pY = Math.sin(angle) * radius;
            if (i === 0) ctx.moveTo(pX, pY);
            else ctx.lineTo(pX, pY);
        }
        ctx.closePath();
        const colors = ["#fef08a", "#ef4444", "#f97316"];
        ctx.fillStyle = colors[Math.floor(frameCount / 3) % colors.length];
        ctx.fill();
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#1c1917";
        ctx.stroke();
        ctx.restore();
    }

    _drawSwipePreview(game) {
        const ctx = this.ctx;

        // Fading slash marks left by completed cuts (Cut-the-Rope blade trail).
        for (const slash of game.fadingSlashes) {
            const trail = slash.trail || [slash.p1, slash.p2];
            this._drawBladeTrail(trail, slash.life);
        }

        // Live swipe preview while dragging (before the cut is committed).
        if (!game._swipeStart || !game._swipeEnd) return;
        const trail = game._swipeTrail && game._swipeTrail.length > 1
            ? game._swipeTrail
            : [game._swipeStart, game._swipeEnd];
        this._drawBladeTrail(trail, 1);
    }

    /**
     * Cut-the-Rope-style blade slash: a smooth, tapered line drawn in three
     * layered passes (soft halo, warm mid, white-hot core) so the swipe reads
     * as a knife cutting through air. `life` fades the whole slash out.
     */
    _drawBladeTrail(trail, life) {
        if (!trail || trail.length < 2 || life <= 0.02) return;
        const ctx = this.ctx;
        const pts = this._sampleSmooth(trail, 24);
        if (pts.length < 2) return;

        ctx.lineCap = "round";
        ctx.lineJoin = "round";
        // A red pass under the warm mid + white core so the slice is visible on
        // the cream paper; the alpha rides on `life` so it fades with the slash.
        const passes = [
            { width: 15, style: `rgba(239, 68, 68, ${(0.34 * life).toFixed(3)})` },
            { width: 9, style: `rgba(255, 214, 165, ${(0.55 * life).toFixed(3)})` },
            { width: 4, style: `rgba(255, 255, 255, ${(0.95 * life).toFixed(3)})` },
        ];
        const n = pts.length;
        for (const pass of passes) {
            ctx.strokeStyle = pass.style;
            for (let i = 0; i < n - 1; i++) {
                const u = i / (n - 1);
                // Blade profile: widest in the middle, tapering to points.
                ctx.lineWidth = Math.max(0.4, pass.width * Math.sin(Math.PI * u));
                ctx.beginPath();
                ctx.moveTo(pts[i].x, pts[i].y);
                ctx.lineTo(pts[i + 1].x, pts[i + 1].y);
                ctx.stroke();
            }
        }
    }

    /** Level-1 onboarding: a red cut line across the wick shows where to snip,
     *  and a hand slides back and forth along an INVISIBLE line parallel to the
     *  red line (offset toward the matchstick), with the finger rotated 90° so
     *  it points straight at the red line — the cut motion reads as a finger
     *  tracing the slice. Runs while the tutorial is up and stops after the
     *  player's first cut. */
    _drawTutorialDemo(game) {
        if (!game.tutorialActive) return;
        if (game.level?.level_id !== 1 || game.fuses.length < 1) return;
        if (game.snipsUsed > 0) return; // player got it — stop the demo

        const fuse = game.fuses[0];
        const p0 = fuse.startNode;
        const p3 = fuse.endNode;
        const ctx = this.ctx;
        const t = game.frameCount;

        // Red cut line (visible): a pulsing slash across the wick where the snip goes.
        const cutU = 0.42;
        const C = getBezierXY(cutU, p0, fuse.cp1, fuse.cp2, p3);
        const tanT = getBezierTangent(cutU, p0, fuse.cp1, fuse.cp2, p3);
        const perp = { x: -tanT.y, y: tanT.x };
        ctx.save();
        ctx.globalAlpha = 0.8 + Math.sin(t * 0.06) * 0.15;
        ctx.lineCap = "round";
        ctx.lineWidth = 5;
        ctx.strokeStyle = "#ef4444";
        ctx.beginPath();
        ctx.moveTo(C.x - perp.x * 27, C.y - perp.y * 27);
        ctx.lineTo(C.x + perp.x * 27, C.y + perp.y * 27);
        ctx.stroke();
        ctx.restore();

        // Hand: slide along the invisible parallel line, offset from the red line
        // toward the spawn/matchstick. The finger points at the red line the whole
        // time (perp to the travel), so it never runs along the line itself.
        const offset = 58;  // world units from the red line, along the wick
        const swipe = 24;   // travel distance along the parallel line
        const travel = 70;  // frames across
        const pause = 50;   // hold at each end
        const halfCycle = travel + pause;
        const phase = t % (2 * halfCycle);

        let off;
        if (phase < travel) off = -swipe + 2 * swipe * (phase / travel);
        else if (phase < halfCycle) off = swipe; // hold the far side
        else if (phase < halfCycle + travel) off = swipe - 2 * swipe * ((phase - halfCycle) / travel);
        else off = -swipe; // hold the near side

        const pos = { x: C.x + perp.x * off - tanT.x * offset, y: C.y + perp.y * off - tanT.y * offset };
        const fingerDir = { x: tanT.x, y: tanT.y }; // straight at the red line

        // Fade in as it appears and fade out just before looping back.
        let alpha = 1;
        if (t < 14) alpha = t / 14;
        if (t % (2 * halfCycle) > 2 * halfCycle - 16) alpha = Math.max(0, (2 * halfCycle - (t % (2 * halfCycle))) / 16);
        this._drawHandPointer(ctx, pos.x, pos.y, fingerDir, alpha);
    }

    /** Draw the pointer hand rotated so its finger points along `tan`, with its
     *  fingertip landing on (x, y). Same asset + offsets as the UFO puzzle. */
    _drawHandPointer(ctx, x, y, tan, alpha = 1) {
        const img = this._handImg;
        if (!img || !img.complete || img.height === 0) return;
        const box = this._handBBox || (this._handBBox = this._opaqueBBox(img));
        const bbox = box || { x: 0, y: 0, w: img.width, h: img.height };

        const ang = Math.atan2(tan.y, tan.x);
        const finger = Math.atan2(1, -1); // intrinsic finger direction in the sprite
        ctx.save();
        ctx.globalAlpha = alpha;
        ctx.translate(x, y);
        ctx.rotate(ang - finger);
        const size = 104;
        const s = Math.min(size / bbox.w, size / bbox.h);
        const w = bbox.w * s;
        const h = bbox.h * s;
        ctx.drawImage(img, bbox.x, bbox.y, bbox.w, bbox.h, 16 - w / 2, -6 - h / 2, w, h);
        ctx.restore();
    }

    /** Tight opaque bounding box of a transparent PNG (downscaled for speed).
     *  iOS getImageData can be flaky, so any failure falls back to full-image. */
    _opaqueBBox(img) {
        const nw = img.naturalWidth || img.width || 0;
        const nh = img.naturalHeight || img.height || 0;
        if (!nw || !nh) return null;
        const scale = Math.min(1, 360 / Math.max(nw, nh));
        const w = Math.max(1, Math.round(nw * scale));
        const h = Math.max(1, Math.round(nh * scale));
        try {
            const c = document.createElement("canvas");
            c.width = w;
            c.height = h;
            const cctx = c.getContext("2d");
            cctx.drawImage(img, 0, 0, w, h);
            const data = cctx.getImageData(0, 0, w, h).data;
            let minX = w, minY = h, maxX = 0, maxY = 0;
            for (let y = 0; y < h; y++) {
                for (let x = 0; x < w; x++) {
                    if (data[(y * w + x) * 4 + 3] > 12) {
                        if (x < minX) minX = x;
                        if (x > maxX) maxX = x;
                        if (y < minY) minY = y;
                        if (y > maxY) maxY = y;
                    }
                }
            }
            if (maxX >= minX) {
                return {
                    x: minX / scale,
                    y: minY / scale,
                    w: (maxX - minX + 1) / scale,
                    h: (maxY - minY + 1) / scale,
                };
            }
        } catch {
            /* fall through to null → full-image draw */
        }
        return null;
    }

    /** Smooth a raw pointer trail into `count` evenly-spaced points (quadratic
     *  midpoints smoothing, then resample by arc length). */
    _sampleSmooth(trail, count) {
        const n = trail.length;
        if (n < 2) return [];
        if (n === 2) return [{ ...trail[0] }, { ...trail[1] }];

        const pts = [];
        const push = (p) => pts.push({ x: p.x, y: p.y });
        push(trail[0]);

        const quad = (a, c, b) => {
            for (let s = 1; s <= 8; s++) {
                const u = s / 8;
                const u1 = 1 - u;
                push({
                    x: u1 * u1 * a.x + 2 * u1 * u * c.x + u * u * b.x,
                    y: u1 * u1 * a.y + 2 * u1 * u * c.y + u * u * b.y,
                });
            }
        };

        for (let i = 0; i < n - 2; i++) {
            const start = i === 0
                ? trail[0]
                : { x: (trail[i].x + trail[i + 1].x) / 2, y: (trail[i].y + trail[i + 1].y) / 2 };
            const end = { x: (trail[i + 1].x + trail[i + 2].x) / 2, y: (trail[i + 1].y + trail[i + 2].y) / 2 };
            quad(start, trail[i + 1], end);
        }
        const lastMid = { x: (trail[n - 2].x + trail[n - 1].x) / 2, y: (trail[n - 2].y + trail[n - 1].y) / 2 };
        quad(lastMid, trail[n - 1], trail[n - 1]);
        push(trail[n - 1]);

        return this._resampleEvenly(pts, count);
    }

    _resampleEvenly(pts, count) {
        const out = [{ ...pts[0] }];
        const seg = [];
        let total = 0;
        for (let i = 1; i < pts.length; i++) {
            const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
            seg.push(d);
            total += d;
        }
        if (!total) return out;
        let acc = 0;
        let si = 0;
        for (let k = 1; k < count - 1; k++) {
            const target = (k / (count - 1)) * total;
            while (si < seg.length - 1 && acc + seg[si] < target) {
                acc += seg[si];
                si++;
            }
            const frac = seg[si] ? Math.min(1, (target - acc) / seg[si]) : 0;
            const a = pts[si];
            const b = pts[si + 1];
            out.push({ x: a.x + (b.x - a.x) * frac, y: a.y + (b.y - a.y) * frac });
        }
        out.push({ ...pts[pts.length - 1] });
        return out;
    }

    /** Radial gradient that safely degrades to a no-op on stub contexts. */
    _radialGradient(x0, y0, r0, x1, y1, r1) {
        const fn = this.ctx.createRadialGradient;
        if (typeof fn !== "function") return { addColorStop() {} };
        const g = fn.call(this.ctx, x0, y0, r0, x1, y1, r1);
        return g || { addColorStop() {} };
    }

    /** Linear gradient that safely degrades to a no-op on stub contexts. */
    _linearGradient(x0, y0, x1, y1) {
        const fn = this.ctx.createLinearGradient;
        if (typeof fn !== "function") return { addColorStop() {} };
        const g = fn.call(this.ctx, x0, y0, x1, y1);
        return g || { addColorStop() {} };
    }
}
