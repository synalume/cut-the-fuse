// verify-menu-spark.mjs — home-screen ambient spark behind the menu card:
// 1) canvas draws a moving spark while the hub is up (no level loaded),
// 2) the spark position changes between frames (it's animating),
// 3) screenshot a few frames apart for the visual check.
import { chromium } from "playwright";

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 200)); });

await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });

// Hub is up, no level loaded yet.
await page.waitForFunction(() => document.getElementById("modal-menu").style.display !== "none", null, { timeout: 5000 });

const r = [];
r.push(["hub open at boot", await page.evaluate(() => document.getElementById("modal-menu").style.display !== "none")]);
r.push(["no level loaded at hub", (await page.evaluate(() => window.__CTF__.game.level)) === null]);

// Sample where the canvas draws its brightest "spark" pixels over a few frames.
const hotSpot = () => page.evaluate(() => {
    const c = document.getElementById("game-canvas");
    const ctx = c.getContext("2d");
    const w = c.width, h = c.height;
    const data = ctx.getImageData(0, 0, w, h).data;
    // Weighted centroid of pixels that are strongly orange/yellow (spark + trail).
    let sx = 0, sy = 0, sw = 0, n = 0;
    for (let y = 0; y < h; y += 4) {
        for (let x = 0; x < w; x += 4) {
            const i = (y * w + x) * 4;
            const [red, grn, blu, al] = [data[i], data[i + 1], data[i + 2], data[i + 3]];
            if (al < 60) continue;
            const hot = red > 200 && grn > 110 && blu < 120;
            if (hot) { sx += x * red; sy += y * red; sw += red; n++; }
        }
    }
    return { n, x: sw ? sx / sw : -1, y: sw ? sy / sw : -1 };
});

const nonTransparent = () => page.evaluate(() => {
    const c = document.getElementById("game-canvas");
    const data = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
    let n = 0;
    for (let i = 3; i < data.length; i += 4) if (data[i] > 0) n++;
    return n;
});

await page.waitForTimeout(300);
const a = await hotSpot();
r.push(["hub: canvas draws the spark (hot pixels)", a.n > 40]);
await page.screenshot({ path: "tools/smoke/menu-spark-1.png" });
await page.waitForTimeout(1200);
const b = await hotSpot();
await page.screenshot({ path: "tools/smoke/menu-spark-2.png" });
await page.waitForTimeout(1200);
const c = await hotSpot();
await page.screenshot({ path: "tools/smoke/menu-spark-3.png" });

const moved = Math.hypot(a.x - b.x, a.y - b.y) > 20 || Math.hypot(b.x - c.x, b.y - c.y) > 20;
r.push(["spark moves between frames", moved]);
r.push(["canvas total ink present", (await nonTransparent()) > 1000]);

// PLAY still loads a level (spark stops once a level exists).
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 1, null, { timeout: 8000 });
await page.waitForTimeout(400);
r.push(["PLAY loads L1 (spark path exits)", (await page.evaluate(() => document.getElementById("level-label").textContent)) === "LEVEL 1"]);
r.push(["level load still renders puzzle", (await nonTransparent()) > 1000]);

console.log("\n=== verify-menu-spark ===");
let ok = true;
for (const [name, pass] of r) { console.log(`${pass ? "✓" : "✗"} ${name}`); if (!pass) ok = false; }
if (errors.length) { ok = false; console.log("errors:\n" + errors.join("\n")); }
console.log(ok ? "\nPASS" : "\nFAIL");
await browser.close();
process.exit(ok ? 0 : 1);
