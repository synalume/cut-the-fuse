import { chromium } from "playwright";
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
// Start level 1
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__.game?.level?.level_id === 1, null, { timeout: 8000 });
// Dismiss tutorial if present
await page.evaluate(() => { const b = document.querySelector("#tutorial-next"); if (b) b.click(); });
await page.waitForTimeout(300);
// Cut the wick at its intersection point (exposed via __CTF__.game)
const cutRes = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const f = g.fuses[0];
    const p = f.intersectionPt;
    const ok = g.tryCut({ x: p.x - 26, y: p.y }, { x: p.x + 26, y: p.y }, [{ x: p.x - 26, y: p.y }, { x: p.x + 26, y: p.y }]);
    return { ok, recheck: g._recheckBlaze, state: g.gameState };
});
console.log("cut:", JSON.stringify(cutRes));
// Watch state transitions over ~4 seconds
const states = [];
for (let i = 0; i < 40; i++) {
    await page.waitForTimeout(100);
    const s = await page.evaluate(() => {
        const g = window.__CTF__.game;
        return { state: g.gameState, blaze: g.blaze.active, prog: g.sparks[0]?.progress?.toFixed(3), active: g.sparks[0]?.active, wonAt: g.wonAt, frame: g.frameCount };
    });
    states.push(s);
    if (s.state === "won" || s.state === "lost") break;
}
console.log("states:");
for (const s of states.slice(0, 15)) console.log("  " + JSON.stringify(s));
console.log("errors:", errors.length ? errors : "none");
await browser.close();
