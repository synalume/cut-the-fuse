// tools/smoke/shot-pacing.mjs — screenshot a level at a given second mid-burn.
// Run: node tools/smoke/shot-pacing.mjs <level_id> <second> <out.png>
import { chromium } from "playwright";

const LEVEL = Number(process.argv[2] ?? 55);
const AT_SEC = Number(process.argv[3] ?? 8);
const OUT = process.argv[4] ?? "verify-pacing.png";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
// Home screen first — press PLAY to load a level, then open the map.
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
await page.click("#level-label");
await page.waitForTimeout(200);
await page.evaluate((idx) => {
    document.getElementById("level-grid").children[idx].click();
}, LEVEL - 1);
await page.waitForTimeout(400);
// Dismiss tutorial if present.
await page.evaluate(() => {
    const ov = document.getElementById("tutorial-overlay");
    if (ov && ov.style.display !== "none") document.getElementById("tutorial-next").click();
}).catch(() => {});
await page.waitForTimeout(AT_SEC * 1000);
await page.screenshot({ path: OUT });
const st = await page.evaluate(() => {
    const g = window.__CTF__.game;
    return {
        state: g.state,
        burning: g.sparks.filter((s) => s.ignited && s.progress < 1).length,
        near: g.sparks.filter((s) => s.ignited && s.progress >= 0.6 && s.progress < 1).length,
        frame: g.frameCount,
    };
});
console.log(`L${LEVEL} @${AT_SEC}s: ${JSON.stringify(st)} -> ${OUT}`);
await browser.close();
