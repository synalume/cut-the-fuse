// tools/smoke/verify-ui.mjs — Playwright browser verification of the new
// difficulty + speed-reward features. Requires the dev server on :8080.
// Run: node tools/smoke/verify-ui.mjs
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));
const BASE = "http://localhost:8080";

let failures = 0;
function check(ok, label, extra = "") {
    if (ok) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ ${label}${extra ? " — " + extra : ""}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });

page.on("pageerror", (e) => console.error("  [pageerror]", e.message));

await page.goto(BASE);
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
console.log("[verify] game booted");

// Home screen first — press PLAY to load the level.
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });

// world -> screen helper (mirrors InputHandler.screenToWorld inverse).
const toScreen = (wx, wy) => page.evaluate(([wx, wy]) => {
    const { game, renderer } = window.__CTF__;
    const cw = renderer.width, ch = renderer.height;
    const c = game.camera;
    return {
        x: (wx + c.x - cw / 2) * c.zoom + cw / 2,
        y: (wy + c.y - ch / 2) * c.zoom + ch / 2,
    };
}, [wx, wy]);

// ---- 1. Level 1 real-input win → win modal stats ---------------------------
console.log("\n[verify] Level 1 win via real swipe");

// Dismiss the swipe tutorial.
await page.click("#tutorial-next");
await page.waitForFunction(() => document.getElementById("tutorial-overlay").style.display === "none");

// Swipe across the fuse just ahead of the live spark (the speed-reward move).
const l1Target = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const idx = g.sparks.findIndex((s) => s.active);
    const s = g.sparks[idx];
    const f = g.fuses[idx];
    const bez = (t) => {
        const { x: x0, y: y0 } = f.startNode, { x: x1, y: y1 } = f.cp1;
        const { x: x2, y: y2 } = f.cp2, { x: x3, y: y3 } = f.endNode;
        const u = 1 - t;
        return {
            x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        };
    };
    const t = Math.min(0.98, s.progress + 0.03);
    return bez(t);
});
let p = await toScreen(l1Target.x, l1Target.y);
const rect = await page.evaluate(() => {
    const r = document.getElementById("game-canvas").getBoundingClientRect();
    return { left: r.left, top: r.top };
});
await page.mouse.move(p.x + rect.left, p.y + rect.top - 24);
await page.mouse.down();
await page.mouse.move(p.x + rect.left, p.y + rect.top + 24, { steps: 3 });
await page.mouse.up();

await page.waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 15000 });
const winStats = await page.evaluate(() => ({
    time: document.getElementById("win-time").textContent,
    par: document.getElementById("win-par"), // removed from the UI
    record: document.getElementById("win-record").style.display,
    recordText: document.getElementById("win-record").textContent,
    stats: document.getElementById("win-stats").style.display,
}));
check(/^TIME \d+\.\ds$/.test(winStats.time), "win modal shows a clear time", winStats.time);
check(winStats.par === null, "win modal no longer shows the PAR pill", String(winStats.par));
check(winStats.record === "inline-block", "win modal flags a NEW RECORD", winStats.record);
check(winStats.stats !== "none", "win stats row is visible", winStats.stats);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-win-modal.png") });
console.log("  → screenshot tools/smoke/verify-win-modal.png");

// ---- 2. Level select shows the best time -----------------------------------
console.log("\n[verify] Level select best time");
await page.click("#btn-next"); // close win modal, goes to L2
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
const cell1Time = await page.evaluate(() =>
    document.getElementById("level-grid").children[0].querySelector(".time")?.textContent || ""
);
check(/^\d+\.\ds$/.test(cell1Time), "level 1 cell shows its best time", `"${cell1Time}"`);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-level-select.png") });

