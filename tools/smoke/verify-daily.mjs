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
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });

// ---- 1. Level selector shows the daily banner -------------------------------
console.log("[verify] daily banner in the level selector");
// Home screen first — press PLAY to load a level, then open the map.
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
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

// ---- 3. Win the daily via the QA hook ----------------------------------------
// Teaches the new mechanics like the generator's winnability math (mirrors the
// smoke sweep): a safe chokepoint costs 1 cut (+1 per armored fuse routed
// through it), a MIXED crossroad is cut upstream on each safe fuse's own leg,
// direct safe fuses cost 1 each (+1 if armored), and doused/forbidden decoys
// need no cut at all. Runs against the REAL cut pipeline in the page.
console.log("\n[verify] daily win → streak + done-today state");
const placed = await page.evaluate(() => {
    const g = window.__CTF__.game;
    // A daily that lands on a tutorial pin must dismiss its card before sweeping.
    const tut = document.getElementById("tutorial-overlay");
    if (tut && tut.style.display === "flex") {
        document.getElementById("tutorial-next").click();
        tut.style.display = "none";
        g.tutorialActive = false;
    }
    const level = g.level;
    const wr = level.wireRule || null;
    const isForb = (f) => !!(wr && f.color && wr.legend[f.color] === "no");
    const dousedIds = new Set((level.douse || []).map((d) => d.fuseId));
    const bez = (u, f) => {
        const mt = 1 - u;
        const a = mt * mt * mt, b = 3 * mt * mt * u, c = 3 * mt * u * u, d = u * u * u;
        return {
            x: a * f.startNode.x + b * f.cp1.x + c * f.cp2.x + d * f.endNode.x,
            y: a * f.startNode.y + b * f.cp1.y + c * f.cp2.y + d * f.endNode.y,
        };
    };
    const byCp = new Map();
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
        byCp.get(f.routeThrough).push(f);
    }
    const actions = [];
    for (const [cpId, grp] of byCp) {
        const hasForbidden = grp.some(isForb);
        const cuttable = grp.filter((f) => !isForb(f) && !dousedIds.has(f.id));
        if (hasForbidden) {
            for (const f of cuttable) {
                const leg = bez(0.24, f);
                actions.push({ x: leg.x, y: leg.y });
                if (f.armor) actions.push({ x: leg.x, y: leg.y });
            }
        } else if (cuttable.length) {
            const cp = level.intersectionMap[cpId];
            actions.push({ x: cp.x, y: cp.y });
            for (const f of cuttable) if (f.armor) actions.push({ x: cp.x, y: cp.y });
        }
    }
    for (const f of level.fuses) {
        if (f.routeThrough || isForb(f) || dousedIds.has(f.id)) continue;
        actions.push({ x: f.intersectionPt.x, y: f.intersectionPt.y });
        if (f.armor) actions.push({ x: f.intersectionPt.x, y: f.intersectionPt.y });
    }
    let placed = 0;
    let denied = 0;
    for (const a of actions) {
        const ok = g.tryCut({ x: a.x - 26, y: a.y }, { x: a.x + 26, y: a.y }, [{ x: a.x - 26, y: a.y }, { x: a.x + 26, y: a.y }]);
        if (ok) placed++;
        else denied++;
    }
    return { ok: placed <= level.snipsAllowed, need: actions.length, placed, denied, snips: g.snipsRemaining };
});
check(placed.ok === true, "daily: mechanic-aware cuts fit the snip budget", JSON.stringify(placed));

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
check(after.disabled === false, "daily: button stays enabled after a clear (replay)", String(after.disabled));
check((after.btn || "").includes("REPLAY"), "daily: button reads REPLAY for today", after.btn);
check(/^STREAK 1/.test(after.streak || ""), "daily: streak pill shows 1", after.streak);
check(after.save.dailyStreak === 1 && !!after.save.lastDailyDay, "daily: streak persisted to the save", JSON.stringify({ s: after.save.dailyStreak, d: after.save.lastDailyDay }));

// ---- 5. Replaying after a clear re-enters the challenge ----------------------
console.log("\n[verify] replay after clear");
await page.evaluate(() => document.getElementById("btn-daily").click());
await page.waitForFunction(() => document.getElementById("level-label").textContent === "DAILY ▾", null, { timeout: 10000 });
check(true, "daily: replay button re-enters the challenge", "");
const replayLevel = await page.evaluate(() => window.__CTF__.game.level?.level_id);
check(replayLevel != null, "daily: replay loads the daily level", String(replayLevel));

// ---- 6. Picking a story level exits daily mode ------------------------------
console.log("\n[verify] exit daily mode");
await page.evaluate(() => document.getElementById("level-label").click());
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none", null, { timeout: 8000 });
await page.evaluate(() => document.getElementById("level-grid").children[0].click());
await page.waitForFunction(() => document.getElementById("level-label").textContent === "LEVEL 1", null, { timeout: 10000 });
check(true, "daily: story pick exits daily mode (LEVEL 1)", "");
await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-daily-exit.png") });
console.log("  → screenshot tools/smoke/verify-daily-exit.png");

await browser.close();
console.log(failures === 0 ? "\nVERIFY DAILY PASS" : `\nVERIFY DAILY FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
