// tools/smoke/layout-preview.mjs — render all level layouts as an SVG montage.
// Run: node tools/smoke/layout-preview.mjs
// Writes to tools/smoke/layout-preview.svg for quick visual QA.
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { getBezierXY } from "../../src/engine/MathUtils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));

const COLS = 12;
const TH = 70; // thumb width
const TV = 46; // thumb height
const PAD = 8;
const W = COLS * TH + (COLS + 1) * PAD;
const ROWS = Math.ceil(levels.length / COLS);
const H = ROWS * TV + (ROWS + 1) * PAD;

function normalize(nodes) {
    const xs = nodes.map((n) => n.x);
    const ys = nodes.map((n) => n.y);
    const minX = Math.min(...xs), maxX = Math.max(...xs);
    const minY = Math.min(...ys), maxY = Math.max(...ys);
    const span = Math.max(1, Math.max(maxX - minX, maxY - minY));
    const s = (TH - 8) / span;
    const ox = TH / 2 - ((minX + maxX) / 2) * s;
    const oy = TV / 2 - ((minY + maxY) / 2) * s;
    return (p) => ({ x: p.x * s + ox, y: p.y * s + oy });
}

let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" font-family="Courier New, monospace">
<rect width="${W}" height="${H}" fill="#f5f5f4"/>`;

levels.forEach((lvl, i) => {
    const col = i % COLS;
    const row = Math.floor(i / COLS);
    const x0 = PAD + col * (TH + PAD);
    const y0 = PAD + row * (TV + PAD);

    const all = [
        ...(lvl.payloads || [lvl.payload]),
        ...lvl.spawns,
        ...lvl.intersections,
    ];
    const to = normalize(all);
    const payloadOf = (end) => (lvl.payloads || []).find((p) => p.id === end) || lvl.payload;

    out += `<g transform="translate(${x0},${y0})">`;
    // thumbnail bg
    out += `<rect width="${TH}" height="${TV}" fill="#ffffff" stroke="#d6d3d1" stroke-width="1"/>`;
    out += `<text x="${TH - 4}" y="11" font-size="9" text-anchor="end" fill="#1c1917" font-weight="bold">${String(lvl.level_id).padStart(2, "0")}</text>`;

    const nodes = {
        bomb: (lvl.payloads || []).map((p) => to(p)),
        spawn: lvl.spawns.map((s) => to(s)),
        cuts: lvl.intersections.map((c) => to(c)),
    };

    // fuses
    for (const f of lvl.fuses) {
        const sNode = f.branchOf ? f.branchPoint : lvl.spawns.find((s) => s.id === f.start);
        const p0 = to(sNode);
        const p3 = to(payloadOf(f.end));
        const cut = lvl.intersections.find((c) => c.id === f.routeThrough);
        const mid = cut ? to(cut) : { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
        const cp = { x: (mid.x - 0.125 * (p0.x + p3.x)) / 0.75, y: (mid.y - 0.125 * (p0.y + p3.y)) / 0.75 };
        let d = "";
        for (let t = 0; t <= 1; t += 0.04) {
            const pt = getBezierXY(t, p0, cp, cp, p3);
            d += (t === 0 ? "M" : "L") + pt.x.toFixed(1) + " " + pt.y.toFixed(1);
        }
        out += `<path d="${d}" fill="none" stroke="#d97706" stroke-width="1.6"/>`;
    }
    // chokepoints
    for (const c of nodes.cuts) {
        out += `<circle cx="${c.x.toFixed(1)}" cy="${c.y.toFixed(1)}" r="2.4" fill="#22c55e" stroke="#1c1917" stroke-width="0.6"/>`;
    }
    // spawns (matchsticks)
    for (const s of nodes.spawn) {
        out += `<rect x="${(s.x - 2.2).toFixed(1)}" y="${(s.y - 2.2).toFixed(1)}" width="4.4" height="4.4" fill="#ef4444" stroke="#1c1917" stroke-width="0.6"/>`;
    }
    // payload(s) (bomb art)
    for (const b of nodes.bomb) {
        out += `<circle cx="${b.x.toFixed(1)}" cy="${b.y.toFixed(1)}" r="5" fill="#1c1917" stroke="#fef08a" stroke-width="1.2"/>`;
    }

    // layout tag
    out += `<text x="4" y="${TV - 4}" font-size="7.5" fill="#78716c">${lvl.layout || "hub"}</text>`;
    out += `</g>`;
});

out += `</svg>`;
writeFileSync(path.join(ROOT, "tools/smoke/layout-preview.svg"), out);
console.log(`Wrote layout-preview.svg (${levels.length} levels, ${W}x${H})`);
