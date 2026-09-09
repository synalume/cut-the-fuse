// tools/smoke/verify-playgama-save.mjs — Playgama save + RESTORE regression.
// Covers two past bugs:
//   1) bridge.storage is undefined until initialize() resolves → the backend
//      must be re-detected at init (not just at construction).
//   2) Real Bridge v2 auto-parses stored JSON on read (get's tryParseJson
//      defaults true): a value saved as a JSON string comes back as an
//      object, and a `typeof === "string"` guard silently treated it as "no
//      data" → progress lost across reload (Playgama review, 2026-09-07).
// The mock mirrors the real bridge faithfully: storage is localStorage-backed
// (survives a page reload on the same origin) and get() JSON-parses values.
// Wins level 1 in session 1, reloads, asserts progress restored in session 2.
import { chromium } from "playwright";

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 480, height: 800 } });
const results = [];
const ok = (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✓" : "✗"} ${name}${cond && extra ? ` — ${extra}` : ""}`);
};

const pgInit = () => {
    window.__CUT_THE_FUSE_PLAYGAMA__ = true;
    window.__mock = { writes: 0, reads: 0 };
    const getStore = () => { try { return JSON.parse(localStorage.getItem("__pg_store__") || "{}"); } catch { return {}; } };
    const putStore = (s) => { try { localStorage.setItem("__pg_store__", JSON.stringify(s)); } catch {} };
    let inited = false;
    let storage;
    window.bridge = {
        initialize: () => new Promise((res) => setTimeout(() => {
            storage = {
                // Real Bridge v2 tryParseJson=true: valid JSON strings come
                // back parsed. Non-JSON strings return as-is.
                get: async (keys) => {
                    window.__mock.reads++;
                    const s = getStore();
                    return keys.map((k) => {
                        const v = s[k];
                        if (v == null) return null;
                        try { return JSON.parse(v); } catch { return v; }
                    });
                },
                set: async (keys, vals) => {
                    window.__mock.writes++;
                    const s = getStore();
                    keys.forEach((k, i) => { s[k] = vals[i]; });
                    putStore(s);
                },
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
};

async function boot(page) {
    await page.addInitScript(pgInit);
    await page.goto("http://localhost:8080");
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120 && window.__mock?.reads >= 1, null, { timeout: 12000 });
}

async function winLevel1(page) {
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
}

// ---- Session 1: win level 1, expect a storage write ----
console.log("[verify] Playgama save + restore across reload");
const page = await ctx.newPage();
page.on("pageerror", (e) => console.log("  [pageerror]", e.message));
await boot(page);
await winLevel1(page);
await page.waitForTimeout(500);
const s1 = await page.evaluate(() => ({
    writes: window.__mock.writes,
    starsL1: window.__CTF__.save.getStars(1),
    unlocked: window.__CTF__.save.getUnlockedLevel(),
}));
ok("bridge.storage.set fired on level clear", s1.writes >= 1, `writes=${s1.writes}`);
ok("session 1 records the win", s1.starsL1 >= 1 && s1.unlocked >= 2, `stars=${s1.starsL1} unlocked=${s1.unlocked}`);
await page.close();

// ---- Session 2: RELOAD — progress must come back ----
const page2 = await ctx.newPage();
page2.on("pageerror", (e) => console.log("  [pageerror]", e.message));
await boot(page2);
await page2.waitForTimeout(500);
const s2 = await page2.evaluate(() => ({
    reads: window.__mock.reads,
    starsL1: window.__CTF__.save.getStars(1),
    unlocked: window.__CTF__.save.getUnlockedLevel(),
    starBank: window.__CTF__.save.getStarBank(),
}));
ok("progress restored after reload", s2.starsL1 >= 1 && s2.unlocked >= 2, `stars=${s2.starsL1} unlocked=${s2.unlocked} bank=${s2.starBank}`);
await page2.close();

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`PLAYGAMA SAVE/RESTORE ${failed.length ? "FAIL" : "PASS"} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
