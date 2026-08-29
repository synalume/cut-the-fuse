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
import { getBezierXY } from "../../src/engine/MathUtils.js";
import { SaveManager } from "../../src/engine/SaveManager.js";

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
    check(g.cutFlashes.length === 1 && g.cutFlashes[0].life === 1,
        "L4: snip spawns a cut flash (vivid slash burst)");
    check(swipe() === true && g.cuts.length === 2 && g.snipsRemaining === 0,
        "L4: 2nd snip in the same area hits the other fuse (2 cuts placed)");
    check(g.cuts[0].fuseId !== g.cuts[1].fuseId,
        "L4: both snips cut different fuses at the shared chokepoint");
    check(swipe() === false && g.cuts.length === 2,
        "L4: 3rd snip is rejected (both fuses already cut + budget spent)");
}

// Snip-budget onboarding: the LAST SNIP! heads-up fires when dropping to 1, and
// a swipe with 0 snips spawns denied feedback instead of silently doing nothing.
{
    const cfg = levels.find((l) => l.level_id === 1);
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(buildLevel(cfg, { width: 1280, height: 720 }), 0);
    const f = g.fuses[0];
    const mid = f.intersectionPt;
    const swipe = () => g.tryCut({ x: mid.x - 20, y: mid.y }, { x: mid.x + 20, y: mid.y }, []);

    g.snipsRemaining = 2; // one cut away from the final snip
    check(swipe() === true && g.snipsRemaining === 1 && g.lastSnipAt != null,
        "budget: dropping to 1 snip fires the LAST SNIP! heads-up");
    check(g.noSnipsAt == null,
        "budget: no NO-MORE-SNIPS feedback while snips remain");

    g.frameCount = 50;
    g.snipsRemaining = 0;
    check(g.notifyNoSnips({ x: 0, y: 0 }, { x: 50, y: 50 }) === true
        && g.deniedSlash && g.noSnipsAt,
        "budget: swipe with 0 snips spawns denied feedback");
    g.frameCount = 51;
    g._update(); // denied slash decays
    check(g.deniedSlash.life < 1,
        "budget: denied slash decays over frames");

    g.frameCount = 80; // 30 frames after the last cue — inside the 45-frame throttle
    check(g.notifyNoSnips({ x: 0, y: 0 }, { x: 50, y: 50 }) === false,
        "budget: denied feedback throttled (~0.75s)");
}

