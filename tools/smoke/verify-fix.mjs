// verify-fix.mjs — end-to-end check of the two reported bugs:
// 1) levels load after selection (canvas renders), 2) PLAY starts at Level 1
// even with a fully-unlocked save.
import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
// A maxed-out save: everything cleared + unlocked 120 → PLAY must start at Level 1.
await context.addInitScript(() => {
    const stars = {};
    for (let i = 1; i <= 120; i++) stars[String(i)] = 3;
    localStorage.setItem("cut_the_fuse_save_v1", JSON.stringify({
        stars, unlockedLevel: 120, starBank: 0, skins: {}, selectedSkin: null,
        igniters: {}, selectedIgniter: null, bestTimes: {}, bestScores: {},
        dailyStreak: 0, lastDailyDay: null, dailyCompleted: {},
    }));
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

const nonTransparent = () => page.evaluate(() => {
    const c = document.getElementById("game-canvas");
    const ctx = c.getContext("2d");
    const data = ctx.getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
});

await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
await page.waitForTimeout(500);

const r = [];

await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 1, null, { timeout: 8000 });
r.push(["PLAY loads Level 1 (maxed save)", (await page.evaluate(() => document.getElementById("level-label").textContent)) === "LEVEL 1"]);
await page.waitForTimeout(400);
r.push(["after PLAY: canvas has content", (await nonTransparent()) > 1000]);
r.push(["after PLAY: state playing", (await page.evaluate(() => window.__CTF__.game.gameState)) === "playing"]);

// dismiss tutorial
await page.evaluate(() => { const ov = document.getElementById("tutorial-overlay"); if (ov.style.display === "flex") document.getElementById("tutorial-next").click(); });

// Map-select L7 (a mid-level) and confirm render.
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none", null, { timeout: 5000 });
await page.evaluate(() => document.getElementById("level-grid").children[6].click());
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 7, null, { timeout: 8000 });
await page.evaluate(() => { const ov = document.getElementById("tutorial-overlay"); if (ov.style.display === "flex") document.getElementById("tutorial-next").click(); });
await page.waitForTimeout(400);
r.push(["map-select L7: canvas has content", (await nonTransparent()) > 1000]);
r.push(["map-select L7: modal closed", (await page.evaluate(() => document.getElementById("modal-levels").style.display)) === "none"]);

// Home → PLAY again resumes the current session level (7), not a fresh level.
await page.click("#btn-menu");
await page.waitForFunction(() => document.getElementById("modal-menu").style.display !== "none", null, { timeout: 5000 });
await page.click("#btn-menu-play");
await page.waitForTimeout(500);
r.push(["hub PLAY resumes current level 7", (await page.evaluate(() => document.getElementById("level-label").textContent)) === "LEVEL 7"]);

console.log("\n=== verify-fix ===");
let ok = true;
for (const [name, pass] of r) { console.log(`${pass ? "✓" : "✗"} ${name}`); if (!pass) ok = false; }
if (errors.length) { ok = false; console.log("errors:\n" + errors.join("\n")); }
console.log(ok ? "\nPASS" : "\nFAIL");
await browser.close();
process.exit(ok ? 0 : 1);
