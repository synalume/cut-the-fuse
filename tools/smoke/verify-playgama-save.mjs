// tools/smoke/verify-playgama-save.mjs — regression check for the Playgama
// save-event bug: bridge.storage is undefined until initialize() resolves, so
// the backend must be re-detected at init (not just at construction). Wins
// level 1 and asserts bridge.storage.set fired. Run against the dev server.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.addInitScript(() => {
    window.__CUT_THE_FUSE_PLAYGAMA__ = true;
    window.__mock = { writes: 0, reads: 0 };
    const store = {};
    let inited = false;
    let storage;
    window.bridge = {
        initialize: () => new Promise((res) => setTimeout(() => {
            storage = {
                get: async (keys) => { window.__mock.reads++; return keys.map((k) => store[k] ?? null); },
                set: async (keys, vals) => { window.__mock.writes++; keys.forEach((k, i) => { store[k] = vals[i]; }); },
            };
            inited = true;
            res();
        }, 50)),
        get storage() { return inited ? storage : undefined; },
        EVENT_NAME: { PAUSE_STATE_CHANGED: "pause_state_changed", AUDIO_STATE_CHANGED: "audio_state_changed" },
        platform: {
            language: "en", isAudioEnabled: true,
            sendMessage: () => Promise.resolve(),
            on: () => () => {},
        },
        advertisement: { showInterstitial: () => Promise.resolve(), showRewarded: () => new Promise((r) => setTimeout(r, 5)), on: () => () => {} },
    };
});
await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 10000 });
await page.waitForTimeout(200);
await page.evaluate(() => document.getElementById("btn-menu-play").click());
await page.waitForTimeout(300);
await page.evaluate(() => {
    const ov = document.getElementById("tutorial-overlay");
    if (ov && ov.style.display === "flex") { ov.style.display = "none"; window.__CTF__.game.tutorialActive = false; }
});
await page.waitForFunction(() => window.__CTF__.game.sparks.some((s) => s.active && s.ignited && s.progress < 0.9), null, { timeout: 8000 });
await page.evaluate(() => {
    const g = window.__CTF__.game;
    const idx = g.sparks.findIndex((s) => s.active && s.ignited && s.progress < 0.9);
    const s = g.sparks[idx];
    const f = g.fuses[idx];
    const bez = (t) => { const u = 1 - t; return { x: u * u * u * f.startNode.x + 3 * u * u * t * f.cp1.x + 3 * u * t * t * f.cp2.x + t * t * t * f.endNode.x, y: u * u * u * f.startNode.y + 3 * u * u * t * f.cp1.y + 3 * u * t * t * f.cp2.y + t * t * t * f.endNode.y }; };
    const t = Math.min(0.97, s.progress + 0.05);
    const p = bez(t), q = bez(Math.min(1, t + 0.01));
    const dx = q.x - p.x, dy = q.y - p.y, L = Math.hypot(dx, dy) || 1;
    const nx = (-dy / L) * 10, ny = (dx / L) * 10;
    g.tryCut({ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }, [{ x: p.x + nx, y: p.y + ny }, { x: p.x - nx, y: p.y - ny }]);
});
await page.waitForFunction(() => window.__CTF__.game.gameState === "won", null, { timeout: 15000 });
await page.waitForTimeout(500);
const state = await page.evaluate(() => ({ writes: window.__mock.writes, reads: window.__mock.reads, state: window.__CTF__.game.gameState }));
console.log("after level 1 win:", JSON.stringify(state));
const pass = state.writes >= 1 && !errors.length;
console.log(pass ? "PASS — bridge.storage.set fired on level clear" : `FAIL — ${errors.join("; ")}`);
await browser.close();
process.exit(pass ? 0 : 1);
