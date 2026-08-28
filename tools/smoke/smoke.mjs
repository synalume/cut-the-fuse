// tools/smoke/smoke.mjs — repeatable headless verification of the core engine.
// Run: npm run smoke   (or: node tools/smoke/smoke.mjs)
//
// Part A — engine sweep (pure Node):
//   1. levels.json structural validation → 0 warnings
//   2. winnability sweep: every level, cut all chokepoints, sparks must all die → WON
//   3. snips budget: snipsAllowed >= distinct chokepoints (geometry-derived minimum)
//   4. DDA tier ladder + star scoring unit checks
//   5. camera fit: level center lands at screen center (prototype convention)
// Part B — DOM boot test (stubbed browser surface, real render path):
//   6. import main.js; assert Level 1 boots, tutorial shows, swipe cut works,
//      the game loop runs to WON, and the win modal + save fire.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));

let failures = 0;
function check(ok, label, extra = "") {
    if (ok) console.log(`  ✓ ${label}`);
    else {
        failures++;
        console.error(`  ✗ ${label}${extra ? " — " + extra : ""}`);
    }
}

// rAF queue so the boot test can drive the real loop deterministically.
const rafQueue = [];
globalThis.requestAnimationFrame = (cb) => (rafQueue.push(cb), rafQueue.length);
globalThis.cancelAnimationFrame = () => {};

// ---------------------------------------------------------------------------
// Part A — engine sweep
// ---------------------------------------------------------------------------
import { buildLevel, validateLevel, computeFitCamera, resolveAssets } from "../../src/engine/LevelManager.js";
import { GameLoop, STATE } from "../../src/engine/GameLoop.js";

function makeStubs() {
    const renderer = {
        width: 1280,
        height: 720,
        computeFitCamera: (level) => computeFitCamera(level, { width: 1280, height: 720 }),
        draw() {},
    };
    const audio = { play() {}, startLoop() {}, stopLoop() {} };
    const analytics = { track() {} };
    const platform = { gameplayStart() {}, gameplayStop() {} };
    return { renderer, audio, analytics, platform };
}

/** Place a cut at every fuse's chokepoint (deduped like the in-game 30px rule),
 *  then simulate. Returns { ok, reason }. */
function sweepLevel(config) {
    const level = buildLevel(config, { width: 1280, height: 720 });
    const game = new GameLoop({ canvas: null, ...makeStubs() });
    game.loadLevel(level, 0);

    const placed = [];
    for (const fuse of level.fuses) {
        const p = fuse.intersectionPt;
        const dup = placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 30);
        if (!dup) placed.push({ x: p.x, y: p.y });
    }
    if (placed.length > config.snipsAllowed) {
        return { ok: false, reason: `needs ${placed.length} chokepoint cuts but snipsAllowed=${config.snipsAllowed}` };
    }
    for (const p of placed) game.cuts.push({ x: p.x, y: p.y, radius: 15, angle: 0, fuseId: null });

    for (let i = 0; i < 6000; i++) {
        game.frameCount++;
        game._update();
        if (game.gameState !== STATE.PLAYING) break;
    }
    if (game.gameState === STATE.WON) return { ok: true };
    return { ok: false, reason: `ended state=${game.gameState} after ${game.frameCount} frames` };
}

console.log("\n[A] Structural validation + winnability sweep");
const lvl1 = buildLevel(levels[0], { width: 1280, height: 720 });

let warns = 0;
for (const c of levels) for (const msg of validateLevel(c)) warns++;
check(warns === 0, `validateLevel: 0 warnings across ${levels.length} levels`, `(${warns} warnings)`);

check(lvl1.fuses.length === 1 && lvl1.sparks.length === 1, "Level 1 has one fuse and one spark");
check(
    Math.hypot(
        lvl1.fuses[0].intersectionPt.x - (lvl1.fuses[0].startNode.x + lvl1.fuses[0].endNode.x) / 2,
        lvl1.fuses[0].intersectionPt.y - (lvl1.fuses[0].startNode.y + lvl1.fuses[0].endNode.y) / 2
    ) < 0.001,
    "Level 1 fuse forced intersection sits at t=0.5 (midpoint)"
);

