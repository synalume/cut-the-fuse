// tools/smoke/verify-coverage.mjs — Playwright verification of burn-coverage
// stars (B4) + the win-modal BURN COVERAGE readout (B5) + sticky wicks (A3):
//   • L4 deep cut at the shared chokepoint  → coverage ≥30% → 3★
//   • L5 root-cut swipe                      → SNAPPED BACK (sticky deny, refund)
//   • L5 deep cut at the shared chokepoint  → coverage ≥30% → 3★
//   • L1 direct-fuse root cut (no junction) → tutorial band: 3★ on any win,
//     coverage readout hidden
// Requires the dev server on :8080. Run: node tools/smoke/verify-coverage.mjs
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

async function freshPage() {
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.goto(BASE);
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
    return page;
}

async function loadLevel(page, n) {
    await page.click("#btn-menu-play");
    await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
    await page.click("#level-label");
    await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
    await page.evaluate((id) => document.getElementById("level-grid").children[id - 1].click(), n);
    await page.waitForFunction((id) => {
        const g = window.__CTF__.game;
        return g?.gameState === "playing" && g?.level?.level_id === id;
    }, n, { timeout: 10000 });
    const tutShown = await page.evaluate(() => document.getElementById("tutorial-overlay").style.display === "flex");
    if (tutShown) await page.click("#tutorial-next").catch(() => {});
}

async function waitWin(page) {
    return page
        .waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 30000 })
        .then(() => true)
        .catch(() => false);
}

// ---- 1. L4 deep cut at the shared chokepoint → 3★ --------------------------
console.log("[verify] L4 deep chokepoint cut");
{
    const page = await freshPage();
    await loadLevel(page, 4);
    const cut = await page.evaluate(() => {
        const g = window.__CTF__.game;
        const cp = g.level.intersectionMap.cut1;
        return g.tryCut(
            { x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y },
            [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
        );
    });
    check(cut === true, "L4: deep snip lands at cut1", String(cut));
    check(await waitWin(page), "L4: level clears via deep cut");
    const res = await page.evaluate(() => ({
        coverage: Math.round(window.__CTF__.game.burnCoverage * 100),
        stars: window.__CTF__.game.lastLevelWin,
        readout: document.getElementById("win-coverage")?.textContent || "",
    }));
    check(res.stars === 3, "L4: deep cut earns 3★", `stars=${res.stars}`);
    check(res.coverage >= 30, "L4: coverage ≥ 30%", `coverage=${res.coverage}%`);
    check(/^BURN COVERAGE \d+%$/.test(res.readout), "L4: modal shows coverage readout", res.readout);
    await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-coverage-deep.png") });
    console.log("  → screenshot tools/smoke/verify-coverage-deep.png");
    await page.close();
}

// ---- 2. L5 root-cut swipe → snapped back (sticky deny) ----------------------
console.log("\n[verify] L5 sticky root-cut deny");
{
    const page = await freshPage();
    await loadLevel(page, 5);
    const res = await page.evaluate(() => {
        const g = window.__CTF__.game;
        const s = g.level.nodeMap;
        const x = (s.s1.x + s.s2.x + s.s3.x) / 3;
        const before = g.snipsRemaining;
        const ok = g.tryCut(
            { x, y: s.s1.y }, { x, y: s.s3.y },
            [{ x, y: s.s1.y }, { x, y: s.s3.y }]
        );
        return { ok, snips: g.snipsRemaining, before, snap: !!g.snapAt, playing: g.gameState === "playing" };
    });
    check(res.ok === false, "L5: root swipe snaps back (denied)", `ok=${res.ok}`);
    check(res.snips === res.before, "L5: snip refunded", `snips=${res.snips}/${res.before}`);
    check(res.snap === true, "L5: SNAP! feedback fired", String(res.snap));
    check(res.playing === true, "L5: level still playing — the spark kept running", String(res.playing));
    await page.screenshot({ path: path.join(ROOT, "tools/smoke/verify-sticky-snap.png") });
    console.log("  → screenshot tools/smoke/verify-sticky-snap.png");
    await page.close();
}

// ---- 3. L5 deep cut at the shared chokepoint → 3★ --------------------------
console.log("\n[verify] L5 deep chokepoint cut");
{
    const page = await freshPage();
    await loadLevel(page, 5);
    const cut = await page.evaluate(() => {
        const g = window.__CTF__.game;
        const cp = g.level.intersectionMap.cut1;
        return g.tryCut(
            { x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y },
            [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
        );
    });
    check(cut === true, "L5: deep snip lands at cut1", String(cut));
    check(await waitWin(page), "L5: level clears via deep cut");
    const res = await page.evaluate(() => ({
        coverage: Math.round(window.__CTF__.game.burnCoverage * 100),
        stars: window.__CTF__.game.lastLevelWin,
        readout: document.getElementById("win-coverage")?.textContent || "",
    }));
    check(res.stars === 3, "L5: deep cut earns 3★", `stars=${res.stars}`);
    check(res.coverage >= 30, "L5: coverage ≥ 30%", `coverage=${res.coverage}%`);
    check(/^BURN COVERAGE \d+%$/.test(res.readout), "L5: modal shows coverage readout", res.readout);
    await page.close();
}

// ---- 4. L1 direct-fuse root cut (no junction) → tutorial band 3★ -----------
console.log("\n[verify] L1 direct-fuse root cut → tutorial-band 3★");
{
    const page = await freshPage();
    await loadLevel(page, 1);
    const cut = await page.evaluate(() => {
        const g = window.__CTF__.game;
        const s = g.level.nodeMap.s1;
        return g.tryCut(
            { x: s.x - 20, y: s.y }, { x: s.x + 20, y: s.y },
            [{ x: s.x - 20, y: s.y }, { x: s.x + 20, y: s.y }]
        );
    });
    check(cut === true, "L1: root cut lands (direct fuse has no junction)", String(cut));
    check(await waitWin(page), "L1: level clears via root cut");
    const res = await page.evaluate(() => ({
        coverage: Math.round(window.__CTF__.game.burnCoverage * 100),
        stars: window.__CTF__.game.lastLevelWin,
        coverageVisible: document.getElementById("win-coverage").style.display !== "none",
    }));
    check(res.stars === 3, "L1: root cut earns 3★ (tutorial band — win-based)", `stars=${res.stars}`);
    check(res.coverageVisible === false, "L1: BURN COVERAGE readout hidden (no cross-sections)", String(res.coverageVisible));
    await page.close();
}

await browser.close();
console.log(failures === 0 ? "\nVERIFY COVERAGE PASS" : `\nVERIFY COVERAGE FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
