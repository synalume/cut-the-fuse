// Renderer.js — all canvas drawing + dynamic asset loading.
// Preserves the prototype's draw order, styling, and state swapping.
import { getBezierXY, getBezierTangent } from "./MathUtils.js";
import { computeFitCamera } from "./LevelManager.js";

// Relative prefix so the game works from any subdirectory host (itch, Poki, Playables zips).
const ASSET_PREFIX = "assets/";

// Reaction words for the small character reactions. Picked deterministically by
// level + character so each level uses a different set, but never flickers.
export const REACTION_WORDS = {
    payloadDanger: ["AHH!", "HELP!", "PANIC!", "NOOO!", "YIKES!", "GULP!"],
    spawnLit: ["EEK!", "OH!", "HOT!", "YIKES!", "UH OH!", "HEY!"],
    spawnDud: ["?", "WHEW", "OK?", "PHEW", "SAFE", "..."],
};

// Comic words for the big win/lose beats. Picked per attempt (stored on the
// game state at _finishLevel) so the same level rotates through the set instead
// of always popping the same two words.
export const COMIC_WORDS = {
    won: ["PHEW!", "SAFE!", "WHEW!", "OFF!", "DODGED!", "CLEAR!"],
    lost: ["KABOOM!", "BOOM!", "BANG!", "BLAM!", "KERBOOM!", "WHAM!"],
};

/** Live-wire gradient stop sets, keyed by fuse color. Only the WIRE'S hue
 *  changes — the pulsing/drifting band, ember glow, retro spark and ash trail
 *  behave identically, and fire always stays amber so a red wire burning still
 *  reads as "red wire + orange fire". Colors follow real electrical wiring
 *  conventions: red = live/forbidden, blue/purple/green = neutral/ground (safe). */
