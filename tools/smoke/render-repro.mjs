// tools/smoke/render-repro.mjs — replay the REAL Renderer against a recording
// 2D context and dump the drawn wicks/assets to SVG, so we can inspect exactly
// what the game draws for any level without a browser.
// Run: node tools/smoke/render-repro.mjs <levelId>
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Renderer } from "../../src/engine/Renderer.js";
import { buildLevel } from "../../src/engine/LevelManager.js";
import { GameLoop, STATE } from "../../src/engine/GameLoop.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levelId = Number(process.argv[2] || 37);
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));
const cfg = levels.find((l) => l.level_id === levelId);

// ---- recording context ------------------------------------------------------
const ops = [];
const ctxProxy = new Proxy(
    {},
    {
        get(t, p) {
            if (p === "save") return () => ops.push(["save"]);
            if (p === "restore") return () => ops.push(["restore"]);
            if (p === "translate") return (x, y) => ops.push(["translate", x, y]);
            if (p === "scale") return (sx, sy) => ops.push(["scale", sx, sy]);
            if (p === "rotate") return (r) => ops.push(["rotate", r]);
            if (p === "beginPath") return () => ops.push(["beginPath"]);
            if (p === "moveTo") return (x, y) => ops.push(["moveTo", x, y]);
            if (p === "lineTo") return (x, y) => ops.push(["lineTo", x, y]);
            if (p === "bezierCurveTo") return (c1x, c1y, c2x, c2y, x, y) => ops.push(["bezier", c1x, c1y, c2x, c2y, x, y]);
            if (p === "stroke") return () => ops.push(["stroke"]);
            if (p === "drawImage") return () => ops.push(["drawImage"]);
            if (p === "arc") return (x, y, r) => ops.push(["arc", x, y, r]);
            if (p === "fillRect") return (x, y, w, h) => ops.push(["fillRect", x, y, w, h]);
            if (p === "setLineDash") return () => ops.push(["setLineDash"]);
            if (p === "clearRect") return () => {};
            if (typeof p === "string") return () => {}; // any other method is a no-op
            return undefined;
        },
        set(t, p, v) { ops.push(["set", p, v]); return true; },
    }
);

globalThis.window = { innerWidth: 1280, innerHeight: 720 };
globalThis.Image = class { };
const canvas = { getContext: () => ctxProxy };
const renderer = new Renderer(canvas);

// Build the level with placeholder assets, mirroring main.js.
const level = buildLevel(cfg, { width: 1280, height: 720 });
renderer.loadAssets(level.payloadAssets);
renderer.loadAssets(level.spawnAssets);

const game = new GameLoop({ canvas, renderer, audio: null, analytics: null, platform: null });
game.loadLevel(level, 0);
renderer.draw(game);

// ---- convert recorded ops to SVG ---------------------------------------------
// We replay the transform stack to compute screen-space coordinates.
const W = 1280, H = 720;
const stack = [];
let tx = [0, 0], sc = [1, 1], rot = 0;

function push(x, y) { const c = Math.cos(rot), s = Math.sin(rot); return [tx[0] + x * sc[0] * c - y * sc[1] * s, tx[1] + x * sc[0] * s + y * sc[1] * c]; }
function translate(x, y) { tx = [tx[0] + x * sc[0], tx[1] + y * sc[1]]; }
function scale(x, y) { sc = [sc[0] * x, sc[1] * y]; }
function rotate(r) { rot += r; }

let paths = [];
let cur = null;
const strokes = [];
const rects = [];

for (const op of ops) {
    const k = op[0];
    if (k === "save") stack.push([tx, sc, rot]);
    else if (k === "restore") { const s = stack.pop(); tx = s[0]; sc = s[1]; rot = s[2]; }
    else if (k === "translate") translate(op[1], op[2]);
    else if (k === "scale") scale(op[1], op[2]);
    else if (k === "rotate") rotate(op[1]);
    else if (k === "beginPath") { cur = []; paths.push(cur); }
    else if (k === "moveTo") { const p = push(op[1], op[2]); cur.push(["M", p[0], p[1]]); }
    else if (k === "lineTo") { const p = push(op[1], op[2]); cur.push(["L", p[0], p[1]]); }
    else if (k === "bezier") {
        const p = push(op[5], op[6]);
        // approximate the cubic with a polyline
        const c1 = push(op[1], op[2]), c2 = push(op[3], op[4]);
        const start = cur.length ? cur[cur.length - 1] : ["M", 0, 0];
        for (let t = 0.05; t <= 1.0001; t += 0.05) {
            const mt = 1 - t;
            const x = mt * mt * mt * start[1] + 3 * mt * mt * t * c1[0] + 3 * mt * t * t * c2[0] + t * t * t * p[0];
            const y = mt * mt * mt * start[2] + 3 * mt * mt * t * c1[1] + 3 * mt * t * t * c2[1] + t * t * t * p[1];
            cur.push(["L", x, y]);
        }
        cur.push(["END", p[0], p[1]]);
    }
    else if (k === "stroke") { strokes.push(paths.splice(0).map((c) => c.slice())); cur = null; }
    else if (k === "drawImage") rects.push([tx[0], tx[1], sc[0], sc[1]]);
}

// Assemble SVG: each stroke becomes a path; record endpoints.
let svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#f5f5f4"/>`;
const endpoints = [];
strokes.forEach((s) => {
    for (const path of s) {
        let d = "";
        for (const seg of path) {
            if (seg[0] === "M") d += `M${seg[1].toFixed(1)} ${seg[2].toFixed(1)}`;
            else if (seg[0] === "L") d += `L${seg[1].toFixed(1)} ${seg[2].toFixed(1)}`;
            else if (seg[0] === "END") endpoints.push([seg[1], seg[2]]);
        }
        if (d) svg += `<path d="${d}" fill="none" stroke="#d97706" stroke-width="4"/>`;
    }
});
// drawImage rects (payload + spawn assets) as dotted outlines
rects.forEach((r) => { svg += `<rect x="${(r[0] - r[2] / 2).toFixed(1)}" y="${(r[1] - r[3] / 2).toFixed(1)}" width="${r[2].toFixed(1)}" height="${r[3].toFixed(1)}" fill="none" stroke="#1c1917" stroke-dasharray="3 3"/>`; });
// endpoint dots
endpoints.forEach((e) => { svg += `<circle cx="${e[0].toFixed(1)}" cy="${e[1].toFixed(1)}" r="5" fill="#22c55e"/>`; });
svg += "</svg>";

const outFile = path.join(ROOT, "tools/smoke/lvl-repro.svg");
writeFileSync(outFile, svg);
console.log(`Rendered L${levelId} → ${outFile}`);
console.log(`fuses drawn: ${strokes.length}, endpoints: ${endpoints.length}`);
const uniq = new Set(endpoints.map((e) => `${e[0].toFixed(1)},${e[1].toFixed(1)}`));
console.log(`distinct endpoint positions: ${uniq.size}`);
for (const u of uniq) console.log("  ", u);