// Asset resolution: placeholder reuse when a level's art file is missing
// (placeholder-first). Priority: explicit level-pinned art > the player's
// loadout skin art > the placeholder set.
{
    const missing = async () => false;
    const lvl2 = await resolveAssets(levels[1], missing);
    check(lvl2.payloadAssets.playing === "lvl1_banana_panic.png", "L2 bomb falls back to banana placeholder", lvl2.payloadAssets.playing);
    check(lvl2.spawnAssets.idle === "lvl1_matchstick_idle.png", "L2 matchstick falls back to placeholder", lvl2.spawnAssets.idle);
    const lvl3 = await resolveAssets(levels[2], missing);
    check(lvl3.payloadAssets.playing === "lvl1_banana_panic.png", "L3 bomb falls back to banana placeholder", lvl3.payloadAssets.playing);

    // Loadout: the selected skin's art is used when the file exists.
    const hasMelon = async (name) => name === "skin_melon_playing.png";
    const melon = await resolveAssets(levels[1], hasMelon, { payloadSkin: "melon" });
    check(melon.payloadAssets.playing === "skin_melon_playing.png", "Loadout skin art picked up when file exists", melon.payloadAssets.playing);
    check(melon.payloadAssets.win === "lvl1_banana_win.png", "Missing skin frame falls back to placeholder", melon.payloadAssets.win);

    // Igniter loadout + per-frame fallback.
    const hasLighter = async (name) => name === "skin_lighter_idle.png";
    const lighter = await resolveAssets(levels[1], hasLighter, { igniter: "lighter" });
    check(lighter.spawnAssets.idle === "skin_lighter_idle.png", "Loadout igniter picked up when file exists", lighter.spawnAssets.idle);
    check(lighter.spawnAssets.dud === "lvl1_matchstick_dud.png", "Missing igniter frame falls back to placeholder", lighter.spawnAssets.dud);

    // Explicit level-pinned art always wins over the loadout.
    const pinned = { ...levels[1], payload: { ...levels[1].payload, assets: { playing: "special_bomb.png" } } };
    const lvlPinned = await resolveAssets(pinned, missing, { payloadSkin: "melon" });
    check(lvlPinned.payloadAssets.playing === "special_bomb.png", "Level-pinned art overrides the loadout", lvlPinned.payloadAssets.playing);

    // Unknown loadout ids resolve to the defaults.
    const unknown = await resolveAssets(levels[1], missing, { payloadSkin: "nope", igniter: "nope" });
    check(
        unknown.payloadAssets.playing === "lvl1_banana_panic.png" && unknown.spawnAssets.idle === "lvl1_matchstick_idle.png",
        "Unknown loadout ids fall back to defaults"
    );
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

    // Act-1 teaching band must not all read as the same sunburst — the early
    // levels (L4-L10, shared-chokepoint band) previously forced the same visual
    // recipe (uniform/even/flat) and all looked identical.
    {
        const earlySigs = new Set(levels.filter((l) => l.level_id >= 4 && l.level_id <= 10).map(shapeSig));
        check(earlySigs.size >= 5, `act-1 variety: L4-L10 use distinct maze arrangements (${earlySigs.size} distinct of 7)`);
    }

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
            const s = f.branchOf ? f.branchPoint : sMap[f.start];
            if (!s) continue;
            const u = proj(s, c.payload, iMap[f.routeThrough]);
            if (u < 0.02 || u > 0.98) folds++;
        }
    }
    check(folds === 0, `no wick folds: every routed fuse monotonic (${folds} folded)`);

    let tooClose = 0;
    for (const c of levels) {
        const sMap = Object.fromEntries(c.spawns.map((s) => [s.id, s]));
        const pts = c.intersections.map((i) => ({ x: i.x, y: i.y }));
        for (const f of c.fuses) {
            if (!f.routeThrough) {
                const s = f.branchOf ? f.branchPoint : sMap[f.start];
                if (s) pts.push({ x: (s.x + c.payload.x) / 2, y: (s.y + c.payload.y) / 2 });
            }
        }
        for (let i = 0; i < pts.length; i++)
            for (let j = i + 1; j < pts.length; j++)
                if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < 30) tooClose++;
    }
    check(tooClose === 0, `cut points separated: every chokepoint/direct-midpoint cut is placeable (${tooClose} collisions)`);

    // Single endpoint + in-frame tails: every wick must end at the payload
    // CENTER (one continuous line into the banana), and its curve must stay
    // on the viewport. The bomb-side "entry" anchors made some wicks end on a
    // hidden ring — thin parts of the banana silhouette exposed the tips (the
    // "disconnect" at the banana) and big tail bows swung past the bomb and
    // off-screen. Both are regressions to guard against.
    {
        let badEnds = [];
        for (const c of levels) {
            for (const f of c.fuses) {
                if (f.end !== c.payload.id) badEnds.push(`L${c.level_id}:${f.id}->${f.end}`);
            }
        }
        check(badEnds.length === 0, "single endpoint: every wick ends at the payload center", badEnds.join(", "));

        let offWicks = [];
        let farWicks = [];
        for (const c of levels) {
            const lvl = buildLevel(c, { width: 1280, height: 720 });
            const cam = computeFitCamera(lvl, { width: 1280, height: 720 });
            const toX = (p) => 640 + cam.zoom * (p.x - (640 - cam.x));
            const toY = (p) => 360 + cam.zoom * (p.y - (360 - cam.y));
            const pay = lvl.nodeMap[c.payload.id];
            for (const f of lvl.fuses) {
                let maxD = 0;
                for (let t = 0; t <= 1; t += 0.02) {
                    const p = getBezierXY(t, f.startNode, f.cp1, f.cp2, f.endNode);
                    maxD = Math.max(maxD, Math.hypot(p.x - pay.x, p.y - pay.y));
                    const X = toX(p), Y = toY(p);
                    if (X < -8 || X > 1288 || Y < -8 || Y > 728) {
                        offWicks.push(`L${c.level_id}:${f.id}@t${t.toFixed(2)}(${Math.round(X)},${Math.round(Y)})`);
                        break;
                    }
                }
                if (maxD > 560) farWicks.push(`L${c.level_id}:${f.id}=${Math.round(maxD)}px`);
            }
        }
        check(offWicks.length === 0, "no wick curve leaves the viewport (tail bows stay in-frame)", offWicks.join(", "));
        check(farWicks.length === 0, "no wick curve drifts past the bomb (single-endpoint tails)", farWicks.join(", "));

        // Shared-chokepoint divergence: wicks routed through the SAME crossroad
        // share a control point, so if any two carry the SAME bulge their final
        // legs are identical overlapping curves — the "bunch" that reads as a
        // disconnected blob at the banana. Each wick in a group must carry a
        // distinct value so the tails fan apart and enter the bomb separately.
        let bunched = [];
        for (const c of levels) {
            const byCp = new Map();
            for (const f of c.fuses) {
                if (!f.routeThrough) continue;
                if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
                byCp.get(f.routeThrough).push(f);
            }
            for (const [cpId, grp] of byCp) {
                if (grp.length < 2) continue;
                const seen = new Set();
                for (const f of grp) {
                    const key = String(f.bulge ?? 0);
                    if (seen.has(key)) bunched.push(`L${c.level_id}:${cpId} ${f.id} bulge=${key}`);
                    seen.add(key);
                }
            }
        }
        check(bunched.length === 0, "shared chokepoints: every grouped wick fans with a distinct tail bow", bunched.join(", "));

        // Spread guard: non-shared levels must scatter their matchsticks AROUND
        // the bomb (spawns ≥ 200° apart) and never pile more than 3 wicks onto
        // one cross-section. These are the two regressions behind "all the wicks
        // merge in from one side and bunch at the banana" (e.g. L55). Shared-
        // single-chokepoint levels are exempt — their design is one crossroad
        // every wick passes through.
        const wedge = (pts) => {
            const a = [...pts].sort((p, q) => p - q);
            let maxGap = 360 - (a[a.length - 1] - a[0]);
            for (let i = 0; i < a.length - 1; i++) maxGap = Math.max(maxGap, a[i + 1] - a[i]);
            return 360 - maxGap;
        };
        let wedged = [];
        let overGrouped = [];
        for (const c of levels) {
            const roots = c.fuses.filter((f) => !f.branchOf);
            const shared = roots.length > 0 && roots.every((f) => f.routeThrough === "cut1");
            if (shared) continue;
            if (c.spawns.length <= 1) continue; // single-fuse tutorials
            const angs = c.spawns.map((s) => {
                let d = Math.atan2(s.y - c.payload.y, s.x - c.payload.x) * (180 / Math.PI);
                return d < 0 ? d + 360 : d;
            });
            if (wedge(angs) < 150) wedged.push(`L${c.level_id}=${wedge(angs).toFixed(0)}°`);
            const groups = new Map();
            for (const f of roots) {
                if (!f.routeThrough) continue;
                if (!groups.has(f.routeThrough)) groups.set(f.routeThrough, []);
                groups.get(f.routeThrough).push(f.id);
            }
            for (const [cpId, grp] of groups) {
                if (grp.length > 3) overGrouped.push(`L${c.level_id}:${cpId}=${grp.length}`);
            }
        }
        check(wedged.length === 0, "non-shared levels scatter matchsticks around the bomb (spawn wedge ≥ 200°)", wedged.join(", "));
        check(overGrouped.length === 0, "non-shared cross-sections serve ≤ 3 wicks each", overGrouped.join(", "));
    }

    // Fit-camera guard: a chokepoint that drifts absurdly far from the payload
    // (a relaxed hairpin can wander to 700-1200px) shrinks the whole puzzle on
    // mobile — the fit camera zooms out to cover it and the wicks get tiny.
    let farCps = [];
    for (const c of levels) {
        for (const cp of c.intersections) {
            const d = Math.hypot(cp.x - c.payload.x, cp.y - c.payload.y);
            if (d > 480) farCps.push(`L${c.level_id}:${cp.id}=${d.toFixed(0)}`);
        }
    }
    check(farCps.length === 0, `no chokepoint drifts past 480px (mobile fit zoom), ${farCps.join(", ")}`);
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

    // Every level must carry at least one spare snip so 3★ is always reachable.
    let noSlack = [];
    for (const c of levels) {
        const used = new Set(c.fuses.filter((f) => f.routeThrough).map((f) => f.routeThrough)).size;
        const direct = c.fuses.filter((f) => !f.routeThrough).length;
        if (c.snipsAllowed - (used + direct) < 1) noSlack.push(`L${c.level_id}`);
    }
    check(noSlack.length === 0, "Stars: every level has >= 1 spare snip (3★ always reachable)", noSlack.join(", "));
}