const WIRE_STOPS = {
    amber: ["#f59e0b", "#fbbf24", "#d97706", "#b45309"],
    red: ["#ef4444", "#f87171", "#dc2626", "#991b1b"],
    fuchsia: ["#e879f9", "#d946ef", "#c026d3", "#a21caf"],
    blue: ["#3b82f6", "#60a5fa", "#2563eb", "#1e40af"],
    purple: ["#c084fc", "#a855f7", "#9333ea", "#7e22ce"],
    green: ["#22c55e", "#4ade80", "#16a34a", "#15803d"],
};
/** Fill colors for the legend chips (solid, slightly darker than the live stops). */
const WIRE_CHIP = {
    red: "#dc2626",
    fuchsia: "#c026d3",
    blue: "#2563eb",
    purple: "#9333ea",
    green: "#16a34a",
};
const WIRE_CHIP_BORDER = {
    red: "#7f1d1d",
    fuchsia: "#701a75",
    blue: "#1e3a8a",
    purple: "#581c87",
    green: "#14532d",
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
        this.images = {};
        // Sliding-hand demo pointer (level-1 onboarding) — same asset the UFO
        // puzzle animates along its hint path. Content bbox is computed lazily.
        this._handImg = new Image();
        this._handImg.src = ASSET_PREFIX + "ui/ui-hand-pointer.png";
        this._handBBox = null;
        this._pending = new Set();
        this._onAssetsReady = null;
        this._assetOk = new Map(); // src -> boolean (exists), cached per session
        // Home-screen ambient spark state (drawn while the hub is up).
        this._menuSparkLastT = null;
        this._menuParticles = [];
        this._menuPath = null; // organic closed loop (built lazily so it's random per visit)
        this.menuCard = null; // hub DOM element the spark weaves behind (wired by main.js)
        this.root = null; // #game-container the CSS shell sizes to match the canvas
        this.resize();
    }

    // ---- Responsive sizing ------------------------------------------------------

    /** Logical viewport size. Uses the VISUAL viewport so iOS Safari landscape's
     *  bottom toolbar (which is included in innerHeight) never clips bottom-
     *  anchored UI; falls back to innerWidth/innerHeight everywhere else. */
    _viewportSize() {
        const vv = window.visualViewport;
        if (vv && vv.width && vv.height) return { width: vv.width, height: vv.height };
        return { width: window.innerWidth, height: window.innerHeight };
    }

    resize() {
        const { width, height } = this._viewportSize();
        this.width = width;
        this.height = height;
        this.dpr = Math.max(1, window.devicePixelRatio || 1);
        this.canvas.width = Math.round(width * this.dpr);
        this.canvas.height = Math.round(height * this.dpr);
        this.canvas.style.width = width + "px";
        this.canvas.style.height = height + "px";
        // Keep the CSS app shell sized to the same visible viewport (fixes iOS
        // PWA/Safari where innerHeight can under-report or include browser
        // chrome, clipping the bottom row of UI). Root-level vars so every
        // modal can size itself against the real visible area.
        const root = typeof document !== "undefined" ? document.documentElement : null;
        if (root && root.style && typeof root.style.setProperty === "function") {
            root.style.setProperty("--app-w", width + "px");
            root.style.setProperty("--app-h", height + "px");
        }
        if (this.root) this.root.style.height = height + "px";
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
     *  missing per-level art file falls back to the placeholder set). Cached.
     *  Times out so a stalled request can never hang a level load — the
     *  placeholder set takes over after ASSET_PROBE_TIMEOUT_MS. */
    async hasAsset(name) {
        const src = ASSET_PREFIX + name;
        if (this._assetOk.has(src)) return this._assetOk.get(src);
        const ok = await new Promise((resolve) => {
            const img = new Image();
            let done = false;
            const finish = (v) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                resolve(v);
            };
            const timer = setTimeout(() => finish(false), 3000);
            img.onload = () => finish(true);
            img.onerror = () => finish(false);
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

        // Home screen (no level loaded yet): an ambient spark loops around and
        // behind the menu card. The hub pauses the game, so this animates on
        // wall-clock time — and the level's own rendering doesn't apply.
        if (!game.level) {
            this._drawMenuSpark();
            return;
        }

        ctx.save();
        // Camera transform (prototype). A wrong-wire offense jolts the level
        // for a moment so the denied cut reads as a physical "no".
        let jx = 0, jy = 0;
        const wo = game.wireOffenseAt;
        if (wo && game.frameCount >= wo.at && game.frameCount - wo.at < 18) {
            const amp = (1 - (game.frameCount - wo.at) / 18) * 7;
            jx = (Math.random() - 0.5) * amp;
            jy = (Math.random() - 0.5) * amp;
        }
        ctx.translate(this.width / 2, this.height / 2);
        ctx.scale(game.camera.zoom, game.camera.zoom);
        ctx.translate(-this.width / 2 + game.camera.x + jx, -this.height / 2 + game.camera.y + jy);

        this._drawHint(game);
        this._drawFuses(game);
        this._drawCuts(game);
        this._drawCutFlash(game);
        this._drawBranchFlares(game);
        // Spark effects draw before the assets so the burning head passes
        // behind the matchstick and banana, not over them.
        if (game.gameState === "playing") this._drawSparkEffects(game);
        this._drawWaterDrops(game);
        this._drawPickups(game);
        // The red link between twin bombs sits under the bomb art.
        this._drawPayloadLink(game);
        this._drawAssets(game);
        if (game.gameState === "lost") this._drawComicText(game, game.comicWord || "KABOOM!", "#ef4444", game.lostAt);
        if (game.gameState === "won") this._drawComicText(game, game.comicWord || "PHEW!", "#22c55e", game.wonAt);
        this._drawSwipePreview(game);
        this._drawSnipFeedback(game);
        // Onboarding demo hand rides on top of everything while the tutorial is up.
        this._drawTutorialDemo(game);

        ctx.restore();

        // Screen-space HUD: the color-coded wire legend (pinned near the top).
        this._drawWireLegend(game);
        // Red flash when a forbidden wire is cut — the level keeps running but
        // the denial must be obvious, not feel like a working snip.
        this._drawWireOffenseOverlay(game);
    }

    /** Home-screen ambient: a burning spark wanders a random organic loop and
     *  weaves BEHIND the menu card while the hub is up (no level loaded yet).
     *  The hub pauses the game, so frameCount is frozen — the whole effect runs
     *  on wall-clock time.
     *
     *  The burn matches the in-game wick exactly: an amber "live wire" sits
     *  AHEAD of the spark (hot at the burn front, cooling toward the far side)
     *  and a flat dark ash trail follows BEHIND it, so the spark chases the
     *  orange the way it chases the banana in play. The path is a random closed
     *  harmonic loop (not a figure-8) built once per visit, and it's drawn only
     *  on the game canvas — the opaque menu card hides whatever passes behind
     *  it, so the fire appears to weave in and out of the card. */
    _drawMenuSpark() {
        const ctx = this.ctx;
        const t = performance.now() / 16.667; // wall-clock "frames"

        if (!this._menuPath) this._buildMenuPath();
        const P = this._menuPath;

        // Closed loop built from a few random harmonics. All frequencies are
        // integers so the wire stays seamless across the u=0 seam, and the
        // coefficients are normalized so the loop stays within the base radii.
        const raw = (u) => {
            const th = u * Math.PI * 2;
            const nx = (Math.cos(th + P.p1) + P.c2 * Math.cos(2 * th + P.p2) + P.c3 * Math.cos(3 * th + P.p3)) * P.sx;
            const ny = (Math.sin(th + P.q1) + P.s2 * Math.sin(2 * th + P.q2) + P.s3 * Math.sin(3 * th + P.q3)) * P.sy;
            return { x: P.cx + nx * P.rx, y: P.cy + ny * P.ry };
        };
        const seed = 7;
        const at = (u) => {
            const p = raw(u);
            const tg = this._tangentAt(raw, u);
            const amp = 0.35 * Math.sin(u * 27 * Math.PI * 2 + seed) + 0.15 * Math.sin(u * 9 * Math.PI * 2 + seed * 2);
            return { x: p.x - tg.y * amp, y: p.y + tg.x * amp };
        };

        const loopFrames = 900; // one full orbit ≈ 15s
        const headU = (t / loopFrames) % 1;
        const head = at(headU);
        const drift = 0.15 * Math.sin(t * 0.05 + headU * 2);
        const dt = this._menuSparkLastT == null ? 1 : Math.max(0.2, Math.min(3, t - this._menuSparkLastT));
        this._menuSparkLastT = t;

        const S = { at, raw, headU, head, t, drift, seed };

        this._drawMenuBurn(ctx, S);
        this._drawMenuParticles(t, dt, head);
    }

    /** Build the random organic loop once per visit. Radii reach past the card
     *  edges so the fire is visible sweeping out into the paper, and the
     *  harmonics dip it back through the card's middle so it hides behind. */
    _buildMenuPath() {
        const rect = this._menuCardRect();
        const cx = rect.x + rect.w / 2;
        const cy = rect.y + rect.h / 2;
        const rx = Math.min(rect.w * 0.75, Math.max(rect.w * 0.55, this.width * 0.34));
        const ry = Math.min(rect.h * 0.75, Math.max(rect.h * 0.55, this.height * 0.38));
        const rand2 = () => (0.2 + Math.random() * 0.35) * (Math.random() > 0.5 ? 1 : -1);
        const rand3 = () => (0.08 + Math.random() * 0.22) * (Math.random() > 0.5 ? 1 : -1);
        const c2 = rand2(), c3 = rand3(), s2 = rand2(), s3 = rand3();
        const sx = 1 / (1 + Math.abs(c2) + Math.abs(c3));
        const sy = 1 / (1 + Math.abs(s2) + Math.abs(s3));
        this._menuPath = {
            cx, cy, rx, ry, c2, c3, s2, s3, sx, sy,
            p1: Math.random() * Math.PI * 2,
            p2: Math.random() * Math.PI * 2,
            p3: Math.random() * Math.PI * 2,
            q1: Math.random() * Math.PI * 2,
            q2: Math.random() * Math.PI * 2,
            q3: Math.random() * Math.PI * 2,
        };
    }

    /** Bounding box of the card the spark weaves around (logical CSS px). Falls
     *  back to a centered box when no card is wired up (headless/stub context). */
    _menuCardRect() {
        if (this.menuCard && typeof this.menuCard.getBoundingClientRect === "function") {
            const r = this.menuCard.getBoundingClientRect();
            if (r.width > 0 && r.height > 0) return { x: r.x, y: r.y, w: r.width, h: r.height };
        }
        const w = Math.min(440, this.width * 0.6);
        const h = Math.min(520, this.height * 0.7);
        return { x: (this.width - w) / 2, y: (this.height - h) / 2, w, h };
    }

    /** Unit tangent to the raw path at u (numerical, handles the periodic wrap). */
    _tangentAt(raw, u) {
        const a = raw(u);
        const b = raw(u + 0.003);
        const dx = b.x - a.x, dy = b.y - a.y;
        const len = Math.hypot(dx, dy) || 1;
        return { x: dx / len, y: dy / len };
    }

    /** The in-game live-wire amber ramp, sampled per-point by distance ahead of
     *  the spark: hot at the burn front, cooling toward the far side. */
    _menuAmberColor(d, drift) {
        const stops = [
            [0.0, 245, 158, 11], // #f59e0b
            [0.35 + drift, 251, 191, 36], // #fbbf24
            [0.65 + drift, 217, 119, 6], // #d97706
            [1.0, 180, 83, 9], // #b45309
        ];
        let i = 1;
        while (i < stops.length - 1 && d > stops[i][0]) i++;
        const [t0, r0, g0, b0] = stops[i - 1];
        const [t1, r1, g1, b1] = stops[i];
        const f = t1 === t0 ? 0 : Math.min(1, Math.max(0, (d - t0) / (t1 - t0)));
        const mix = (a, b) => Math.round(a + (b - a) * f);
        return `rgb(${mix(r0, r1)}, ${mix(g0, g1)}, ${mix(b0, b1)})`;
    }

    /** Intersect two circular arcs [a0,a1] and [b0,b1] (either may wrap around
     *  u=1). Returns a list of non-wrapping [start,end] ranges, or null. */
    _arcIntersect(a0, a1, b0, b1) {
        const norm = (x) => ((x % 1) + 1) % 1;
        const ranges = (s, e) => {
            s = norm(s);
            e = norm(e);
            return s <= e ? [[s, e]] : [[s, 1], [0, e]];
        };
        const out = [];
        for (const [s1, e1] of ranges(a0, a1)) {
            for (const [s2, e2] of ranges(b0, b1)) {
                const s = Math.max(s1, s2);
                const e = Math.min(e1, e2);
                if (e - s > 1e-4) out.push([s, e]);
            }
        }
        return out.length ? out : null;
    }

    /** Draw the menu wick using the exact in-game visuals: amber live wire
     *  ahead of the spark, dark ash trail behind, ember glow at the burn front,
     *  retro spark head. */
    _drawMenuBurn(ctx, S) {
        const { at, raw, headU, head, t, drift, seed } = S;
        const n = 160;

        ctx.save();
        ctx.lineCap = "round";
        ctx.lineJoin = "round";

        // Soft glow pass over the whole loop (matches the wire's shadow).
        ctx.shadowColor = "rgba(249, 115, 22, 0.5)";
        ctx.shadowBlur = 6;
        ctx.strokeStyle = "rgba(245, 158, 11, 0.5)";
        ctx.lineWidth = 4.5;
        ctx.beginPath();
        for (let i = 0; i <= n; i++) {
            const p = at(i / n);
            if (i === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
        }
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Crisp amber wire, colored per-point by distance ahead of the spark.
        ctx.lineWidth = 4.5;
        for (let i = 0; i < n; i++) {
            const sa = i / n;
            const sb = sa + 1 / n;
            const d = (((sa % 1) + 1) % 1 - headU + 1) % 1;
            ctx.strokeStyle = this._menuAmberColor(d, drift);
            ctx.beginPath();
            const pa = at(sa);
            const pb = at(sb);
            ctx.moveTo(pa.x, pa.y);
            ctx.lineTo(pb.x, pb.y);
            ctx.stroke();
        }

        // Dark ash trail: the short arc just burned behind the spark.
        const ashLen = 0.10;
        const ashArc = this._arcIntersect(headU - ashLen, headU, 0, 1);
        if (ashArc) {
            ctx.strokeStyle = "rgba(41, 37, 36, 0.85)";
            ctx.lineWidth = 3;
            for (const [as0, as1] of ashArc) {
                const an = Math.max(6, Math.ceil((as1 - as0) * 160));
                ctx.beginPath();
                for (let i = 0; i <= an; i++) {
                    const u = as0 + ((as1 - as0) * i) / an;
                    const p0 = raw(u);
                    const tg = this._tangentAt(raw, u);
                    const amp = Math.sin(u * 41 * Math.PI * 2 + seed * 1.7) * 1.1 + Math.sin(u * 13 * Math.PI * 2 + seed) * 0.5;
                    const p = { x: p0.x - tg.y * amp, y: p0.y + tg.x * amp };
                    if (i === 0) ctx.moveTo(p.x, p.y);
                    else ctx.lineTo(p.x, p.y);
                }
                ctx.stroke();
            }
        }

        // Ember glow + spark head at the burn front (game look).
        const ember = this._radialGradient(head.x, head.y, 0, head.x, head.y, 16);
        ember.addColorStop(0, "rgba(254, 240, 138, 0.9)");
        ember.addColorStop(0.35, "rgba(249, 115, 22, 0.55)");
        ember.addColorStop(1, "rgba(249, 115, 22, 0)");
        ctx.fillStyle = ember;
        ctx.beginPath();
        ctx.arc(head.x, head.y, 16, 0, Math.PI * 2);
        ctx.fill();

        this._drawRetroSpark(head.x, head.y, t);
        ctx.restore();
    }

    /** Game-style dark ash flecks trailing the menu spark. */
    _drawMenuParticles(t, dt, head) {
        const list = this._menuParticles;
        // Spawn like the game's burn: ~60% chance per frame of a dark fleck.
        if (Math.random() > 0.4) {
            list.push({
                x: head.x, y: head.y,
                vx: (Math.random() - 0.5) * 2.8,
                vy: (Math.random() - 0.5) * 2.8,
                life: 1.0,
                size: Math.random() * 4 + 2,
                color: "#292524",
            });
        }
        for (let i = list.length - 1; i >= 0; i--) {
            const p = list[i];
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            p.life -= 0.04 * dt;
            if (p.life <= 0) list.splice(i, 1);
        }
        for (const p of list) this._drawParticleStar(p);
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

        // Glowing green crosshairs on the exact [x,y] cut targets. Targets are
        // precomputed per level (game.hintTargets) so a marker never sits on a
        // forbidden wire: forbidden decoys get none, and a safe wick sharing a
        // crossroad with a decoy has its marker slid onto the clear part of
        // its own line.
        const seen = new Set();
        const drawCrosshair = (pt) => {
            const key = `${pt.x.toFixed(1)},${pt.y.toFixed(1)}`;
            if (seen.has(key)) return;
            seen.add(key);

            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 25, 0, Math.PI * 2);
            ctx.strokeStyle = "rgba(34, 197, 94, 0.8)";
            ctx.lineWidth = 3;
            ctx.stroke();

            ctx.beginPath();
            ctx.moveTo(pt.x - 35, pt.y);
            ctx.lineTo(pt.x + 35, pt.y);
            ctx.moveTo(pt.x, pt.y - 35);
            ctx.lineTo(pt.x, pt.y + 35);
            ctx.stroke();
        };

        if (game.hintTargets) {
            for (const { point } of game.hintTargets) drawCrosshair(point);
        } else {
            for (const fuse of game.fuses) drawCrosshair(fuse.intersectionPt);
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

                // A branch wick renders like any live wick — the fork is meant
                // to be a subtle Y-split the player has to look for, not a
                // highlighted feature. The one exception is a DUD: if the parent
                // died before the fork, the branch is near-black and settled —
                // it was never going to light.
                const spark = game.sparks[fIdx];
                const parentSpark = spark && spark.chain ? game.sparks[spark.chain.fromFuseIndex] : null;
                const unlitBranch = spark && spark.chain && !spark.triggered && !spark.ignited;
                if (unlitBranch && parentSpark && !parentSpark.active) {
                    ctx.beginPath();
                    ctx.strokeStyle = "#44403c";
                    ctx.lineWidth = 3;
                    ctx.moveTo(wob(0).x, wob(0).y);
                    for (let u = 0.02; u <= 1; u += 0.02) {
                        const pt = wob(u);
                        ctx.lineTo(pt.x, pt.y);
                    }
                    ctx.stroke();
                    continue;
                }

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
                // A waiting branch has no spark yet — no ember, so the fork stays
                // unmarked until the parent's fire actually reaches it.
                if (!unlitBranch) {
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
    }

    /** Water drops: a droplet rides each doused fuse at its douse point. When
     *  the spark arrives it snuffs there (blue splash particles do the rest). */
    _drawWaterDrops(game) {
        const ctx = this.ctx;
        for (const d of game.level?.douse || []) {
            const fuse = d.fuseIndex != null ? game.fuses[d.fuseIndex] : null;
            if (!fuse) continue;
            const pos = getBezierXY(d.at, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
            const spark = game.sparks[d.fuseIndex];
            const gone = spark && (!spark.active || spark.progress >= d.at);

            ctx.save();
            ctx.translate(pos.x, pos.y);
            if (gone) {
                // Extinguished: the droplet shrinks and fades.
                const t = Math.max(0, 1 - ((game.frameCount - spark.diedAt) / 60));
                ctx.globalAlpha = 0.4 * t;
                ctx.scale(0.6 + 0.4 * t, 0.6 + 0.4 * t);
            } else {
                ctx.globalAlpha = 0.95;
                ctx.rotate(Math.sin(game.frameCount * 0.08 + pos.x * 0.01) * 0.1);
            }
            const bob = Math.sin(game.frameCount * 0.09 + pos.x * 0.02) * 1.2;
            ctx.translate(0, bob);
            // Teardrop: a circle body + a pointy top, blue with a white sheen.
            const grad = this._radialGradient(-2, -2, 0, 0, 0, 9);
            grad.addColorStop(0, "#dbeafe");
            grad.addColorStop(0.5, "#60a5fa");
            grad.addColorStop(1, "#2563eb");
            ctx.fillStyle = grad;
            ctx.beginPath();
            ctx.moveTo(0, -10);
            ctx.quadraticCurveTo(8, -3, 8, 2);
            ctx.arc(0, 2, 8, 0, Math.PI);
            ctx.quadraticCurveTo(-8, -3, 0, -10);
            ctx.closePath();
            ctx.fill();
            ctx.lineWidth = 1.4;
            ctx.strokeStyle = "rgba(30, 58, 138, 0.85)";
            ctx.stroke();
            ctx.fillStyle = "rgba(255,255,255,0.85)";
            ctx.beginPath();
            ctx.arc(-2.5, -1.5, 2, 0, Math.PI * 2);
            ctx.fill();
            ctx.restore();
        }
    }

    /** Gold pickup stars: a bonus snip banks when a cut's circle touches one.
     *  Uncollected stars pulse with a sparkle; collected ones leave the burst. */
    _drawPickups(game) {
        const ctx = this.ctx;
        for (const p of game.pickups || []) {
            if (p.collected) continue;
            const pulse = 1 + Math.sin(game.frameCount * 0.12 + p.x * 0.02) * 0.12;
            this._drawGoldStar(ctx, p.x, p.y, 11, pulse);
        }
        // Collected sparkle trail fades out on the bonus popups.
        for (const b of game.bonusSnipsAt || []) {
            const t = game.frameCount - b.at;
            if (t < 0 || t > 45) continue;
            const alpha = Math.max(0, 1 - t / 45);
            for (let i = 0; i < 5; i++) {
                const a = (i / 5) * Math.PI * 2 + game.frameCount * 0.05;
                const r = 8 + t * 0.6;
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = "#fbbf24";
                ctx.beginPath();
                ctx.arc(b.x + Math.cos(a) * r, b.y + Math.sin(a) * r, 2.2, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            }
        }
    }

    /** A chunky 5-point gold star (Luckiest-Guy-friendly cartoon shape). */
    _drawGoldStar(ctx, x, y, r, scale = 1) {
        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(x * 0.03) * 0.1);
        ctx.scale(scale, scale);
        ctx.beginPath();
        for (let i = 0; i < 10; i++) {
            const ang = (i * Math.PI) / 5 - Math.PI / 2;
            const rad = i % 2 === 0 ? r : r * 0.45;
            const px = Math.cos(ang) * rad;
            const py = Math.sin(ang) * rad;
            if (i === 0) ctx.moveTo(px, py);
            else ctx.lineTo(px, py);
        }
        ctx.closePath();
        ctx.fillStyle = "#f59e0b";
        ctx.fill();
        ctx.lineJoin = "round";
        ctx.lineWidth = 2;
        ctx.strokeStyle = "#78350f";
        ctx.stroke();
        // Gleam on the top facet.
        ctx.fillStyle = "rgba(254, 243, 199, 0.9)";
        ctx.beginPath();
        ctx.arc(-r * 0.2, -r * 0.28, r * 0.18, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }

    /** Screen-space legend for color-coded wire levels: a centered card near
     *  the top showing which colors are SAFE to cut (✓) and which are traps
     *  (✗). Pinned under the header so the player reads it once and traces
     *  before sniping. Scales down only when the row would overflow a narrow
     *  portrait screen. */
    _drawWireLegend(game) {
        const wr = game.level?.wireRule;
        if (!wr || !wr.legend) return;
        const ctx = this.ctx;
        const colors = Object.keys(wr.legend);

        // Compact chip row: colored boxes with a ✓ (safe) / ✗ (forbidden)
        // mark. No card, no title, no labels — just the chips, centered under
        // the star counter so the play field stays clear on small screens.
        const chip = 22;
        const gap = 8;
        const rowW = colors.length * chip + (colors.length - 1) * gap;
        const scale = Math.min(1, (this.width - 24) / (rowW + 4));
        const x0 = (this.width - rowW * scale) / 2;
        const y0 = 58;

        ctx.save();
        ctx.translate(x0, y0);
        ctx.scale(scale, scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        for (let i = 0; i < colors.length; i++) {
            const c = colors[i];
            const safe = wr.legend[c] === "cut";
            const x = i * (chip + gap);
            ctx.fillStyle = WIRE_CHIP[c] || "#78716c";
            ctx.beginPath();
            this._roundRectPath(ctx, x, 0, chip, chip, 6);
            ctx.fill();
            ctx.lineWidth = 1.6;
            ctx.strokeStyle = WIRE_CHIP_BORDER[c] || "#1c1917";
            ctx.stroke();
            ctx.font = "700 16px 'Baloo 2', 'Luckiest Guy', 'Courier New', Courier, monospace";
            ctx.fillStyle = "#ffffff";
            ctx.fillText(safe ? "✓" : "✗", x + chip / 2, chip / 2 + 1);
        }
        ctx.restore();
    }

    /** Red flash when a forbidden wire is cut: a quick screen-edge vignette that
     *  fades out over ~30 frames. Paired with the red denied slash, the camera
     *  jolt and the "WRONG WIRE!" popup so the first offense — which denies the
     *  cut but keeps the level running — can never read as a working snip. */
    _drawWireOffenseOverlay(game) {
        const o = game.wireOffenseAt;
        if (!o) return;
        const t = game.frameCount - o.at;
        if (t < 0 || t > 30) return;
        const ctx = this.ctx;
        const a = Math.max(0, 1 - t / 30);
        const grad = ctx.createRadialGradient(
            this.width / 2, this.height / 2, this.height * 0.2,
            this.width / 2, this.height / 2, this.height * 0.78
        );
        grad.addColorStop(0, `rgba(239, 68, 68, ${(a * 0.16).toFixed(3)})`);
        grad.addColorStop(1, `rgba(153, 27, 27, ${(a * 0.3).toFixed(3)})`);
        ctx.fillStyle = grad;
        ctx.fillRect(0, 0, this.width, this.height);
    }

    /** Gradient along the live wire: hot at the burn front, cooling toward the
     *  payload. A slow drift of the hot band reads as energy flowing (replaces
     *  the bright traveling slug). Colored wires hue-shift only the stops —
     *  the behavior (drift, banding) is identical to the classic amber wire. */
    _liveWireGradient(game, fuse, wob, burnt) {
        const hot = wob(Math.max(0.001, burnt));
        const cool = wob(1);
        const grad = this._linearGradient(hot.x, hot.y, cool.x, cool.y);
        const drift = 0.15 * Math.sin(game.frameCount * 0.05 + burnt * 2);
        const stops = WIRE_STOPS[fuse.color] || WIRE_STOPS.amber;
        grad.addColorStop(0, stops[0]);
        grad.addColorStop(0.35 + drift, stops[1]);
        grad.addColorStop(0.65 + drift, stops[2]);
        grad.addColorStop(1, stops[3]);
        return grad;
    }

    /** Fork junctions get no marker — the branch wick simply splits off the
     *  parent's wick, so the fork reads as a subtle Y the player has to look
     *  for. The only thing drawn here is a soft flare the moment the branch
     *  lights: the payoff when the parent's fire reaches the fork. */
    _drawBranchFlares(game) {
        const ctx = this.ctx;
        for (let i = 0; i < game.sparks.length; i++) {
            const spark = game.sparks[i];
            if (!spark.chain) continue;
            const node = game.fuses[spark.fuseIndex].startNode;
            if (!node || node.type !== "branch") continue;

            // Junction flare the moment the branch lights.
            if (spark.triggered && spark.ignited && spark.ignitedAt != null && game.frameCount - spark.ignitedAt < 25) {
                const grad = this._radialGradient(node.x, node.y, 0, node.x, node.y, 26);
                grad.addColorStop(0, "rgba(254, 240, 138, 0.9)");
                grad.addColorStop(0.4, "rgba(249, 115, 22, 0.55)");
                grad.addColorStop(1, "rgba(249, 115, 22, 0)");
                ctx.fillStyle = grad;
                ctx.beginPath();
                ctx.arc(node.x, node.y, 26, 0, Math.PI * 2);
                ctx.fill();
            }
        }
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

    /** Twin bombs are linked: if one goes off, the other does too. A red wick
     *  sags between the two payloads so that shared fate reads at a glance —
     *  the same forbidden-red visual language as the decoy wires. Purely
     *  decorative: it is not in game.fuses, so it can't be cut. */
    _drawPayloadLink(game) {
        const payloads = (game.nodes || []).filter((n) => n.type === "payload");
        if (payloads.length < 2) return;
        const ctx = this.ctx;
        const p0 = payloads[0];
        const p1 = payloads[1];

        // Gentle sag perpendicular to the chord so it reads as a wick, not a
        // ruler line.
        const mx = (p0.x + p1.x) / 2;
        const my = (p0.y + p1.y) / 2;
        const dx = p1.x - p0.x;
        const dy = p1.y - p0.y;
        const len = Math.hypot(dx, dy) || 1;
        const sag = 10;
        const cx = mx - (dy / len) * sag;
        const cy = my + (dx / len) * sag;

        // Quadratic-bezier point + unit tangent, sampled like a fuse curve so
        // the burnt link can wear the same organic ash wobble as every wick.
        const qPoint = (u) => {
            const mt = 1 - u;
            return {
                x: mt * mt * p0.x + 2 * mt * u * cx + u * u * p1.x,
                y: mt * mt * p0.y + 2 * mt * u * cy + u * u * p1.y,
            };
        };
        const qTangent = (u) => {
            const mt = 1 - u;
            const tx = 2 * mt * (cx - p0.x) + 2 * u * (p1.x - cx);
            const ty = 2 * mt * (cy - p0.y) + 2 * u * (p1.y - cy);
            const l = Math.hypot(tx, ty) || 1;
            return { x: tx / l, y: ty / l };
        };

        ctx.save();
        ctx.lineCap = "round";
        const lost = game.gameState === "lost";
        const stops = WIRE_STOPS.red;
        if (lost) {
            // Twin bombs burnt out together — the link chars like a real wick:
            // flat ash with the same deterministic organic wobble as _drawFuses.
            const seed = [...String(game.level.level_id + ":" + p0.id)].reduce((s, ch) => s + ch.charCodeAt(0), 0);
            const ashAt = (u) => {
                const pt = qPoint(u);
                const t = qTangent(u);
                const amp = Math.sin(u * 41 + seed * 1.7) * 1.1 + Math.sin(u * 13 + seed) * 0.5;
                return { x: pt.x - t.y * amp, y: pt.y + t.x * amp };
            };
            ctx.beginPath();
            ctx.strokeStyle = "rgba(41, 37, 36, 0.85)";
            ctx.lineWidth = 3;
            ctx.moveTo(ashAt(0).x, ashAt(0).y);
            for (let u = 0.02; u <= 1; u += 0.02) {
                const at = ashAt(u);
                ctx.lineTo(at.x, at.y);
            }
            ctx.stroke();
            // A few ash flecks settle along the dead line.
            for (let i = 0; i < 6; i++) {
                const u = (i + 1) / 7;
                const at = ashAt(u);
                ctx.fillStyle = "rgba(41, 37, 36, 0.5)";
                ctx.beginPath();
                ctx.arc(at.x, at.y, 1.3, 0, Math.PI * 2);
                ctx.fill();
            }
            ctx.restore();
            return;
        }

        const pulse = 0.5 + 0.5 * Math.sin(game.frameCount * 0.05);
        ctx.shadowColor = "rgba(220, 38, 38, 0.55)";
        ctx.shadowBlur = 5 + 5 * pulse;
        const grad = ctx.createLinearGradient(p0.x, p0.y, p1.x, p1.y);
        grad.addColorStop(0, stops[0]);
        grad.addColorStop(0.5, stops[1]);
        grad.addColorStop(1, stops[3]);
        ctx.strokeStyle = grad;
        ctx.lineWidth = 4;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.quadraticCurveTo(cx, cy, p1.x, p1.y);
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Small energy ticks flowing along the link (the shared fuse alive).
        const steps = 6;
        for (let i = 0; i < steps; i++) {
            const t = ((game.frameCount * 0.004) + i / steps) % 1;
            const pt = qPoint(t);
            const alpha = 0.35 + 0.3 * Math.sin(t * Math.PI);
            ctx.fillStyle = `rgba(254, 226, 226, ${alpha.toFixed(3)})`;
            ctx.beginPath();
            ctx.arc(pt.x, pt.y, 1.8, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.restore();
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
        else if (game.gameState === "lost") {
            // Twin bombs mirror each other: when one detonates, they ALL show
            // the fail art + blast (they're wired together — one going off
            // takes the rest down).
            src = game.level.payloadAssets.lose;
        }

        const img = this._img(ASSET_PREFIX + src);
        if (!img) return;

        ctx.save();
        ctx.translate(node.x, node.y);

        let scaleX = 1;
        let scaleY = 1;
        let rot = 0;
        let dy = 0;
        // The payload faces the majority of its own matchsticks — when the bomb
        // is pushed off-center (offset/train layouts, or twin bombs) it should
        // look at the spawns that threaten IT. Art is drawn facing +x, so flip
        // when the spawn mass sits to the left.
        const spawns = game.nodes.filter((n) => n.type === "spawn" && game.fuses.some((f) => f.startNode === n && f.endNode === node));
        const mass = spawns.length ? spawns : game.nodes.filter((n) => n.type === "spawn");
        const flipX = mass.length ? (mass.reduce((s, n) => s + n.x, 0) / mass.length < node.x ? -1 : 1) : 1;

        const bombLost = game.gameState === "lost"; // twin bombs fail together
        if (game.gameState === "playing") {
            rot = Math.sin(game.frameCount * 0.1) * 0.05;
        } else if (bombLost && game.lostAt != null) {
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
        ctx.scale(scaleX * flipX, scaleY);
        ctx.translate(0, dy);

        // Twin bombs are drawn smaller so both fit the frame comfortably.
        const targetHeight = (game.level.payloads && game.level.payloads.length > 1) ? 118 : 150;
        const aspect = img.width / img.height;
        const targetWidth = targetHeight * aspect;

        ctx.drawImage(img, -targetWidth / 2, -targetHeight / 2, targetWidth, targetHeight);
        ctx.restore();

        // Dramatic reaction word above the banana — pops in the moment a spark
        // that threatens THIS bomb lights, fades out, and reappears on fail.
        // Each payload only panics for its own incoming sparks (twin bombs).
        const threatened = (s) => s.active && s.ignited && s.ignitedAt != null && s.progress < 1
            && game.fuses[s.fuseIndex]?.endNode === node;
        if (game.gameState === "playing") {
            let latestIgnite = -1;
            for (const s of game.sparks) {
                if (threatened(s)) latestIgnite = Math.max(latestIgnite, s.ignitedAt);
            }
            if (latestIgnite >= 0) {
                this._drawReactionText(
                    game, node,
                    pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.payloadDanger),
                    "#ef4444", 40, -128, latestIgnite, REACTION_SHOW_FRAMES
                );
            }
        } else if (bombLost && game.lostAt != null) {
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
        ctx.font = "26px 'Luckiest Guy', 'Courier New', Courier, monospace";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = 7;
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
        } else if (spark && spark.active && spark.ignited) {
            src = assets.ignition;
        }

        const img = this._img(ASSET_PREFIX + src);
        if (!img) return;

        // Every matchstick faces the level's center line: art is drawn facing
        // +x, so spawns on the LEFT of the payload keep facing right (toward
        // center) and spawns on the RIGHT flip to face left. With twin bombs,
        // each matchstick faces the payload it actually feeds.
        const fuse = fuseIndex >= 0 ? game.fuses[fuseIndex] : null;
        const payloadNode = fuse ? fuse.endNode : game.nodes.find((n) => n.type === "payload");
        const flip = payloadNode ? node.x > payloadNode.x : false;

        ctx.save();
        ctx.translate(node.x, node.y);
        ctx.scale(flip ? -1 : 1, 1);
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
            if (!spark.active || !spark.ignited) continue;
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

    /** Onboarding for the snip budget. Two cues:
     *  - Grey denied slash + "NO MORE SNIPS!" when the player swipes with nothing
     *    left — the swipe visibly registers but reads as "no cut", so hitting
     *    the limit never feels like the game stopped responding.
     *  - A brief "LAST SNIP!" heads-up right after spending the second-to-last cut.
     *  A wrong-wire offense also lands here: a bold RED slash + X so the denied
     *  cut reads as a warning, not a working snip. */
    _drawSnipFeedback(game) {
        const ctx = this.ctx;

        if (game.wireDeniedSlash && game.wireDeniedSlash.life > 0.02) {
            const d = game.wireDeniedSlash;
            const mx = (d.start.x + d.end.x) / 2;
            const my = (d.start.y + d.end.y) / 2;
            ctx.save();
            ctx.lineCap = "round";
            ctx.globalAlpha = 0.9 * d.life;
            ctx.lineWidth = 11 * d.life + 2;
            ctx.strokeStyle = "#dc2626";
            ctx.beginPath();
            ctx.moveTo(d.start.x, d.start.y);
            ctx.lineTo(d.end.x, d.end.y);
            ctx.stroke();
            // Red X at the middle of the swipe marks it as a denied cut.
            ctx.lineWidth = 5;
            ctx.strokeStyle = `rgba(220, 38, 38, ${(0.95 * d.life).toFixed(3)})`;
            const r = 9 * d.life + 2;
            ctx.beginPath();
            ctx.moveTo(mx - r, my - r);
            ctx.lineTo(mx + r, my + r);
            ctx.moveTo(mx + r, my - r);
            ctx.lineTo(mx - r, my + r);
            ctx.stroke();
            ctx.restore();
        }

        if (game.deniedSlash && game.deniedSlash.life > 0.02) {
            const d = game.deniedSlash;
            const mx = (d.start.x + d.end.x) / 2;
            const my = (d.start.y + d.end.y) / 2;
            ctx.save();
            ctx.lineCap = "round";
            // Grey slash, clearly not a live cut.
            ctx.globalAlpha = 0.4 * d.life;
            ctx.lineWidth = 14 * d.life;
            ctx.strokeStyle = "#9ca3af";
            ctx.beginPath();
            ctx.moveTo(d.start.x, d.start.y);
            ctx.lineTo(d.end.x, d.end.y);
            ctx.stroke();
            // Red X at the middle of the swipe marks it as denied.
            ctx.lineWidth = 4;
            ctx.strokeStyle = `rgba(220, 38, 38, ${(0.9 * d.life).toFixed(3)})`;
            const r = 7 * d.life;
            ctx.beginPath();
            ctx.moveTo(mx - r, my - r);
            ctx.lineTo(mx + r, my + r);
            ctx.moveTo(mx + r, my - r);
            ctx.lineTo(mx - r, my + r);
            ctx.stroke();
            ctx.restore();
        }

        // Announcement popups (NO MORE SNIPS! / LAST SNIP! / PERFECT! / +N).
        // Collected and drawn together so each gets its own vertical lane and
        // popups fired by the same cut (perfect + last-snip + multi-cut) never
        // stack on top of each other.
        this._drawPopupWords(game);
    }

    /** Every announcement popup active this frame with its natural vertical
     *  lane. Lanes are spaced for the worst-case pop overshoot so popups fired
     *  by the SAME cut — a perfect snip that's also the last snip and/or a
     *  multi-cut — never overlap: +N sits highest, then LAST SNIP!, then
     *  PERFECT!, then NO MORE SNIPS!. */
    _activePopupWords(game) {
        const active = (at, dur) => at != null && game.frameCount >= at && game.frameCount - at < dur;
        const out = [];
        if (game.wireOffenseAt && active(game.wireOffenseAt.at, 75)) {
            out.push({ kind: "word", text: "WRONG WIRE!", color: "#ef4444", x: game.wireOffenseAt.x, y: game.wireOffenseAt.y, size: 27, at: game.wireOffenseAt.at, duration: 75, dy: -52 });
        }
        if (game.noSnipsAt && active(game.noSnipsAt.at, 85)) {
            out.push({ kind: "word", text: "NO MORE SNIPS!", color: "#ef4444", x: game.noSnipsAt.x, y: game.noSnipsAt.y, size: 24, at: game.noSnipsAt.at, duration: 85, dy: -26 });
        }
        if (game.deadCutAt && active(game.deadCutAt.at, 70)) {
            out.push({ kind: "word", text: "ALREADY CUT!", color: "#9ca3af", x: game.deadCutAt.x, y: game.deadCutAt.y, size: 20, at: game.deadCutAt.at, duration: 70, dy: -36 });
        }
        if (game.lastSnipAt != null) {
            const last = game.cuts[game.cuts.length - 1];
            if (last && active(game.lastSnipAt, 70)) {
                out.push({ kind: "word", text: "LAST SNIP!", color: "#d97706", x: last.x, y: last.y, size: 22, at: game.lastSnipAt, duration: 70, dy: -78 });
            }
        }
        for (const p of game.perfectSnipsAt || []) {
            if (active(p.at, 65)) out.push({ kind: "word", text: "PERFECT!", color: "#16a34a", x: p.x, y: p.y, size: 21, at: p.at, duration: 65, dy: -38 });
        }
        for (const mk of game.multikills || []) {
            if (active(mk.at, 55)) out.push({ kind: "bank", text: `+${mk.count}`, count: mk.count, x: mk.x, y: mk.y, size: 30 + mk.count * 5, at: mk.at, duration: 55, dy: -140 });
        }
        // Gold star banked: a bonus snip pops at the star in a warm gold.
        for (const b of game.bonusSnipsAt || []) {
            if (active(b.at, 70)) {
                out.push({ kind: "word", text: "SNIP +1", color: "#d97706", x: b.x, y: b.y, size: 22, at: b.at, duration: 70, dy: -44 });
            }
        }
        return out;
    }

    /** World-space boxes of reaction words currently on screen — the payload's
     *  danger word ("AHH!") and each matchstick's panic/dud chatter — so the
     *  announcement popups climb above them instead of writing over the chatter. */
    _activeReactionObstacles(game) {
        const out = [];
        const lit = (at, dur) => at != null && game.frameCount >= at && game.frameCount - at < dur;
        const payloads = game.nodes?.filter((n) => n.type === "payload") || [];
        for (const payload of payloads) {
            let latestIgnite = -1;
            for (const s of game.sparks || []) {
                if (s.active && s.ignited && s.ignitedAt != null && s.progress < 1
                    && game.fuses[s.fuseIndex]?.endNode === payload) {
                    latestIgnite = Math.max(latestIgnite, s.ignitedAt);
                }
            }
            if (latestIgnite >= 0 && lit(latestIgnite, REACTION_SHOW_FRAMES)) {
                out.push({ text: pickReactionWord(game.level.level_id, payload.id, REACTION_WORDS.payloadDanger), x: payload.x, y: payload.y - 128, size: 40 });
            }
        }
        for (const node of game.nodes || []) {
            if (node.type !== "spawn") continue;
            const fuseIndex = game.fuses.findIndex((f) => f.start === node.id);
            const spark = fuseIndex >= 0 ? game.sparks[fuseIndex] : null;
            if (spark && spark.active && spark.ignited && lit(spark.ignitedAt, REACTION_SHOW_FRAMES)) {
                out.push({ text: pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.spawnLit), x: node.x, y: node.y - 58, size: 22 });
            }
            if (spark && !spark.active && lit(spark.diedAt, 60)) {
                out.push({ text: pickReactionWord(game.level.level_id, node.id, REACTION_WORDS.spawnDud), x: node.x, y: node.y - 58, size: 26 });
            }
        }
        return out;
    }

    /** Draw announcement popups with per-frame collision resolution. Popups
     *  keep their natural lane; if any two overlap (e.g. a cut near a lingering
     *  popup or an active reaction word), the later-spawned one climbs above
     *  the earlier one so text never sits on top of text. Half-heights are
     *  padded to the pop overshoot. */
    _drawPopupWords(game) {
        const popups = this._activePopupWords(game);
        if (!popups.length) return;

        const ctx = this.ctx;
        const box = (text, size) => {
            const halfH = size * 0.62 * 1.4;
            ctx.font = `${size}px 'Luckiest Guy', 'Courier New', Courier, monospace`;
            return { halfH, halfW: ctx.measureText(text).width / 2 };
        };

        // Reaction words already on screen count as placed obstacles; the
        // announcement popups climb above any they'd collide with.
        const placed = this._activeReactionObstacles(game).map((o) => ({ x: o.x, y: o.y, ...box(o.text, o.size) }));

        // Oldest first: earlier popups keep their spot; later ones climb over
        // anything they'd collide with.
        popups.sort((a, b) => a.at - b.at);

        for (const p of popups) {
            const { halfH, halfW } = box(p.text, p.size);
            let ty = p.y + p.dy;
            for (const q of placed) {
                if (Math.abs(q.x - p.x) > q.halfW + halfW + 14) continue; // horizontally clear
                if (ty + halfH <= q.y - q.halfH) continue; // already above, clear
                if (ty - halfH < q.y + q.halfH) ty = q.y - q.halfH - halfH - 10; // overlapping → climb above
            }
            placed.push({ x: p.x, y: ty, halfW, halfH });

            if (p.kind === "bank") this._drawBankCount(game, p, ty);
            else this._drawPopupWord(game, p.text, p.color, p.x, ty, p.size, p.at, p.duration);
        }
    }

    /** Small comic word popping at an arbitrary world point — same poster style
     *  as the KABOOM!/PHEW! words but smaller, for game-state messages like the
     *  snip budget. Fades in, holds with a wobble, fades out. */
    _drawPopupWord(game, text, color, x, y, size, atFrame, duration) {
        if (atFrame == null) return;
        const elapsed = game.frameCount - atFrame;
        if (elapsed < 0 || elapsed > duration) return;
        const ctx = this.ctx;

        // Clamp to the visible frame like the comic words.
        let ty = y;
        const cam = game.camera;
        const sy = this.height / 2 + (ty - (this.height / 2 - cam.y)) * cam.zoom;
        if (sy < 70) ty += (70 - sy) / cam.zoom;

        const pop = 1.18 - 0.18 * Math.exp(-elapsed * 5);
        const wobble = Math.sin(game.frameCount * 0.16) * 0.05 * Math.min(1, elapsed / 10);

        ctx.save();
        ctx.globalAlpha = Math.min(1, elapsed / 6) * Math.min(1, (duration - elapsed) / 12);
        ctx.translate(x, ty);
        ctx.rotate(-0.06 + wobble);
        ctx.scale(pop, pop);
        ctx.font = `${size}px 'Luckiest Guy', 'Courier New', Courier, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(5, size * 0.24);
        ctx.strokeStyle = "#1c1917";
        ctx.strokeText(text, 0, 0);
        ctx.fillStyle = color;
        ctx.fillText(text, 0, 0);
        ctx.restore();
    }

    /** Big Fluff-style banking counter for a multi-cut: a big gold "+N" that
     *  pops in with overshoot, floats up, and fades — the dopamine hit for
     *  slicing several wicks with one snip. `y` is the collision-resolved lane. */
    _drawBankCount(game, mk, y) {
        if (mk.at == null) return;
        const elapsed = game.frameCount - mk.at;
        if (elapsed < 0 || elapsed > 55) return;
        const ctx = this.ctx;

        let ty = y;
        const cam = game.camera;
        const sy = this.height / 2 + (ty - (this.height / 2 - cam.y)) * cam.zoom;
        if (sy < 70) ty += (70 - sy) / cam.zoom;

        const pop = 1.35 - 0.35 * Math.exp(-elapsed * 5);
        const float = Math.min(22, elapsed * 0.45); // rises as it fades
        const wobble = Math.sin(game.frameCount * 0.14) * 0.06 * Math.min(1, elapsed / 10);
        const size = 30 + mk.count * 5;

        ctx.save();
        ctx.globalAlpha = Math.min(1, elapsed / 5) * Math.min(1, (55 - elapsed) / 14);
        ctx.translate(mk.x, ty - float);
        ctx.rotate(-0.05 + wobble);
        ctx.scale(pop, pop);
        ctx.font = `${size}px 'Luckiest Guy', 'Courier New', Courier, monospace`;
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(6, size * 0.22);
        ctx.strokeStyle = "#1c1917";
        ctx.strokeText(`+${mk.count}`, 0, 0);
        ctx.fillStyle = "#f59e0b";
        ctx.fillText(`+${mk.count}`, 0, 0);
        ctx.restore();
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
        // Wall-clock "frames" so the demo hand keeps sliding while the tutorial
        // freezes the simulation (game.frameCount is held on teach levels).
        const t = performance.now() / 16.667;

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
    _radialGradient(x0, y0, r0, x1, y1, r1) {        const fn = this.ctx.createRadialGradient;
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

    /** Rounded-rect path with a fallback for browsers without ctx.roundRect. */
    _roundRectPath(ctx, x, y, w, h, r) {
        if (typeof ctx.roundRect === "function") {
            ctx.roundRect(x, y, w, h, r);
            return;
        }
        ctx.rect(x, y, w, h);
    }
}
