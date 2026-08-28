// tools/smoke/verify-daily.mjs — Playwright verification of the daily
// challenge: banner in the selector, entering the seeded level, winning it
// (via the QA hook) → streak + "done today" state.
// Requires the dev server on :8080. Run: node tools/smoke/verify-daily.mjs
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

// ---- 1. Level selector shows the daily banner -------------------------------
console.log("[verify] daily banner in the level selector");
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
const banner = await page.evaluate(() => ({
    btn: document.getElementById("btn-daily")?.textContent,
    disabled: document.getElementById("btn-daily")?.disabled,
    streak: document.getElementById("daily-streak")?.textContent,
}));
check(banner.btn?.includes("CHALLENGE"), "daily: challenge button is labeled", banner.btn);
check(banner.disabled === false, "daily: challenge enterable (not done today)", String(banner.disabled));
check(/STREAK \d+/.test(banner.streak || ""), "daily: streak pill rendered", banner.streak);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-daily-selector.png") });
console.log("  → screenshot tools/smoke/verify-daily-selector.png");

// ---- 2. Entering the challenge ----------------------------------------------
console.log("\n[verify] entering today's challenge");
const entered = await page.evaluate(() => {
    const btn = document.getElementById("btn-daily");
    btn.click();
    return true;
});
check(entered, "daily: challenge button clickable", String(entered));
await page.waitForFunction(() => document.getElementById("level-label").textContent === "DAILY ▾", null, { timeout: 10000 });
const label = await page.evaluate(() => document.getElementById("level-label").textContent);
check(label === "DAILY ▾", "daily: header tags the challenge", label);
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-daily-play.png") });
console.log("  → screenshot tools/smoke/verify-daily-play.png");

// ---- 3. Win the daily via the QA hook (deduped chokepoint cuts) --------------
console.log("\n[verify] daily win → streak + done-today state");
const placed = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const done = [];
    for (const fuse of g.fuses) {
        const p = fuse.intersectionPt;
        if (done.some((q) => Math.hypot(q.x - p.x, q.y - p.y) < 30)) continue;
        done.push(p);
    }
    if (done.length > g.snipsRemaining) return { ok: false, need: done.length, have: g.snipsRemaining };
    for (const p of done) g.cuts.push({ x: p.x, y: p.y, radius: 15, angle: 0, fuseId: null });
    return { ok: true, cuts: done.length };
});
check(placed.ok === true, "daily: chokepoint cuts fit the snip budget", JSON.stringify(placed));

const won = await page
    .waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 30000 })
    .then(() => true)
    .catch(() => false);
check(won, "daily: level clears via chokepoint cuts", String(won));

const winState = await page.evaluate(() => ({
    streakText: document.getElementById("win-streak")?.textContent,
    streakShown: document.getElementById("win-streak")?.style.display,
    nextBtn: document.getElementById("btn-next")?.textContent.trim(),
}));
check(winState.streakShown === "inline-block", "daily: win modal shows the STREAK pill", winState.streakText);
check(winState.streakText.includes("STREAK 1"), "daily: streak starts at 1", winState.streakText);
check(/^OK/.test(winState.nextBtn || ""), "daily: next button is OK (returns to map)", winState.nextBtn);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-daily-win.png") });
console.log("  → screenshot tools/smoke/verify-daily-win.png");

// ---- 4. Back at the selector: done today + streak persisted -----------------
console.log("\n[verify] done-today state after winning");
await page.click("#btn-next");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
const after = await page.evaluate(() => ({
    btn: document.getElementById("btn-daily")?.textContent,
    disabled: document.getElementById("btn-daily")?.disabled,
    streak: document.getElementById("daily-streak")?.textContent,
    save: JSON.parse(localStorage.getItem("cut_the_fuse_save_v1")),
}));
check(after.disabled === true, "daily: button disabled (done today)", String(after.disabled));
check((after.btn || "").includes("DONE"), "daily: button reads DONE for today", after.btn);
check(after.streak === "STREAK 1", "daily: streak pill shows 1", after.streak);
check(after.save.dailyStreak === 1 && !!after.save.lastDailyDay, "daily: streak persisted to the save", JSON.stringify({ s: after.save.dailyStreak, d: after.save.lastDailyDay }));

// ---- 5. Picking a story level exits daily mode ------------------------------
console.log("\n[verify] exit daily mode");
await page.evaluate(() => document.getElementById("level-grid").children[0].click());
await page.waitForFunction(() => document.getElementById("level-label").textContent === "LEVEL 1", null, { timeout: 10000 });
check(true, "daily: story pick exits daily mode (LEVEL 1)", "");
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-daily-exit.png") });
console.log("  → screenshot tools/smoke/verify-daily-exit.png");

await browser.close();
console.log(failures === 0 ? "\nVERIFY DAILY PASS" : `\nVERIFY DAILY FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