// Fork ignition: a branch wick splits off its parent's wick at the fork point.
// The wick renders like any live wick (an unmarked Y-split); its spark only
// exists once the parent's burn crosses the fork (`at`), then it races down the
// branch. The fork sits BEFORE the parent's cut target (t=0.5), so a normal
// chokepoint cut CANNOT silently erase the branch — it lights first and
// demands its own cut. To PREVENT the branch the player must cut the parent
// EARLY (before the fork), saving that snip.
{
    const forkLvls = levels.filter((l) => l.fuses.some((f) => f.branchOf));
    const firstFork = levels.find((l) => l.fuses.some((f) => f.branchOf));
    check(firstFork?.level_id === 8, "forks begin at L8 (right after the shared-chokepoint tutorial)", `first fork level = ${firstFork?.level_id}`);
    check(forkLvls.length >= 20, "forks are present through the rest of the ladder", `${forkLvls.length} fork levels`);
    const before = levels.find((l) => l.level_id === 7);
    check(!before.fuses.some((f) => f.branchOf), "L7 has no forks (pure chokepoint tutorial)");

    const cfg = levels.find((l) => l.level_id === 8);
    const branchFuses = cfg.fuses.filter((f) => f.branchOf);
    check(branchFuses.length === 1, "L8 has exactly one branch wick", JSON.stringify(branchFuses[0]));

    const level = buildLevel(cfg, { width: 1280, height: 720 });
    const childSpark = level.sparks.find((s) => s.chain);
    const parentSpark = level.sparks[childSpark.chain.fromFuseIndex];
    const branchFuse = level.fuses[childSpark.fuseIndex];
    check(
        branchFuse.startNode.type === "branch",
        "fork wiring: branch starts at a synthetic fork node (no matchstick drawn there)"
    );
    check(
        parentSpark && parentSpark.fuseIndex === childSpark.chain.fromFuseIndex,
        "fork wiring: child points at the parent fuse's spark"
    );
    check(childSpark.delay === 99999 && childSpark.triggered === false,
        "fork wiring: branch spark has no timer and starts unlit");
    check(childSpark.chain.at < 0.5,
        "fork wiring: the fork fires before the parent's cut target", `at=${childSpark.chain.at}`);

    // The fork node must sit ON the parent's wick at `at` — same point the
    // generator pinned as branchPoint.
    {
        const parentFuse = level.fuses[parentSpark.fuseIndex];
        const P = getBezierXY(childSpark.chain.at, parentFuse.startNode, parentFuse.cp1, parentFuse.cp2, parentFuse.endNode);
        const N = branchFuse.startNode;
        check(
            Math.hypot(P.x - N.x, P.y - N.y) < 1,
            "fork geometry: the fork node lands on the parent's wick at `at`",
            `Δ=${Math.hypot(P.x - N.x, P.y - N.y).toFixed(2)}`
        );
    }

    const run = (cuts) => {
        const g = new GameLoop({ canvas: null, ...makeStubs() });
        g.loadLevel(buildLevel(cfg, { width: 1280, height: 720 }), 0);
        for (const c of cuts) g.cuts.push({ x: c.x, y: c.y, radius: 15, angle: 0, fuseId: c.fuseId ?? null });
        for (let i = 0; i < 6000 && g.gameState === STATE.PLAYING; i++) {
            g.frameCount++;
            g._update();
        }
        return g;
    };

    // Regression for the "early win" bug: cutting every chokepoint (including a
    // parent's shared cross point) must NOT erase the branch — it lights before
    // the parent dies, then dies at its own cut. Level still won.
    const allCuts = level.fuses.map((f) => f.intersectionPt).filter((p, i, a) => !a.some((q, j) => j < i && Math.hypot(q.x - p.x, q.y - p.y) < 30));
    const gNormal = run(allCuts);
    const childNormal = gNormal.sparks.find((s) => s.chain);
    check(
        gNormal.gameState === STATE.WON && childNormal.ignited && childNormal.triggered,
        "fork: cutting all chokepoints still lets the branch light (no early win) — it dies at its own cut"
    );

    // Prevention: cut the parent's wick BEFORE the fork → the branch duds and
    // never lights.
    const parentFuse = level.fuses[parentSpark.fuseIndex];
    const early = getBezierXY(childSpark.chain.at - 0.1, parentFuse.startNode, parentFuse.cp1, parentFuse.cp2, parentFuse.endNode);
    const gPrev = run([...allCuts, { x: early.x, y: early.y, radius: 15, angle: 0, fuseId: parentFuse.id }]);
    const childPrev = gPrev.sparks.find((s) => s.chain);
    check(
        gPrev.gameState === STATE.WON && !childPrev.ignited && !childPrev.active,
        "fork: cutting the parent BEFORE the fork breaks the branch (never lights)"
    );

    // A parent that dies AFTER crossing the fork must still light the branch:
    // cut every chokepoint EXCEPT the branch's own. The branch lights (its
    // parent died at a normal cut, downstream of the fork), burns un-snuffed to
    // the payload, and the level is LOST — proving a normal parent cut can't
    // silently erase the branch, regardless of spark array order.
    const withoutBranchCut = allCuts.filter((p) => Math.hypot(p.x - branchFuse.intersectionPt.x, p.y - branchFuse.intersectionPt.y) > 30);
    const gDown = run(withoutBranchCut);
    const childDown = gDown.sparks.find((s) => s.chain);
    check(
        childDown.ignited && childDown.triggered && gDown.gameState === STATE.LOST,
        "fork: a parent cut after the fork still lights the branch (lit branch is a real threat)"
    );

    // Design invariant (the "early win" regression): NO fork may sit at/after
    // its parent's cut target, or the normal cut would silently erase the
    // branch. Verify across all 60 levels.
    {
        const bad = [];
        for (const c of levels) {
            for (const f of c.fuses) {
                if (f.branchOf && (f.at >= 0.5 || f.at <= 0)) bad.push(`L${c.level_id}:${f.id}@${f.at}`);
            }
        }
        check(bad.length === 0, "fork invariant: no level has a trivially breakable fork (fires before parent's cut)", bad.join(", "));
    }

    // Fork showcase: every fork sits clear of the bomb art (visible Y-split),
    // and every routed branch's cross-section sits ON its wick (so the cut
    // target isn't floating in mid-air next to the wick).
    {
        const hiddenForks = [];
        const offWick = [];
        for (const c of levels) {
            for (const f of c.fuses) {
                if (!f.branchOf) continue;
                const r = Math.hypot(f.branchPoint.x - c.payload.x, f.branchPoint.y - c.payload.y);
                if (r < 160) hiddenForks.push(`L${c.level_id}:${f.id}@r${Math.round(r)}`);
                if (f.routeThrough) {
                    const cp = c.intersections.find((x) => x.id === f.routeThrough);
                    if (!cp) continue;
                    const wx = c.payload.x - f.branchPoint.x, wy = c.payload.y - f.branchPoint.y;
                    const L2 = wx * wx + wy * wy;
                    const m = { x: (cp.x - 0.125 * (f.branchPoint.x + c.payload.x)) / 0.75, y: (cp.y - 0.125 * (f.branchPoint.y + c.payload.y)) / 0.75 };
                    const u = ((m.x - f.branchPoint.x) * wx + (m.y - f.branchPoint.y) * wy) / L2;
                    if (u < 0.02 || u > 0.98) offWick.push(`L${c.level_id}:${f.id}@u${u.toFixed(2)}`);
                }
            }
        }
        check(hiddenForks.length === 0, "fork showcase: every fork is visible outside the bomb art", hiddenForks.join(", "));
        check(offWick.length === 0, "fork showcase: routed branch cross-sections sit on the branch wick", offWick.join(", "));
    }
}