let swept = 0;
for (const c of levels) {
    const res = sweepLevel(c);
    if (res.ok) swept++;
    else console.error(`  ✗ L${c.level_id} not winnable: ${res.reason}`);
}
check(swept === levels.length, `winnability sweep: all ${levels.length} levels winnable via chokepoints`);

// Shared-chokepoint regression: levels route several wicks through the same
// intersection (e.g. L4's cut1). The 2nd snip at the same spot must hit the
// OTHER fuse, not be deduped into a no-op by the first cut.
{
    const cfg = levels.find((l) => l.level_id === 4);
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(buildLevel(cfg, { width: 1280, height: 720 }), 0);
    const cp = g.level.intersectionMap.cut1;

    const swipe = () => {
        const ok = g.tryCut(
            { x: cp.x - 26, y: cp.y },
            { x: cp.x + 26, y: cp.y },
            [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
        );
        return ok;
    };

    check(swipe() === true && g.cuts.length === 1 && g.snipsRemaining === 1,
        "L4: first snip at shared chokepoint lands (1 snip left)");
    check(swipe() === true && g.cuts.length === 2 && g.snipsRemaining === 0,
        "L4: 2nd snip in the same area hits the other fuse (2 cuts placed)");
    check(g.cuts[0].fuseId !== g.cuts[1].fuseId,
        "L4: both snips cut different fuses at the shared chokepoint");
    check(swipe() === false && g.cuts.length === 2,
        "L4: 3rd snip is rejected (both fuses already cut + budget spent)");
}

// Asset resolution: placeholder reuse when a level's art file is missing
// (placeholder-first: banana bomb + matchstick on every level until art exists).
{
    const missing = async () => false;
    const lvl2 = await resolveAssets(levels[1], missing);
    check(lvl2.payloadAssets.playing === "lvl1_banana_panic.png", "L2 bomb falls back to banana placeholder", lvl2.payloadAssets.playing);
    check(lvl2.spawnAssets.idle === "lvl1_matchstick_idle.png", "L2 matchstick falls back to placeholder", lvl2.spawnAssets.idle);
    const lvl3 = await resolveAssets(levels[2], missing);
    check(lvl3.payloadAssets.playing === "lvl1_banana_panic.png", "L3 bomb falls back to banana placeholder", lvl3.payloadAssets.playing);
    const present = async (name) => name === "lvl5_bomb_win.png";
    const lvl5 = await resolveAssets(levels[4], present);
    check(lvl5.payloadAssets.win === "lvl5_bomb_win.png", "Per-level art picked up when file exists", lvl5.payloadAssets.win);
    check(lvl5.payloadAssets.playing === "lvl1_banana_panic.png", "Missing state still falls back to placeholder", lvl5.payloadAssets.playing);
}

// Camera fit convention: screen center (w/2, h/2) must map to the level center.
{
    const cam = computeFitCamera(lvl1, { width: 1280, height: 720 });
    const centerX = (lvl1.nodes[0].x + lvl1.nodes[1].x) / 2;
    const centerY = (lvl1.nodes[0].y + lvl1.nodes[1].y) / 2;
    const worldAtScreenCenter = { x: 1280 / 2 - cam.x, y: 720 / 2 - cam.y };
    check(
        Math.hypot(worldAtScreenCenter.x - centerX, worldAtScreenCenter.y - centerY) < 1,
        `camera fit centers the level (cam=${JSON.stringify(cam)})`
    );
    // Every node must land inside the viewport after the draw transform.
    const onScreen = lvl1.nodes.every((n) => {
        const sx = 640 + cam.zoom * (n.x - (640 - cam.x));
        const sy = 360 + cam.zoom * (n.y - (360 - cam.y));
        return sx > 0 && sx < 1280 && sy > 0 && sy < 720;
    });
    check(onScreen, "camera fit keeps every node on screen");

    // Regression guard: with 5 layout archetypes, all 60 levels must keep every
    // node on screen AND the ladder must stay visually diverse.
    let allFit = true;
    let worst = "";
    for (const c of levels) {
        const lvl = buildLevel(c, { width: 1280, height: 720 });
        const c2 = computeFitCamera(lvl, { width: 1280, height: 720 });
        const ok = lvl.nodes.every((n) => {
            const sx = 640 + c2.zoom * (n.x - (640 - c2.x));
            const sy = 360 + c2.zoom * (n.y - (360 - c2.y));
            return sx > -2 && sx < 1282 && sy > -2 && sy < 722;
        });
        if (!ok) { allFit = false; worst = `L${c.level_id}`; }
    }
    check(allFit, "camera fit: every node on screen for all 60 levels", worst);

    const payloadSpots = new Set(levels.map((l) => `${l.payload.x},${l.payload.y}`));
    check(payloadSpots.size >= 10, `layout diversity: bomb not always centered (${payloadSpots.size} distinct positions)`, [...payloadSpots].slice(0, 6).join(" | "));

    const layouts = new Set(levels.map((l) => l.layout || "hub"));
    check(layouts.size >= 4, `layout diversity: multiple archetypes used (${[...layouts].join(", ")})`);

    // Visual-identity guard: levels must not be rotations of each other. We
    // fingerprint each level by its spawn SHAPE relative to the bomb (angular
    // spread + the two biggest gaps), so clustered/paired/void/asym layouts
    // count as distinct even at the same difficulty.
    const shapeSig = (l) => {
        const angs = l.spawns.map((s) => Math.atan2(s.y - l.payload.y, s.x - l.payload.x)).sort((a, b) => a - b);
        const spread = Math.max(...angs) - Math.min(...angs);
        const gaps = angs
            .map((a, i) => (i === angs.length - 1 ? angs[0] + Math.PI * 2 : angs[i + 1]) - a)
            .sort((a, b) => b - a);
        return `${Math.round(spread / (Math.PI / 6))}|${Math.round(gaps[0] / (Math.PI / 10))}|${Math.round((gaps[1] || 0) / (Math.PI / 10))}`;
    };
    const shapeSigs = new Set(levels.map(shapeSig));
    check(shapeSigs.size >= 35, `visual identity: levels aren't just rotations (${shapeSigs.size} distinct spawn-shapes of ${levels.length})`);

    // Timing-texture guard: same-budget levels should still schedule sparks
    // differently (delay rhythm + burn pace are part of a level's feel).
    const timingSigs = new Set(
        levels.map((l) => {
            const delays = [...l.fuses.map((f) => f.delayFrames)].sort((a, b) => a - b).join(",");
            const speeds = [...new Set(l.fuses.map((f) => f.speed))].sort().join(",");
            return `${delays}|${speeds}`;
        })
    );
    check(timingSigs.size >= 40, `timing texture: delay rhythms + burn paces vary (${timingSigs.size} distinct of ${levels.length})`);

    // Wick folds: the forced-intersection cubic doubles back when the chokepoint's
    // projection onto the spawn->bomb chord leaves the segment (spark reversal —
    // the "wick overlaps itself / spark turns back" bug). Guard both the fold and
    // the cut-dedupe trap (a direct fuse midpoint landing within 30px of a
    // chokepoint makes the level unwinnable).
    const proj = (s, e, I) => {
        const wx = e.x - s.x, wy = e.y - s.y, L2 = wx * wx + wy * wy;
        const cp = { x: (I.x - 0.125 * (s.x + e.x)) / 0.75, y: (I.y - 0.125 * (s.y + e.y)) / 0.75 };
        return ((cp.x - s.x) * wx + (cp.y - s.y) * wy) / L2;
    };
    let folds = 0;
    for (const c of levels) {
        const sMap = Object.fromEntries(c.spawns.map((s) => [s.id, s]));
        const iMap = Object.fromEntries(c.intersections.map((i) => [i.id, i]));
        for (const f of c.fuses) {
            if (!f.routeThrough) continue;
            const u = proj(sMap[f.start], c.payload, iMap[f.routeThrough]);
            if (u < 0.02 || u > 0.98) folds++;
        }
    }
    check(folds === 0, `no wick folds: every routed fuse monotonic (${folds} folded)`);

    let tooClose = 0;
    for (const c of levels) {
        const sMap = Object.fromEntries(c.spawns.map((s) => [s.id, s]));
        const pts = c.intersections.map((i) => ({ x: i.x, y: i.y }));
        for (const f of c.fuses) {
            if (!f.routeThrough) pts.push({ x: (sMap[f.start].x + c.payload.x) / 2, y: (sMap[f.start].y + c.payload.y) / 2 });
        }
        for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++)
                if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 30) tooClose++;
    }
    check(tooClose === 0, `cut points separated: every chokepoint/direct-midpoint cut is placeable (${tooClose} collisions)`);
}

