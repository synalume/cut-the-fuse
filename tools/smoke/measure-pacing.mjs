// tools/smoke/measure-pacing.mjs — sample live-spark concurrency over time
// for a level, to verify act-3 spark arrivals trickle instead of bunching.
// Run: node tools/smoke/measure-pacing.mjs [level_id]
import { chromium } from "playwright";

const LEVEL = Number(process.argv[2] ?? 55);
const BASE = "http://localhost:8080";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
await page.goto(BASE);
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });

// Home screen first — press PLAY to load a level, then open the map.
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });

// Jump straight to the level via the map UI.
await page.click("#level-label");
await page.waitForTimeout(200);
await page.evaluate((idx) => {
    document.getElementById("level-grid").children[idx].click();
}, LEVEL - 1);
await page.waitForTimeout(400);

// Skip any tutorial overlay.
await page.waitForFunction(() => document.getElementById("tutorial-overlay")?.style.display === "none", null, { timeout: 8000 }).catch(() => {});

const samples = [];
for (let t = 0; t < 40000; t += 500) {
    const st = await page.evaluate(() => {
        const g = window.__CTF__.game;
        const near = g.sparks.filter((s) => s.ignited && s.progress >= 0.6 && s.progress < 1).length;
        const burning = g.sparks.filter((s) => s.ignited && s.progress < 1).length;
        return { state: g.state, near, burning, frame: g.frameCount };
    });
    if (st.state === "won") { samples.push({ t, ...st }); break; }
    samples.push({ t, ...st });
    await page.waitForTimeout(500);
}

const aliveOverTime = samples.filter((s) => s.burning > 0);
if (!aliveOverTime.length) {
    console.log(`L${LEVEL}: no sparks observed burning (state ${samples.at(-1)?.state})`);
    await browser.close();
    process.exit(0);
}
const maxConcurrent = Math.max(...aliveOverTime.map((s) => s.burning));
const firstAlive = samples.findIndex((s) => s.burning > 0);
const lastAlive = samples.length - 1 - [...samples].reverse().findIndex((s) => s.burning > 0);
const elapsed = ((samples.at(-1).t - samples[firstAlive].t) / 1000).toFixed(1);
const steady = aliveOverTime.filter((s) => s.t >= 4000 && s.t <= 16000);
const avgBurning = (steady.reduce((a, s) => a + s.burning, 0) / Math.max(1, steady.length)).toFixed(1);
const peakNear = Math.max(...samples.map((s) => s.near));
const avgNear = (samples.reduce((a, s) => a + s.near, 0) / Math.max(1, samples.length)).toFixed(1);

console.log(`L${LEVEL}: peakBurning=${maxConcurrent} avgBurning@4-16s=${avgBurning} | danger-zone (progress>=0.6): peak=${peakNear} avg=${avgNear} | first-burn→end=${elapsed}s`);
if (process.env.DETAIL) {
    for (const s of samples.filter((s) => s.burning > 0)) console.log(`  t=${(s.t / 1000).toFixed(1)}s frame=${s.frame} burning=${s.burning} near=${s.near}`);
}
await browser.close();