// Spatial cutting: ONE snip severs every wick it crosses. Wicks that overlap
// or merge near the bomb (the bunch at the banana) are all cut by a single
// swipe placed across them — the cut mark and the mechanic stay in sync.
{
    const cfg = levels.find((l) => l.level_id === 4); // 2 fuses, both end at the bomb
    const level = buildLevel(cfg, { width: 1280, height: 720 });
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(level, 0);

    // A cut placed right at the bomb, as if the player waited for the sparks
    // to bunch up at the banana and swiped there.
    const bomb = Object.values(level.nodeMap).find((n) => n.type === "payload");
    g.cuts.push({ x: bomb.x, y: bomb.y, radius: 15, angle: 0, fuseId: level.fuses[0].id });

    let s0Died = false, s1Died = false;
    for (let i = 0; i < 6000 && g.gameState === STATE.PLAYING; i++) {
        g.frameCount++;
        g._update();
        if (!g.sparks[0].active) s0Died = true;
        if (!g.sparks[1].active) s1Died = true;
    }
    check(s0Died, "one snip cuts the wick it was placed on", `s0 active=${g.sparks[0].active}`);
    check(s1Died, "one snip cuts the overlapping wick too (multi-kill at the bomb)", `s1 active=${g.sparks[1].active}`);
    check(g.gameState === STATE.WON,
        "level clears — no spark sneaks through the visible cut mark", g.gameState);
}