// DDA tier ladder
{
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(lvl1, 0);
    const baseSnips = g.snipsRemaining;
    const baseSpeed = g.sparks[0].speed;
    const calls = [];
    g.onDdaTierChanged = (tier, offer) => calls.push({ tier, offer });

    g.failCount = 2;
    g.offerDdaIfNeeded();
    check(calls.length === 0, "DDA: no offer below failThreshold (2 fails)");

    g.failCount = 3;
    g.offerDdaIfNeeded();
    check(calls.length === 1 && calls[0].offer === true, "DDA: offer raised at failThreshold");

    g.acceptDda();
    check(g.ddaTier === 1 && g.snipsRemaining === baseSnips + 1, "DDA tier 1 = +1 snip");

    g.acceptDda();
    check(g.ddaTier === 2 && g.sparks[0].speed === baseSpeed * 0.7, "DDA tier 2 = sparks slowed");

    g.acceptDda();
    check(g.ddaTier === 3 && g.hintActive === true, "DDA tier 3 = auto-hint");

    g.acceptDda();
    check(g.ddaTier === 3 && g.snipsRemaining === baseSnips + 1, "DDA: capped at max tier");
}

// Star scoring
{
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(lvl1, 0);
    g.snipsRemaining = 1;
    check(g.computeStars() === 3, "Stars: 1+ snips left → 3★");
    g.snipsRemaining = 0;
    g.snipsUsed = 2;
    check(g.computeStars() === 2, "Stars: all snips used → 2★");
}