// ---- 3. Level 8 fork tutorial ----------------------------------------------
console.log("\n[verify] L8 fork tutorial");
await page.evaluate(() => {
    const cell = document.getElementById("level-grid").children[7];
    cell.click();
});
await page.waitForFunction(() => document.getElementById("tutorial-overlay").style.display === "flex");
const l8Text = await page.evaluate(() => document.getElementById("tutorial-text").textContent);
check(l8Text.includes("fork") && l8Text.includes("NEW wick"), "L8 tutorial teaches the fork mechanic", l8Text.slice(0, 80));
const l8Config = levels.find((l) => l.level_id === 8);
check(l8Config.fuses.filter((f) => f.branchOf).length === 1, "L8 config has exactly one branch wick", "");
const forkDemo = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const bi = g.sparks.findIndex((s) => s.chain);
    const chain = bi >= 0 ? g.sparks[bi].chain : null;
    const r = window.__CTF__.renderer;
    return {
        tutorialActive: g.tutorialActive,
        hasChain: !!chain,
        forkAt: chain?.at,
        handLoaded: r._handImg?.complete,
        hasDemo: typeof r._drawForkTutorialDemo === "function",
    };
});
check(forkDemo.tutorialActive && forkDemo.hasChain && forkDemo.forkAt > 0 && forkDemo.forkAt < 1,
    "L8 tutorial: fork point resolves on the parent wick", `at=${forkDemo.forkAt}`);
check(forkDemo.hasDemo && forkDemo.handLoaded, "L8 tutorial: pointing-hand fork demo is armed", "");
await page.click("#tutorial-next");

// ---- 3b. L8 fork visuals: cold → warm → dud ---------------------------------
console.log("\n[verify] L8 fork visuals (cold / warm / dud)");
await page.waitForFunction(() => {
    const g = window.__CTF__.game;
    return g.gameState === "playing";
}, null, { timeout: 5000 });
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-l8-fork-cold.png") });
console.log("  → screenshot tools/smoke/verify-l8-fork-cold.png");

// Warm: the parent's burn crosses the fork → the branch ignites from that point.
const warmed = await page
    .waitForFunction(() => {
        const g = window.__CTF__.game;
        const cs = g.sparks.find((s) => s.chain);
        return cs && cs.triggered && cs.ignited;
    }, null, { timeout: 60000 })
    .then(() => true)
    .catch(() => false);
check(warmed, "L8 fork ignites as the parent's burn crosses it", "");
if (warmed) {
    await page.waitForTimeout(200);
    await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-l8-fork-warm.png") });
    console.log("  → screenshot tools/smoke/verify-l8-fork-warm.png");
}

// Sticky snap: fresh attempt, cut the parent's wick BEFORE the fork → the cut
// snaps back (denied, snip refunded) and the branch still lights — forks can
// no longer be starved by an early parent cut.
await page.evaluate(() => window.__CTF__.game.resetLevel());
await page.waitForTimeout(100);
const cutParentEarly = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const cs = g.sparks.find((s) => s.chain);
    const ps = g.sparks[cs.chain.fromFuseIndex];
    const pf = g.fuses[ps.fuseIndex];
    const bez = (t) => {
        const { x: x0, y: y0 } = pf.startNode, { x: x1, y: y1 } = pf.cp1;
        const { x: x2, y: y2 } = pf.cp2, { x: x3, y: y3 } = pf.endNode;
        const u = 1 - t;
        return {
            x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        };
    };
    const t = Math.max(0.05, cs.chain.at - 0.12);
    const p = bez(t);
    const res = g.tryCut(
        { x: p.x - 8, y: p.y },
        { x: p.x + 8, y: p.y },
        [{ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }]
    );
    return { res, snap: !!g.snapAt, snips: g.snipsRemaining, allowed: g.level.snipsAllowed };
});
check(cutParentEarly.res === false, "L8 sticky: pre-fork cut snaps back (denied)", `res=${cutParentEarly.res}`);
check(cutParentEarly.snap === true, "L8 sticky: SNAP! feedback fired", String(cutParentEarly.snap));
check(cutParentEarly.snips === cutParentEarly.allowed, "L8 sticky: snip refunded", `snips=${cutParentEarly.snips}/${cutParentEarly.allowed}`);
const relit = await page
    .waitForFunction(() => {
        const g = window.__CTF__.game;
        const cs = g.sparks.find((s) => s.chain);
        return cs && cs.triggered && cs.ignited;
    }, null, { timeout: 20000 })
    .then(() => true)
    .catch(() => false);