// Multi-cut banking: a single snip placed at a shared chokepoint severs every
// live wick that crosses it (L4's two fuses share cut1). N>=2 spawns the "+N"
// popup, an ascending coin-chime queue, and banks a bonus star per extra wick
// at level clear.
{
    const cfg = levels.find((l) => l.level_id === 4);
    const played = [];
    const recAudio = {
        play: (id, o = {}) => played.push({ id, rate: o.rate }),
        startLoop() {},
        stopLoop() {},
    };
    const g = new GameLoop({ canvas: null, ...makeStubs(), audio: recAudio });
    g.loadLevel(buildLevel(cfg, { width: 1280, height: 720 }), 0);
    const cp = g.level.intersectionMap.cut1;
    const swipe = () => g.tryCut(
        { x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y },
        [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
    );
    check(swipe() === true, "multikill: snip lands at the shared chokepoint");
    check(g.multikills.length === 1 && g.multikills[0].count === 2,
        "multikill: one snip counts 2 severed wicks", JSON.stringify(g.multikills[0]));
    check(g.multikillStars === 1, "multikill: banks 1 bonus star for the extra wick", String(g.multikillStars));
    check(g._chime && g._chime.total === 1, "multikill: coin-chime queue armed", JSON.stringify(g._chime));

    // Advance frames: the queued ascending note fires and the queue drains.
    await new Promise((r) => setTimeout(r, 250));
    for (let i = 0; i < 12; i++) { g.frameCount++; g._update(); }
    const chimes = played.filter((p) => p.id === "win_star");
    check(chimes.length === 2 && chimes[1].rate > chimes[0].rate,
        "multikill: ascending coin chime (2 notes, rising pitch)",
        JSON.stringify(chimes.map((c) => c.rate)));
    check(g._chime === null, "multikill: chime queue drains", JSON.stringify(g._chime));

    // Single-wick snip: no popup, no chime.
    const g1 = new GameLoop({ canvas: null, ...makeStubs() });
    g1.loadLevel(lvl1, 0);
    const mid = g1.fuses[0].intersectionPt;
    g1.tryCut({ x: mid.x - 20, y: mid.y }, { x: mid.x + 20, y: mid.y }, []);
    check(g1.multikills.length === 0 && g1._chime === null,
        "multikill: single-wick snip is not a multi-cut");
}

// Efficiency score: fewer snips used → more points; perfects and multi-cuts add.
{
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(lvl1, 0);
    const allowed = lvl1.snipsAllowed;
    check(g.computeScore() === 100 + 100 * allowed,
        "score: clearing with all snips unused scores 100 + 100/snip", `got ${g.computeScore()}`);
    g.snipsUsed = allowed;
    check(g.computeScore() === 100, "score: clearing with the full budget used scores base 100", String(g.computeScore()));
    g.snipsUsed = allowed - 1;
    g.perfectSnips = 2;
    g.multikills.push({ count: 3 }); // two extra wicks sliced
    check(g.computeScore() === 100 + 100 + 25 * (2 + 2),
        "score: perfects + multi-cut wicks add to the efficiency score", String(g.computeScore()));
}

// Comic word rotation: _finishLevel picks a word from the won/lost pools per
// attempt, so the big beat isn't always the same two words.
{
    const { COMIC_WORDS } = await import("../../src/engine/Renderer.js");
    check(COMIC_WORDS.won.length >= 5 && COMIC_WORDS.lost.length >= 5,
        "comic: each pool has 5+ rotating words", `${COMIC_WORDS.won.length}/${COMIC_WORDS.lost.length}`);
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    g.loadLevel(lvl1, 0);
    g.snipsRemaining = 1;
    g._finishLevel(true);
    check(COMIC_WORDS.won.includes(g.comicWord), "comic: win word comes from the won pool", g.comicWord);
    const g2 = new GameLoop({ canvas: null, ...makeStubs() });
    g2.loadLevel(lvl1, 0);
    g2._finishLevel(false);
    check(COMIC_WORDS.lost.includes(g2.comicWord), "comic: lose word comes from the lost pool", g2.comicWord);
}

// Difficulty profile: the burn pace is a READ-TIME budget, not a speed race.
// Simple teaching levels can burn briskly; the dense late mazes (many wicks +
// forks) burn the SLOWEST so the player has time to read the lines and place
// every cut. Difficulty in act 3 comes from the web of routes, not panic.
{
    const fastest = (id) => Math.max(...levels.find((l) => l.level_id === id).fuses.map((f) => f.speed));
    const secs = (speed) => Math.round((1 / speed / 60) * 10) / 10;
    const l8 = secs(fastest(8)), l20 = secs(fastest(20)), l40 = secs(fastest(40)), l55 = secs(fastest(55));
    check(l8 < 25, "L8 fastest fuse burns in under 25s (gentle showcase)", `${l8}s`);
    check(l20 < 16, "L20 fastest fuse burns in under 16s", `${l20}s`);
    check(l40 < 11, "L40 act-2 peak burns in under 11s (fastest band)", `${l40}s`);
    check(l55 > 8, "L55 dense maze burns SLOWER than 8s (readable, not a panic)", `${l55}s`);

    // Read-time floor: no fuse anywhere burns a full wick in under ~7s, or
    // the player can't track all the sparks at once.
    let tooFast = [];
    for (const c of levels) {
        const f = Math.max(...c.fuses.map((x) => x.speed));
        if (f > 0.0024) tooFast.push(`L${c.level_id}=${(1 / f / 60).toFixed(1)}s`);
    }
    check(tooFast.length === 0, "read-time floor: no fuse burns faster than ~7s/wick", tooFast.join(", "));

    // Complexity-slow correlation: the densest late mazes must burn slower
    // than the act-2 peak (difficulty via geometry, not speed).
    const sparkCount = (id) => {
        const l = levels.find((x) => x.level_id === id);
        return l.spawns.length + l.fuses.filter((f) => f.branchOf).length;
    };
    check(sparkCount(55) >= 9 && l55 > l40, "complexity slow-burn: L55 (10 sparks) burns slower than the L40 peak", `L55 ${l55}s @ ${sparkCount(55)} sparks vs L40 ${l40}s`);
    const boss = secs(fastest(57));
    check(boss >= 10, "boss levels burn at or above 10s/wick (calm placement puzzles)", `${boss}s`);

    // Act-3 readability: the densest levels (9+ sparks) must have a real
    // arrival spread so sparks TRICKLE in instead of bunching — the player
    // reads and plans instead of reacting to a burst.
    let bunched = [];
    for (const c of levels) {
        if (c.level_id < 41) continue; // act-2 34-37 deliberately overlap
        const sparks = c.spawns.length + c.fuses.filter((f) => f.branchOf).length;
        if (sparks < 9) continue;
        const realDelays = c.fuses.filter((f) => f.delayFrames < 99999).map((f) => f.delayFrames);
        const span = (Math.max(...realDelays) - Math.min(...realDelays)) / 60;
        if (span < 7) bunched.push(`L${c.level_id} span=${span.toFixed(1)}s`);
    }
    check(bunched.length === 0, "act-3 spread: 9+ spark levels stagger arrivals over >= 7s", bunched.join(", "));

    // First-spark immediacy: every level ignites its first fuse the moment it
    // loads (rain shuffles can push every timer up, leaving a dead 7s wait).
    let sluggish = [];
    for (const c of levels) {
        const timed = c.fuses.filter((f) => f.delayFrames < 99999);
        const min = Math.min(...timed.map((f) => f.delayFrames));
        if (min > 15) sluggish.push(`L${c.level_id}=${Math.round(min / 60)}s`);
    }
    check(sluggish.length === 0, "every level ignites its first spark immediately on load", sluggish.join(", "));

    const partialLvls = levels.filter((l) => l.level_id > 3 && l.fuses.some((f) => !f.routeThrough && !f.branchOf));
    const firstPartial = levels.find((l) => l.level_id > 3 && l.fuses.some((f) => !f.routeThrough && !f.branchOf));
    check(firstPartial?.level_id === 14, "partial (direct) fuses begin at L14", `first = L${firstPartial?.level_id}`);
    check(partialLvls.length >= 15, "direct fuses appear throughout the rest of the ladder", `${partialLvls.length} levels`);

    const parMissing = levels.filter((l) => typeof l.par !== "number" || l.par <= 0);
    check(parMissing.length === 0, "every level carries a par time", parMissing.map((l) => `L${l.level_id}`).join(", "));
    const parBeatable = levels.every((l) => l.par > 2);
    check(parBeatable, "par is always above the 2s floor", "");
}

// PERFECT SNIP: a cut placed just ahead of a burning spark counts; a cut far
// from the spark does not.
{
    const cfg = levels.find((l) => l.level_id === 4); // one shared chokepoint, slow spark
    const g = new GameLoop({ canvas: null, ...makeStubs() });
    const level = buildLevel(cfg, { width: 1280, height: 720 });
    g.loadLevel(level, 0);

    // Burn the first spark a little so it's ignited and moving.
    for (let i = 0; i < 30 && g.gameState === STATE.PLAYING; i++) { g.frameCount++; g._update(); }
    const spark = g.sparks.find((s) => s.ignited && s.active);
    check(spark != null, "perfect: a spark is burning mid-level");

    if (spark) {
        const fuse = level.fuses[spark.fuseIndex];
        // Just ahead of the spark (progress + 0.02 → ~2% of the wick ahead).
        const ahead = getBezierXY(spark.progress + 0.02, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
        const p0 = { x: ahead.x - 5, y: ahead.y }, p1 = { x: ahead.x + 5, y: ahead.y };
        g.tryCut(p0, p1, [p0, p1]);
        check(g.perfectSnips === 1, "perfect: cutting just ahead of the moving spark counts a PERFECT SNIP", `count=${g.perfectSnips}`);

        // A cut at the far chokepoint (other end of the wick) is NOT perfect.
        const g2 = new GameLoop({ canvas: null, ...makeStubs() });
        g2.loadLevel(level, 0);
        for (let i = 0; i < 30 && g2.gameState === STATE.PLAYING; i++) { g2.frameCount++; g2._update(); }
        const cp = fuse.intersectionPt;
        const q0 = { x: cp.x - 5, y: cp.y }, q1 = { x: cp.x + 5, y: cp.y };
        g2.tryCut(q0, q1, [q0, q1]);
        check(g2.perfectSnips === 0, "perfect: a chokepoint cut far from the spark is not perfect", `count=${g2.perfectSnips}`);

        // A cut BEHIND the spark (it already passed) is not perfect either.
        const g3 = new GameLoop({ canvas: null, ...makeStubs() });
        g3.loadLevel(level, 0);
        for (let i = 0; i < 30 && g3.gameState === STATE.PLAYING; i++) { g3.frameCount++; g3._update(); }
        const behind = getBezierXY(Math.max(0, spark.progress - 0.1), fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
        const r0 = { x: behind.x - 5, y: behind.y }, r1 = { x: behind.x + 5, y: behind.y };
        g3.tryCut(r0, r1, [r0, r1]);
        check(g3.perfectSnips === 0, "perfect: a cut behind the spark is not perfect", `count=${g3.perfectSnips}`);
    }
}

// Best-time records: the save keeps the fastest clear, and only improves.
{
    const storage = {};
    const save = new SaveManager({ get: (k) => storage[k], set: (k, v) => (storage[k] = v) });
    check(save.getBestTime(3) === null, "records: no best time before first clear");
    check(save.setBestTime(3, 12.4) === true, "records: first clear is a new record");
    check(save.getBestTime(3) === 12.4, "records: best time stored");
    check(save.setBestTime(3, 9.1) === true, "records: faster clear sets a new record");
    check(save.setBestTime(3, 10.0) === false, "records: slower clear is not a record");
    check(save.getBestTime(3) === 9.1, "records: best time kept");
    save.depositStars(2);
    check(save.getStarBank() === 2, "records: PERFECT SNIP stars deposit into the bank");
    save.depositStars(0);
    save.depositStars(-3);
    check(save.getStarBank() === 2, "records: non-positive deposits are ignored");

    check(save.getBestScore(3) === 0, "records: no best score before first clear");
    check(save.setBestScore(3, 400) === true, "records: first clear sets a best score");
    check(save.setBestScore(3, 350) === false, "records: lower score is not a new best");
    check(save.setBestScore(3, 500) === true, "records: higher score sets a new best");
    check(save.getBestScore(3) === 500, "records: best score kept");
}

// Daily challenge: date-seeded pick + streak accounting.
{
    const { todayStr, yesterdayOf, dayNumber } = await import("../../src/engine/dates.js");
    check(todayStr(new Date(2026, 7, 28)) === "2026-08-28", "dates: todayStr pads to YYYY-MM-DD");
    check(yesterdayOf("2026-08-28") === "2026-08-27", "dates: yesterdayOf rolls back across a day");
    check(yesterdayOf("2026-03-01") === "2026-02-28", "dates: yesterdayOf handles month boundaries");
    const d28 = new Date(2026, 7, 28, 23, 59); // local calendar day, not UTC
    check(dayNumber(d28) === Math.floor(Date.UTC(2026, 7, 28) / 86400000),
        "dates: dayNumber counts local calendar days", String(dayNumber(d28)));

    // Deterministic pick: 37 is coprime with 60, so consecutive days cycle
    // through all 60 levels with no repeats inside a full cycle.
    const pick = (d) => (d * 37) % 60;
    const seen = new Set();
    for (let d = 0; d < 60; d++) seen.add(pick(d));
    check(seen.size === 60, "daily: level pick cycles through all 60 levels", `distinct=${seen.size}`);
    check(pick(0) !== pick(1), "daily: consecutive days pick different levels", `${pick(0)} vs ${pick(1)}`);
    check(pick(12345) === pick(12345), "daily: pick is deterministic for a given day");

    // Streak: first completion starts at 1, consecutive days extend, a replay
    // of the same day is a no-op, and a gap resets to 1.
    const storage = {};
    const save = new SaveManager({ get: (k) => storage[k], set: (k, v) => (storage[k] = v) });
    check(save.getDailyStreak() === 0 && !save.isDailyComplete("2026-08-27"),
        "daily: fresh save has no streak and no completions");
    let res = save.markDailyComplete("2026-08-27");
    check(res.newDay && res.streak === 1, "daily: first completion starts streak at 1", JSON.stringify(res));
    check(save.isDailyComplete("2026-08-27"), "daily: completed day is persisted");
    res = save.markDailyComplete("2026-08-28");
    check(res.newDay && res.streak === 2, "daily: consecutive day extends the streak", JSON.stringify(res));
    res = save.markDailyComplete("2026-08-28");
    check(!res.newDay && res.streak === 2, "daily: replaying the same day is a no-op", JSON.stringify(res));
    res = save.markDailyComplete("2026-08-30"); // 29th skipped
    check(res.newDay && res.streak === 1, "daily: a missed day resets the streak", JSON.stringify(res));
    check(save.getDailyStreak() === 1 && storage["cut_the_fuse_save_v1"].includes('"dailyStreak":1'),
        "daily: streak persists through the storage layer");
}

// Curve variety: a bulged fuse keeps cp1 != cp2 but the curve still passes
// EXACTLY through its chokepoint at t=0.5 (the cut target must not move).
{
    const cfg = levels.find((l) => l.fuses.some((f) => f.bulge));
    check(cfg != null, "at least one level uses curve bulges");
    if (cfg) {
        const level = buildLevel(cfg, { width: 1280, height: 720 });
        const bulged = level.fuses.filter((f) => f.bulge && f.bulge !== 0);
        const okSplit = bulged.every((f) => Math.hypot(f.cp1.x - f.cp2.x, f.cp1.y - f.cp2.y) > 1);
        check(okSplit, "bulged fuses have split control points");
        const okPass = bulged.every((f) => {
            const b = getBezierXY(0.5, f.startNode, f.cp1, f.cp2, f.endNode);
            return Math.hypot(b.x - f.intersectionPt.x, b.y - f.intersectionPt.y) < 0.001;
        });
        check(okPass, "bulged fuses still pass exactly through their chokepoint at t=0.5");
    }
}

// ---------------------------------------------------------------------------
// Part B — DOM boot test (main.js end-to-end)
// ---------------------------------------------------------------------------
console.log("\n[B] DOM boot — main.js end-to-end");

class El {
    constructor(id) {
        this.id = id;
        this.style = {};
        this._textContent = "";
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
    // Match real DOM: assigning textContent replaces all children.
    get textContent() { return this._textContent; }
    set textContent(v) {
        this._textContent = v;
        if (v === "") this.children = [];
    }
    get innerHTML() { return this._innerHTML; }
    set innerHTML(v) { this._innerHTML = v; if (v === "") this.children = []; }
    set src(v) { this._src = v; this.complete = true; queueMicrotask(() => this.onload && this.onload()); }
    get src() { return this._src; }
    addEventListener(t, fn) { (this.listeners[t] ??= []).push(fn); }
    dispatch(t, e) { for (const fn of this.listeners[t] ?? []) fn(e); }
    appendChild(c) { this.children.push(c); return c; }
    append(...c) { this.children.push(...c); }
    focus() {}
    getBoundingClientRect() { return { left: 0, top: 0 }; }
    classList = {
        add: (...c) => { for (const x of c) if (!this.className.split(/\s+/).includes(x)) this.className = (this.className + " " + x).trim(); },
        remove: (...c) => { this.className = this.className.split(/\s+/).filter((x) => !c.includes(x)).join(" "); },
        toggle: (c, force) => {
            const has = this.className.split(/\s+/).includes(c);
            const want = force === undefined ? !has : !!force;
            if (want && !has) this.className = (this.className + " " + c).trim();
            if (!want && has) this.className = this.className.split(/\s+/).filter((x) => x !== c).join(" ");
            return want;
        },
    };
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
    const waitFor = async (fn, tries = 150) => {
        for (let i = 0; i < tries && !fn(); i++) await new Promise((r) => setTimeout(r, 20));
        return fn();
    };
    const snipIconsLeft = () =>
        elements["snips-counter"].children.filter((c) =>
            (c.className || "").includes("snip-icon") && !(c.className || "").includes("spent")).length;

    // Home screen first: the hub shows the star bank and the PLAY button.
    check(elements["modal-menu"].style.display === "flex", "Boot: title hub is the home screen");
    check(/^\d+$/.test(elements["menu-stars"].textContent), "Boot: hub shows the star bank", elements["menu-stars"].textContent);
    check(["btn-menu-play", "btn-menu-daily", "btn-menu-levels", "btn-menu-armory"].every((id) => elements[id] != null),
        "Boot: hub has PLAY / DAILY / LEVELS / ARMORY buttons", "");

    // PLAY starts the story at the first un-cleared level (L1 on a fresh save).
    elements["btn-menu-play"].dispatch("click", {});
    await waitFor(() => elements["level-label"].textContent === "LEVEL 1" && elements["modal-menu"].style.display === "none");
    check(elements["level-label"].textContent === "LEVEL 1", "Boot: PLAY loads Level 1");
    check(snipIconsLeft() === 3, "Boot: snips counter = 3 scissors (geometry-derived)", String(snipIconsLeft()));
    check(elements["tutorial-overlay"].style.display === "flex", "Boot: Level 1 tutorial overlay shown");

    // Dismiss the tutorial, then swipe through the fuse's chokepoint (screen center).
    elements["tutorial-next"].dispatch("click", {});
    check(elements["tutorial-overlay"].style.display === "none", "Boot: tutorial dismiss works");

    const mk = (clientX, clientY) => ({ pointerId: 1, button: 0, pointerType: "mouse", clientX, clientY, preventDefault() {} });
    canvasEl.dispatch("pointerdown", mk(620, 360));
    canvasEl.dispatch("pointermove", mk(660, 360));
    canvasEl.dispatch("pointerup", mk(660, 360));
    check(snipIconsLeft() === 2, "Boot: swipe cut consumed a snip (2 scissors left)", String(snipIconsLeft()));

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
    check(/^SCORE \d+$/.test(elements["win-score"].textContent), "Boot: win modal shows the efficiency score", elements["win-score"].textContent);

    // Armory: opens from the star counter, shows 10 payload skins.
    elements["star-display"].dispatch("click", {});
    check(elements["modal-skins"].style.display === "block", "Armory: opens from the star counter");
    check(elements["modal-menu"].style.display === "none", "Armory: opening it hides the win modal (no stacking)");
    check(elements["tab-payloads"].className.includes("active"), "Armory: BOMBS tab active by default", elements["tab-payloads"].className);
    check(elements["skin-grid"].children.length === 10, "Armory: renders all 10 payload skins", String(elements["skin-grid"].children.length));
    const cards = elements["skin-grid"].children;
    check(cards[0].className.includes("selected"), "Armory: banana (starter) owned + selected", cards[0].className);
    check(cards[1].className.includes("locked"), "Armory: melon locked until level 4", cards[1].className);

    // Switch to IGNITERS: 3 types, matchstick selected, lighter shows an ad unlock.
    elements["tab-igniters"].dispatch("click", {});
    check(elements["tab-igniters"].className.includes("active"), "Armory: IGNITERS tab active", elements["tab-igniters"].className);
    check(elements["skin-grid"].children.length === 3, "Armory: renders all 3 igniter types", String(elements["skin-grid"].children.length));
    const ig = elements["skin-grid"].children;
    check(ig[0].className.includes("selected"), "Armory: matchstick (starter) selected", ig[0].className);
    check(ig[1].className.includes("locked"), "Armory: lighter locked until level 4", ig[1].className);
    const lighterFooter = ig[1].children[ig[1].children.length - 1];
    const lighterAdBtn = lighterFooter.children[1];
    // Live URL build has no rewarded-ad SDK wired — the armory is
    // progression-only, so locked ad skins show NO Watch Ad button.
    check(!lighterAdBtn || !lighterAdBtn.className.includes("watch-ad"), "Armory: live build hides Watch Ad (progression-only)", lighterAdBtn ? lighterAdBtn.className : "");
    check(lighterFooter.children[0] && lighterFooter.children[0].textContent.includes("Reach Level 4"), "Armory: unlock copy reads Reach Level 4 on live", lighterFooter.children[0]?.textContent);

    // Live build: progression unlock — simulate reaching level 4 (the lighter's
    // threshold) via the save instance, then confirm it unlocks without any ad.
    win.__CTF__.save.setUnlockedLevel(4);
    elements["tab-igniters"].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 30));
    check(elements["skin-grid"].children[1].className.includes("locked") === false, "Armory: lighter unlocks at level 4 (progression)", elements["skin-grid"].children[1].className);
    check(elements["skin-grid"].children[1].children[3].children[0]?.textContent === "Select", "Armory: unlocked lighter shows Select tag", elements["skin-grid"].children[1].children[3].children[0]?.textContent);
    elements["skin-grid"].children[1].dispatch("click", {});
    check(JSON.parse(localStorage.getItem("cut_the_fuse_save_v1")).selectedIgniter === "lighter", "Armory: igniter selection persisted to save");

    // Selecting another payload skin persists to the save and is applied to the loadout.
    // Melon is owned once the player reaches level 4 — the footer shows Select.
    elements["tab-payloads"].dispatch("click", {});
    const melonFooter = elements["skin-grid"].children[1].children[3];
    check(elements["skin-grid"].children[1].className.includes("locked") === false, "Armory: melon unlocked by level 4 (progression)", elements["skin-grid"].children[1].className);
    check(melonFooter.children[0]?.textContent === "Select", "Armory: unlocked melon shows Select tag", melonFooter.children[0]?.textContent);
    elements["skin-grid"].children[1].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 30));
    check(elements["skin-grid"].children[1].className.includes("selected"), "Armory: unlocked melon selected", elements["skin-grid"].children[1].className);
    check(JSON.parse(localStorage.getItem("cut_the_fuse_save_v1")).selectedSkin === "melon", "Armory: payload skin selection persisted to save");
    elements["btn-skins-close"].dispatch("click", {});
    check(elements["modal-skins"].style.display === "none", "Armory: BACK returns to the hub");
    check(elements["modal-menu"].style.display === "flex", "Hub: shown after closing the armory");

    // PLAY from the hub while a level is loaded and won restarts the level.
    elements["btn-menu-play"].dispatch("click", {});
    await waitFor(() => elements["modal-menu"].style.display === "none");
    check(elements["level-label"].textContent.startsWith("LEVEL 1"), "Hub: PLAY restarts the level", elements["level-label"].textContent);

    // Level selector via the hub button; tiles show big numbers + star art.
    elements["btn-menu"].dispatch("click", {});
    await waitFor(() => elements["modal-menu"].style.display === "flex");
    elements["btn-menu-levels"].dispatch("click", {});
    check(elements["modal-levels"].style.display === "flex", "Selector: hub LEVEL SELECT opens the map");
    check(elements["modal-menu"].style.display === "none", "Selector: the hub closes when the map opens (no overlap)");
    check(elements["level-grid"].children.length === 60, "Selector: grid renders all 60 levels", String(elements["level-grid"].children.length));
    check(elements["level-grid"].children[0].children[0]?.textContent === "01", "Selector: level numbers rendered", elements["level-grid"].children[0].children[0]?.textContent);
    const cellStars = elements["level-grid"].children[0].children[1];
    check(cellStars.children.length === 3 && cellStars.children[0].className !== "dim",
        "Selector: earned stars shown as lit star art", `${cellStars.children.length} imgs`);
    const cell3 = elements["level-grid"].children[2];
    cell3.dispatch("click", {});
    await new Promise((r) => setTimeout(r, 60));
    check(elements["level-label"].textContent.startsWith("LEVEL 3"), "Selector: clicking a cell loads that level", elements["level-label"].textContent);
    check(elements["modal-levels"].style.display === "none", "Selector: modal closes after picking a level");

    // Modal exclusivity: opening the armory while the level select is open
    // closes the map — the two never stack (the overlap bug).
    elements["level-label"].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 30));
    check(elements["modal-levels"].style.display === "flex", "Selector: click level label opens the map");
    elements["star-display"].dispatch("click", {});
    check(elements["modal-skins"].style.display === "block", "Menu: armory opens over the map");
    check(elements["modal-levels"].style.display === "none", "Menu: opening the armory closes the level select (no overlap)");
    elements["btn-skins-close"].dispatch("click", {});
    check(elements["modal-menu"].style.display === "flex", "Menu: armory BACK routes to the hub");

    // Daily challenge: banner renders in the selector; entering today's
    // challenge loads a seeded level tagged DAILY; picking a story level
    // exits daily mode.
    elements["btn-menu-levels"].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 30));
    check(elements["btn-daily"] != null, "Daily: challenge button rendered in the selector");
    check((elements["daily-streak"].textContent || "").includes("STREAK"), "Daily: streak pill rendered", elements["daily-streak"].textContent);
    check(elements["btn-daily"].disabled === false, "Daily: challenge is enterable (not yet done today)", `disabled=${elements["btn-daily"].disabled}`);
    elements["btn-daily"].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 60));
    check(elements["level-label"].textContent === "DAILY ▾", "Daily: entering the challenge tags the header", elements["level-label"].textContent);
    check(elements["modal-levels"].style.display === "none", "Daily: selector closes after entering the challenge");
    elements["level-label"].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 30));
    elements["level-grid"].children[0].dispatch("click", {});
    await new Promise((r) => setTimeout(r, 60));
    check(elements["level-label"].textContent === "LEVEL 1", "Daily: picking a story level exits daily mode", elements["level-label"].textContent);
}