// ---------------------------------------------------------------------------
// Part B — DOM boot test (main.js end-to-end)
// ---------------------------------------------------------------------------
console.log("\n[B] DOM boot — main.js end-to-end");

class El {
    constructor(id) {
        this.id = id;
        this.style = {};
        this.textContent = "";
        this.title = "";
        this.className = "";
        this._innerHTML = "";
        this.children = [];
        this.listeners = {};
        this.complete = true;
        this.height = 800;
        this.width = 800;
        this._src = "";
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) { this._innerHTML = v; }
    set src(v) { this._src = v; this.complete = true; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, e) { for (const fn of this.listeners[t] ?? []) fn(e); }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { this.children.push(...c); }
    focus() {}
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    classList = { toggle() {}, add() {}, remove() {} };
}

const elements = {};
const canvasEl = new El("game-canvas");
elements["game-canvas"] = canvasEl;

const doc = {
    getElementById: (id) => (elements[id] ??= new El(id)),
    createElement: () => new El("auto"),
    addEventListener() {},
    hidden: false,
};
const ctx2d = new Proxy(
    { measureText: () => ({ width: 10 }) },
    {
        get(t, p) { return p in t ? t[p] : () => {}; },
        set(t, p, v) { t[p] = v; return true; },
    }
);
canvasEl.getContext = () => ctx2d;

const win = {
    innerWidth: 1280,
    innerHeight: 720,
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    AudioContext: undefined,
    webkitAudioContext: undefined,
};