check(relit, "L8 sticky: branch still lights after the denied pre-fork cut", "");
await page.waitForTimeout(150);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-l8-fork-snap.png") });
console.log("  → screenshot tools/smoke/verify-l8-fork-snap.png");

// ---- 4. PERFECT SNIP on L3 via the QA hook ---------------------------------
console.log("\n[verify] PERFECT SNIP detection (live game loop)");
await page.evaluate(() => {
    const cell = document.getElementById("level-grid").children[2];
    cell.click();
});
// L3 is a single direct fuse — non-sticky — so the ahead-cut can land anywhere
// on it. Dismiss its tutorial so the sim starts.
await page.waitForFunction(() => document.getElementById("tutorial-overlay").style.display === "flex", null, { timeout: 8000 });
await page.click("#tutorial-next");
// Wait until the first spark is ignited and moving. (L1 is a direct fuse —
// non-sticky — so the ahead-cut can land anywhere on it.)
await page.waitForFunction(() => {
    const g = window.__CTF__.game;
    return g.sparks.some((s) => s.ignited && s.active);
}, null, { timeout: 10000 });

const snip = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const idx = g.sparks.findIndex((s) => s.ignited && s.active);
    const s = g.sparks[idx];
    const f = g.fuses[idx];
    const bez = (t) => {
        const { x: x0, y: y0 } = f.startNode, { x: x1, y: y1 } = f.cp1;
        const { x: x2, y: y2 } = f.cp2, { x: x3, y: y3 } = f.endNode;
        const u = 1 - t;
        return {
            x: u * u * u * x0 + 3 * u * u * t * x1 + 3 * u * t * t * x2 + t * t * t * x3,
            y: u * u * u * y0 + 3 * u * u * t * y1 + 3 * u * t * t * y2 + t * t * t * y3,
        };
    };
    const t = s.progress + 0.02;
    const p = bez(t);
    const q = bez(Math.min(1, t + 0.01));
    const dx = q.x - p.x, dy = q.y - p.y;
    const L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * 12, ny = (dx / L) * 12;
    const res = g.tryCut(
        { x: p.x + nx, y: p.y + ny },
        { x: p.x - nx, y: p.y - ny },
        [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }]
    );
    return { res, perfect: g.perfectSnips, count: g.perfectSnipsAt.length };
});
check(snip.res === true, "perfect: cut placed on the burning fuse", String(snip.res));
check(snip.perfect === 1, "perfect: live loop counted a PERFECT SNIP", `count=${snip.perfect}`);
await page.waitForTimeout(400); // let the popup render
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-perfect-snip.png") });
console.log("  → screenshot tools/smoke/verify-perfect-snip.png");

// A far chokepoint cut on a fresh attempt must NOT count.
await page.evaluate(() => window.__CTF__.game.resetLevel());
await page.waitForFunction(() => {
    const g = window.__CTF__.game;
    return g.sparks.some((s) => s.ignited && s.active);
}, null, { timeout: 10000 });
const far = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const idx = g.sparks.findIndex((s) => s.ignited && s.active);
    const f = g.fuses[idx];
    const it = f.intersectionPt;
    const res = g.tryCut(
        { x: it.x - 6, y: it.y },
        { x: it.x + 6, y: it.y },
        [{ x: it.x - 6, y: it.y }, { x: it.x + 6, y: it.y }]
    );
    return { res, perfect: g.perfectSnips };
});
check(far.res === true && far.perfect === 0, "perfect: a far chokepoint cut is not perfect", `perfect=${far.perfect}`);

await browser.close();

console.log(failures === 0 ? "\nVERIFY PASS" : `\nVERIFY FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
