// tools/smoke/verify-hints-visual.mjs — screenshot hint X's on representative
// levels (mixed crossroads, douse, shaped wicks, twin bombs) for a visual check.
// Requires the dev server on :8080.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const levels = JSON.parse(readFileSync(path.join(ROOT, "src/data/levels.json"), "utf8"));
const pick = [10, 36, 70, 80, 99, 112]; // mixed, mixed, douse, douse+forbidden, twin+douse, twin
const wanted = new Set(pick);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text().slice(0, 300)); });
await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });

const results = [];
for (const cfg of levels) {
    if (!wanted.has(cfg.level_id)) continue;
    // Unlock every level, open the selector, and click the level's cell so the
    // normal load path (fresh build + tutorial) runs.
    await page.evaluate((id) => window.__CTF__.save.setUnlockedLevel(id), cfg.level_id);
    await page.evaluate(() => document.querySelector("#btn-menu-levels")?.click());
    await page.waitForFunction(() => document.querySelectorAll(".level-cell").length === 120, null, { timeout: 8000 });
    await page.evaluate((id) => {
        const cells = document.querySelectorAll(".level-cell");
        for (const c of cells) {
            if (c.querySelector(".num")?.textContent === String(id).padStart(2, "0")) { c.click(); break; }
        }
    }, cfg.level_id);
    await page.waitForFunction((id) => window.__CTF__.game?.level?.level_id === id, cfg.level_id, { timeout: 8000 });
    await page.evaluate(() => { document.querySelector("#btn-tutorial-ok")?.click(); document.querySelector("#tutorial-next")?.click(); });
    await page.evaluate(() => window.__CTF__.game.setHint(true));
    await page.waitForTimeout(400);
    const targets = await page.evaluate(() => window.__CTF__.game.hintTargets.map((t) => ({ fuse: t.fuse.id, x: Math.round(t.point.x), y: Math.round(t.point.y) })));
    const shot = path.join(ROOT, `tools/smoke/verify-hint-l${cfg.level_id}.png`);
    await page.screenshot({ path: shot });
    results.push({ level: cfg.level_id, targets, shot });
    console.log(`L${cfg.level_id}: ${targets.length} hints → ${targets.map((t) => t.fuse).join(",")}`);
}
console.log("errors:", errors.length ? errors : "none");
await browser.close();