globalThis.window = win;
globalThis.document = doc;
globalThis.Image = El;
globalThis.localStorage = (() => {
    const m = new Map();
    return {
        getItem: (k) => (m.has(k) ? m.get(k) : null),
        setItem: (k, v) => m.set(k, String(v)),
        removeItem: (k) => m.delete(k),
    };
})();
globalThis.fetch = async () => ({
    json: async () => levels,
    arrayBuffer: async () => new ArrayBuffer(8),
});
Object.defineProperty(globalThis, "navigator", {
    value: { sendBeacon: () => true, userAgent: "smoke" },
    configurable: true,
    writable: true,
});

let bootError = null;
try {
    await import("../../src/main.js?boot=" + Date.now());
    await new Promise((r) => setTimeout(r, 80));
} catch (e) {
    bootError = e;
}
check(!bootError, "main.js boots without exceptions", bootError ? String(bootError?.stack || bootError) : "");

if (!bootError) {
    check(elements["level-label"].textContent === "LEVEL 1", "Boot: resumes at Level 1");
    check(/SNIPS: 3/.test(elements["snips-counter"].textContent), "Boot: snips counter = 3 (geometry-derived)", elements["snips-counter"].textContent);
    check(elements["tutorial-overlay"].style.display === "flex", "Boot: Level 1 tutorial overlay shown");

    // Dismiss the tutorial, then swipe through the fuse's chokepoint (screen center).
    elements["tutorial-next"].dispatch("click", {});
    check(elements["tutorial-overlay"].style.display === "none", "Boot: tutorial dismiss works");

    const mk = (clientX, clientY) => ({ pointerId: 1, button: 0, pointerType: "mouse", clientX, clientY, preventDefault() {} });
    canvasEl.dispatch("pointerdown", mk(620, 360));
    canvasEl.dispatch("pointermove", mk(660, 360));
    canvasEl.dispatch("pointerup", mk(660, 360));
    check(/SNIPS: 2/.test(elements["snips-counter"].textContent), "Boot: swipe cut consumed a snip", elements["snips-counter"].textContent);

    // Drive the real loop: spark burns toward the cut, dies, all sparks snuffed → WON.
    let frame = 0;
    let t = 0;
    let outcome = "timeout";
    while (rafQueue.length && frame < 6000) {
        const cb = rafQueue.shift();
        t += 16.67;
        cb(t);
        frame++;
        if (elements["modal-win"].style.display === "block") {
            outcome = "win-modal";
            break;
        }
        if (elements["modal-lose"].style.display === "block") {
            outcome = "lose-modal";
            break;
        }
    }
    check(outcome === "win-modal", `Boot: loop reaches WON in ${frame} frames`, outcome);
    check(elements["win-stars"].children.length === 3, "Boot: win modal renders 3 star slots", String(elements["win-stars"].children.length));
    // Star reveal: with a 3-star clear all stars end lit (dim removed in sequence).
    await new Promise((r) => setTimeout(r, 700));
    const lit = [...elements["win-stars"].children].filter((s) => s.className !== "dim").length;
    check(lit === 3, "Boot: all 3 stars light on a 3-star clear", String(lit));
    // Star icon is now a CSS background image; the counter text is the number only.
    check(elements["star-display"].textContent.trim() === "3", "Boot: star bank credited 3★", elements["star-display"].textContent);

    // Level selector
    elements["level-label"].dispatch("click", {});
    check(elements["modal-levels"].style.display === "flex", "Selector: click level label opens the map");
    check(elements["level-grid"].children.length === 60, "Selector: grid renders all 60 levels", String(elements["level-grid"].children.length));
    check(elements["level-grid"].children[0].children[0]?.textContent === "01", "Selector: level numbers rendered", elements["level-grid"].children[0].children[0]?.textContent);
    check(elements["level-grid"].children[0].children[1]?.textContent === "★★★", "Selector: earned stars shown per level", elements["level-grid"].children[0].children[1]?.textContent);
    const cell3 = elements["level-grid"].children[2];
    cell3.dispatch("click", {});
    await new Promise((r) => setTimeout(r, 60));
    check(elements["level-label"].textContent.startsWith("LEVEL 3"), "Selector: clicking a cell loads that level", elements["level-label"].textContent);
    check(elements["modal-levels"].style.display === "none", "Selector: modal closes after picking a level");
}

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
