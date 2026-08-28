// tools/smoke/shot-hub.mjs — screenshots of the new main-menu hub, the
// enlarged level-select tiles, and the armory/level-select exclusivity.
import { chromium } from "playwright";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "http://localhost:8080";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));

await page.goto(BASE);
await page.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });
await page.waitForTimeout(300);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/shot-hub-menu.png") });
console.log("→ shot-hub-menu.png");

await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
await page.evaluate(() => {
    const ov = document.getElementById("tutorial-overlay");
    if (ov.style.display === "flex") document.getElementById("tutorial-next").click();
});
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none", null, { timeout: 5000 });
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/shot-hub-levels.png") });
console.log("→ shot-hub-levels.png");

// Exclusivity: opening the armory while the map is open replaces it.
await page.evaluate(() => {
    // The star display sits behind the map card, so drive it directly.
    window.__CTF__.game.gameState = "playing";
    document.getElementById("star-display").click();
});
await page.waitForTimeout(250);
await page.screenshot({ path: path.join(ROOT, "tools/smoke/shot-hub-armory-over-map.png") });
const states = await page.evaluate(() => ({
    levels: document.getElementById("modal-levels").style.display,
    skins: document.getElementById("modal-skins").style.display,
}));
console.log("exclusivity:", JSON.stringify(states));
console.log(states.levels === "none" && states.skins === "block" ? "OVERLAP FIX OK" : "OVERLAP STILL PRESENT");

// Mobile portrait — hub + level tiles.
const mob = await browser.newPage({ viewport: { width: 390, height: 844 } });
await mob.goto(BASE);
await mob.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });
await mob.waitForTimeout(300);
await mob.screenshot({ path: path.join(ROOT, "tools/smoke/shot-hub-mobile.png") });
console.log("→ shot-hub-mobile.png");
await mob.click("#btn-menu-play");
await mob.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
await mob.evaluate(() => {
    const ov = document.getElementById("tutorial-overlay");
    if (ov.style.display === "flex") document.getElementById("tutorial-next").click();
});
await mob.click("#level-label");
await mob.waitForTimeout(250);
await mob.screenshot({ path: path.join(ROOT, "tools/smoke/shot-hub-mobile-levels.png") });
console.log("→ shot-hub-mobile-levels.png");

await browser.close();
