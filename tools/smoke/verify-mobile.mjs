// tools/smoke/verify-mobile.mjs — quick mobile check of the win pills + L8 chain layout.
import { chromium } from "playwright";

const browser = await chromium.launch();
const report = [];

/** Dismiss the home hub, then any tutorial overlay, until sparks are moving. */
async function dismissUntilRunning(page, timeoutMs = 15000) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            const g = window.__CTF__.game;
            const menu = document.getElementById("modal-menu");
            if (menu && menu.style.display === "flex") {
                document.getElementById("btn-menu-play").click();
                return "starting";
            }
            const ov = document.getElementById("tutorial-overlay");
            if (ov.style.display === "flex") {
                ov.style.display = "none";
                g.tutorialActive = false;
                return "dismissed";
            }
            if (g.level && g.sparks.some((s) => s.active && s.ignited && s.progress < 0.5)) return "running";
            return "waiting";
        });
        if (st === "running") return true;
        await page.waitForTimeout(120);
    }
    return false;
}

for (const vp of [
    { name: "portrait", width: 390, height: 844 },
    { name: "landscape", width: 844, height: 390 },
]) {
    const page = await browser.newPage({ viewport: { width: vp.width, height: vp.height } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.goto("http://localhost:8080");
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });

    if (!(await dismissUntilRunning(page))) throw new Error(`${vp.name}: spark never ignited`);
    // Cut the live fuse just ahead of the spark to win.
    await page.evaluate(() => {
        const g = window.__CTF__.game;
        const idx = g.sparks.findIndex((s) => s.active && s.ignited && s.progress < 0.9);
        const s = g.sparks[idx];
        const f = g.fuses[idx];
        const bez = (t) => {
            const u = 1 - t;
            return {
                x: u * u * u * f.startNode.x + 3 * u * u * t * f.cp1.x + 3 * u * t * t * f.cp2.x + t * t * t * f.endNode.x,
                y: u * u * u * f.startNode.y + 3 * u * u * t * f.cp1.y + 3 * u * t * t * f.cp2.y + t * t * t * f.endNode.y,
            };
        };
        const t = Math.min(0.97, s.progress + 0.04);
        const p = bez(t);
        const q = bez(Math.min(1, t + 0.01));
        const dx = q.x - p.x, dy = q.y - p.y;
        const L = Math.hypot(dx, dy) || 1;
        const nx = (-dy / L) * 10, ny = (dx / L) * 10;
        g.tryCut(
            { x: p.x + nx, y: p.y + ny },
            { x: p.x - nx, y: p.y - ny },
            [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }]
        );
    });
    await page.waitForFunction(() => window.__CTF__.game.gameState === "won", null, { timeout: 15000 });
    await page.waitForTimeout(350); // let stars/record pills reveal
    await page.screenshot({ path: `./tools/smoke/verify-win-${vp.name}-pills.png` });

    const pills = await page.evaluate(() => {
        return [...document.querySelectorAll("#win-stats .stat")].filter((el) => el.style.display !== "none").map((el) => {
            const r = el.getBoundingClientRect();
            const range = document.createRange();
            range.selectNodeContents(el);
            const tr = range.getBoundingClientRect();
            const pillCenter = r.top + r.height / 2;
            const textCenter = tr.top + tr.height / 2;
            return {
                text: el.textContent.trim(),
                onScreen: r.left >= 0 && r.right <= window.innerWidth && r.width > 0,
                centerOffset: Math.round((textCenter - pillCenter) * 10) / 10,
            };
        });
    });
    report.push({ vp: vp.name, pills });
    await page.close();
}

// L8 fork fit on portrait
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
await dismissUntilRunning(page, 8000);
await page.click("#level-label");
await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
await page.evaluate(() => document.getElementById("level-grid").children[7].click());
await page.waitForFunction(() => document.getElementById("tutorial-overlay").style.display === "flex", null, { timeout: 5000 });
await page.click("#tutorial-next");
await page.waitForTimeout(300);
await page.screenshot({ path: "./tools/smoke/verify-l8-fork-portrait.png" });
await page.close();

console.log(JSON.stringify(report, null, 2));
await browser.close();