// ---------------------------------------------------------------------------
// Part C — popup lanes: announcement popups fired by the same snip never
// overlap (PERFECT! / LAST SNIP! / +N all land on separate vertical lanes).
// ---------------------------------------------------------------------------
console.log("\n[C] popup lanes — same-cut popups never overlap");
{
    const { Renderer } = await import("../../src/engine/Renderer.js");
    const canvas = { getContext: () => ctx2d, width: 800, height: 800, style: {} };
    const renderer = new Renderer(canvas);

    const game = {
        frameCount: 100,
        gameState: "playing",
        camera: { x: 0, y: 0, zoom: 1 },
        level: { level_id: 4 },
        nodes: [{ id: "payload", type: "payload", x: 0, y: 0 }],
        fuses: [],
        sparks: [],
        cuts: [{ x: 50, y: 120 }],
        lastSnipAt: 100,
        perfectSnipsAt: [{ x: 50, y: 120, at: 100 }],
        multikills: [{ x: 50, y: 120, at: 100, count: 2 }],
        noSnipsAt: null,
    };

    // Capture the resolved draw positions instead of drawing.
    const drawn = [];
    const origWord = renderer._drawPopupWord.bind(renderer);
    const origBank = renderer._drawBankCount.bind(renderer);
    renderer._drawPopupWord = (_g, text, _c, x, y, size) => drawn.push({ text, x, y, size });
    renderer._drawBankCount = (_g, mk, y) => drawn.push({ text: `+${mk.count}`, x: mk.x, y, size: 30 + mk.count * 5 });
    renderer._drawPopupWords(game);
    renderer._drawPopupWord = origWord;
    renderer._drawBankCount = origBank;

    const byText = Object.fromEntries(drawn.map((d) => [d.text, d]));
    check(drawn.length === 3, "popups: PERFECT + LAST SNIP + +N all drawn", JSON.stringify(drawn.map((d) => d.text)));
    const yPerfect = byText["PERFECT!"]?.y, yLast = byText["LAST SNIP!"]?.y, yBank = byText["+2"]?.y;
    check(yBank < yLast && yLast < yPerfect,
        "popups: stack order +N → LAST SNIP → PERFECT (top → bottom)",
        `bank=${yBank} last=${yLast} perfect=${yPerfect}`
    );

    // No two popups overlap at their padded extents (size*0.62*1.4 half-height).
    const half = (t) => byText[t].size * 0.62 * 1.4;
    const noOverlap = (a, b) => Math.abs(byText[a].y - byText[b].y) >= half(a) + half(b);
    check(
        noOverlap("+2", "PERFECT!") && noOverlap("+2", "LAST SNIP!") && noOverlap("PERFECT!", "LAST SNIP!"),
        "popups: PERFECT/LAST/+N boxes never overlap",
        `diffs bank-perfect=${Math.abs(yBank - yPerfect)} bank-last=${Math.abs(yBank - yLast)} perfect-last=${Math.abs(yPerfect - yLast)}`
    );

    // A denied swipe at the same spot adds NO MORE SNIPS! without collision.
    game.noSnipsAt = { at: 100, x: 50, y: 120 };
    drawn.length = 0;
    renderer._drawPopupWord = (_g, text, _c, x, y, size) => drawn.push({ text, x, y, size });
    renderer._drawBankCount = (_g, mk, y) => drawn.push({ text: `+${mk.count}`, x: mk.x, y, size: 30 + mk.count * 5 });
    renderer._drawPopupWords(game);
    renderer._drawPopupWord = origWord;
    renderer._drawBankCount = origBank;
    const all = Object.fromEntries(drawn.map((d) => [d.text, d]));
    const names = Object.keys(all);
    check(names.length === 4, "popups: NO MORE SNIPS! joins the stack", names.join(","));
    const halfAll = (t) => all[t].size * 0.62 * 1.4;
    let clear = true, worst = "";
    for (let i = 0; i < names.length && clear; i++) {
        for (let j = i + 1; j < names.length; j++) {
            const a = all[names[i]], b = all[names[j]];
            const ok = Math.abs(a.y - b.y) >= halfAll(a.text) + halfAll(b.text);
            if (!ok) { clear = false; worst = `${a.text}@${a.y} vs ${b.text}@${b.y}`; }
        }
    }
    check(clear, "popups: all four popups clear each other", worst);
}

console.log(failures === 0 ? "\nSMOKE PASS" : `\nSMOKE FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
