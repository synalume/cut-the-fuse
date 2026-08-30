// tools/smoke/verify-hints.mjs — audit the green-X hint targets against the
// generator's required-cut model after wick shaping + star anchoring changes.
// Run: node tools/smoke/verify-hints.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));

import { buildLevel, computeFitCamera } from "../../src/engine/LevelManager.js";
import { GameLoop, STATE } from "../../src/engine/GameLoop.js";
import { fuseClosest } from "../../src/engine/MathUtils.js";

const renderer = {
    width: 1280,
    height: 720,
    computeFitCamera: (level) => computeFitCamera(level, { width: 1280, height: 720 }),
    draw() {},
};
const audio = { play() {}, startLoop() {}, stopLoop() {} };
const analytics = { track() {} };
const platform = { gameplayStart() {}, gameplayStop() {} };

function swipeAcross(game, x, y) {
    return game.tryCut({ x: x - 26, y }, { x: x + 26, y }, [{ x: x - 26, y }, { x: x + 26, y }]);
}

const problems = [];
let checkedTargets = 0;
let hintWins = 0;

for (const config of levels) {
    const level = buildLevel(config, { width: 1280, height: 720 });
    const game = new GameLoop({ canvas: null, renderer, audio, analytics, platform });
    game.loadLevel(level, 0);

    const wr = level.wireRule || null;
    const isForb = (f) => !!(wr && f.color && wr.legend[f.color] === "no");
    const dousedIds = new Set((level.douse || []).map((d) => d.fuseId ?? d.fuse));
    const targets = game.hintTargets || [];

    for (const { fuse, point } of targets) {
        checkedTargets++;
        const label = `L${config.level_id} hint on ${fuse.id}`;

        // 1. Marker must sit ON the wick's visible (shaped) curve.
        const onCurve = fuseClosest(fuse, point.x, point.y).dist;
        if (onCurve > 1.5) problems.push(`${label} floats ${onCurve.toFixed(1)}px off its curve`);

        // 2. Marker must never sit on a forbidden wire (true distance, 50-step).
        for (const fb of game.fuses) {
            if (!isForb(fb)) continue;
            const d = fuseClosest(fb, point.x, point.y).dist;
            if (d < 12) problems.push(`${label} ${d.toFixed(1)}px from forbidden ${fb.id}`);
        }

        // 3. A doused wick is handled by water — it must not be suggested as a cut.
        if (dousedIds.has(fuse.id)) {
            problems.push(`${label} sits on a water-doused wick (never needs a cut)`);
        }
    }

    // 4. Following the hints (one swipe per unique X) must win within budget.
    const seen = new Set();
    const actions = [];
    for (const { point } of targets) {
        const key = `${point.x.toFixed(1)},${point.y.toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        actions.push(point);
    }
    let placed = 0;
    for (const p of actions) if (swipeAcross(game, p.x, p.y)) placed++;
    if (placed > config.snipsAllowed) {
        problems.push(`L${config.level_id}: following the hints needs ${placed} snips > budget ${config.snipsAllowed}`);
    }
    for (let i = 0; i < 6000; i++) {
        game.frameCount++;
        game._update();
        if (game.gameState !== STATE.PLAYING) break;
    }
    if (game.gameState === STATE.WON) hintWins++;
    else problems.push(`L${config.level_id}: following the hints ended ${game.gameState} (${placed} cuts, budget ${config.snipsAllowed})`);
}

console.log(`audited ${checkedTargets} hint targets across ${levels.length} levels`);
console.log(`hint-follow wins: ${hintWins}/${levels.length}`);
if (problems.length) {
    console.error(problems.join("\n"));
    process.exit(1);
}
console.log("hint audit: all targets on-curve, clear of forbidden wires, none on doused wicks, hints always win within budget");
