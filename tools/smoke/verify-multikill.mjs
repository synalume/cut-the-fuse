// tools/smoke/verify-multikill.mjs — Playwright verification of the multi-cut
// banking feedback: a single snip at a shared chokepoint severs N wicks, the
// "+N" popup renders, and the win modal shows the efficiency score + NEW BEST.
// Requires the dev server on :8080. Run: node tools/smoke/verify-multikill.mjs
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

// ---- 1. Load L4 (2 fuses share cut1) ---------------------------------------
console.log("[verify] L4 multi-cut setup");
// Home screen first — press PLAY to load a level, then pick L4 from the map.
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
await page.evaluate(() => document.getElementById("level-grid").children[3].click());
await page.waitForFunction(() => {
    const g = window.__CTF__.game;
    return g?.gameState === "playing" && g?.level?.level_id === 4;
}, null, { timeout: 10000 });
// Dismiss L4's teaching card — the sim stays frozen until OK.
const tutShown = await page.evaluate(() => document.getElementById("tutorial-overlay").style.display === "flex");
if (tutShown) await page.click("#tutorial-next").catch(() => {});

// ---- 2. One snip at the shared chokepoint -----------------------------------
console.log("\n[verify] one snip severs 2 wicks");
const cut = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const cp = g.level.intersectionMap.cut1;
    return g.tryCut(
        { x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y },
        [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
    );
});
check(cut === true, "multikill: snip lands at the shared chokepoint", String(cut));

const mk = await page.evaluate(() => ({
    list: window.__CTF__.game.multikills.map((m) => m.count),
    stars: window.__CTF__.game.multikillStars,
}));
check(mk.list.length === 1 && mk.list[0] === 2, "multikill: counts 2 severed wicks", JSON.stringify(mk.list));
check(mk.stars === 1, "multikill: banks 1 bonus star", String(mk.stars));

await page.waitForTimeout(300); // let the +2 popup render mid-animation
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-multikill-popup.png") });
console.log("  → screenshot tools/smoke/verify-multikill-popup.png");

// ---- 3. Win the level, check the score + NEW BEST ---------------------------
console.log("\n[verify] win modal efficiency score");
await page.evaluate(() => {
    // Ensure every remaining chokepoint is cut so the level clears.
    const g = window.__CTF__.game;
    const placed = [];
    for (const f of g.fuses) {
        const p = f.intersectionPt;
        if (placed.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 30)) continue;
        placed.push(p);
    }
    for (const p of placed) g.cuts.push({ x: p.x, y: p.y, radius: 15, angle: 0, fuseId: null });
});
const won = await page
    .waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
check(won, "multikill: level clears after the snip", String(won));

const win = await page.evaluate(() => ({
    score: document.getElementById("win-score")?.textContent,
    bestShown: document.getElementById("win-best")?.style.display,
    stars: document.getElementById("star-display")?.textContent,
    save: JSON.parse(localStorage.getItem("cut_the_fuse_save_v1")),
}));
check(/^SCORE \d+$/.test(win.score || ""), "multikill: win modal shows SCORE", win.score);
check(win.bestShown === "inline-block", "multikill: NEW BEST! shown on first clear", win.bestShown);
const expectStars = 3 + 1; // 3★ clear + 1 multi-cut bonus star
check(win.stars.trim() === String(expectStars), "multikill: bonus star banked at clear", `bank=${win.stars}`);
check(win.save.bestScores["4"] > 0, "multikill: best score persisted", String(win.save.bestScores?.["4"]));
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-multikill-win.png") });
console.log("  → screenshot tools/smoke/verify-multikill-win.png");

await browser.close();
console.log(failures === 0 ? "\nVERIFY MULTIKILL PASS" : `\nVERIFY MULTIKILL FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
