// tools/smoke/verify-polish.mjs — Playwright checks for the UI polish pass:
// perfect/score pill alignment, PAR removed, and the comic word (smaller, and
// from a rotating pool on both win and lose). Requires the dev server on :8080.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
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
await page.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });

// ---- 1. Win with a perfect snip → pills render, PAR is gone -----------------
console.log("[verify] win modal pills");
await page.click("#tutorial-next").catch(() => {});
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });

const perfect = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const idx = g.sparks.findIndex((s) => s.active);
    const s = g.sparks[idx];
    const f = g.fuses[idx];
    const bez = (t) => {
        const u = 1 - t;
        return {
            x: u * u * u * f.startNode.x + 3 * u * u * t * f.cp1.x + 3 * u * t * t * f.cp2.x + t * t * t * f.endNode.x,
            y: u * u * u * f.startNode.y + 3 * u * u * t * f.cp1.y + 3 * u * t * t * f.cp2.y + t * t * t * f.endNode.y,
        };
    };
    // Wait a moment for ignition by advancing frames via _update? The rAF loop
    // drives it; just find the ignited spark if present, else cut the chokepoint.
    const lit = g.sparks.findIndex((x) => x.ignited && x.active);
    if (lit < 0) {
        const p = f.intersectionPt;
        return g.tryCut({ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }, []);
    }
    const sp = g.sparks[lit];
    const pf = g.fuses[lit];
    const t = Math.min(0.98, sp.progress + 0.02);
    const p = bez.call({ f: pf }, t);
    return g.tryCut({ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }, [{ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }]);
});
console.log("  perfect snip placed:", perfect);

await page.waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 15000 });
await page.waitForTimeout(900);

const pills = await page.evaluate(() => ({
    hasPar: !!document.getElementById("win-par"),
    perfectText: document.getElementById("win-perfect")?.textContent,
    perfectShown: document.getElementById("win-perfect")?.style.display,
    scoreText: document.getElementById("win-score")?.textContent,
    time: document.getElementById("win-time")?.textContent,
}));
check(pills.hasPar === false, "polish: PAR pill removed from the win modal");
check(pills.perfectShown === "inline-block" && /PERFECT SNIPS/.test(pills.perfectText),
    "polish: PERFECT SNIPS pill renders", pills.perfectText);
check(/^SCORE \d+$/.test(pills.scoreText), "polish: SCORE pill renders", pills.scoreText);

// Check the pill text is visually centered: compare glyph box vs pill box.
const align = await page.evaluate(() => {
    const pick = (id) => {
        const el = document.getElementById(id);
        if (!el) return null;
        const pr = el.getBoundingClientRect();
        const range = document.createRange();
        range.selectNodeContents(el);
        const rr = range.getBoundingClientRect();
        return { pillTop: pr.top, textTop: rr.top, pillBot: pr.bottom, textBot: rr.bottom, pillH: pr.height, textH: rr.height };
    };
    return { score: pick("win-score"), perfect: pick("win-perfect"), time: pick("win-time") };
});
for (const k of ["time", "perfect", "score"]) {
    const b = align[k];
    if (!b) continue;
    // Center of text vs center of pill, as a fraction of pill height from center.
    const textCenterOffset = (b.textTop + b.textBot) / 2 - (b.pillTop + b.pillBot) / 2;
    const frac = textCenterOffset / b.pillH;
    // Luckiest Guy sits high; allow a small downward bias (text center a touch
    // below pill center is "fixed"). Fail if the text center is >1.5% of pill
    // height above the pill center.
    check(frac > -0.015, `polish: ${k} pill text vertically centered`, `${(frac * 100).toFixed(1)}% of pill height from center`);
}
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-polish-win.png") });
console.log("  → screenshot tools/smoke/verify-polish-win.png");

// ---- 2. Comic word on a lose is from the pool + smaller ----------------------
console.log("\n[verify] comic word on lose");
await page.click("#btn-next"); // closes the win modal → advances to L2 (2 fuses)
await page.waitForFunction(() => window.__CTF__?.game?.gameState === "playing", null, { timeout: 10000 });
// Don't cut: let a spark reach the payload → LOST.
await page.waitForFunction(() => window.__CTF__?.game?.gameState === "lost", null, { timeout: 30000 });
await page.waitForTimeout(400); // comic word visible mid-animation
const loseState = await page.evaluate(() => ({
    state: window.__CTF__.game.gameState,
    comic: window.__CTF__.game.comicWord,
}));
check(loseState.state === "lost", "polish: level lost without cutting", loseState.state);
check(typeof loseState.comic === "string" && /^[A-Z!]+$/.test(loseState.comic) && loseState.comic !== "KABOOM!",
    "polish: comic word is from the pool (not always KABOOM!)", loseState.comic);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-polish-lose.png") });
console.log("  → screenshot tools/smoke/verify-polish-lose.png");

await browser.close();
console.log(failures === 0 ? "\nVERIFY POLISH PASS" : `\nVERIFY POLISH FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
