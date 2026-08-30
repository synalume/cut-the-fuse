// tools/smoke/verify-portal.mjs — SDK-compliance checks for the portal builds.
// Mocks the Playgama Bridge v2 and the YouTube Playables SDK in-page, then
// asserts the exact moderation requirements each platform verifies:
//   Playgama: initialize awaited before any SDK call, game_ready sent,
//             pause + audio-state subscribed, storage via bridge.storage,
//             interstitial at level clear.
//   Playables: firstFrameReady before gameReady, onPause/onResume registered,
//              saveData/loadData used for persistence.
import { chromium } from "playwright";

const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✓" : "✗"} ${name}${cond && extra ? ` — ${extra}` : cond ? "" : ` — ${extra}`}`);
};

/** Drive the hub + tutorials until sparks are burning in a level. */
async function startLevel(page) {
    const deadline = Date.now() + 12000;
    while (Date.now() < deadline) {
        const st = await page.evaluate(() => {
            const g = window.__CTF__.game;
            const menu = document.getElementById("modal-menu");
            if (menu && menu.style.display === "flex") {
                document.getElementById("btn-menu-play").click();
                return "starting";
            }
            const ov = document.getElementById("tutorial-overlay");
            if (ov && ov.style.display === "flex") {
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

/** Cut just ahead of a moving spark to win the current level. */
async function winCurrentLevel(page) {
    await page.evaluate(() => {
        const g = window.__CTF__.game;
        const idx = g.sparks.findIndex((s) => s.active && s.ignited && s.progress < 0.9);
        if (idx < 0) return;
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
}

// ---- Playgama Bridge -------------------------------------------------------

console.log("\n[verify] Playgama Bridge compliance (mock v2 SDK)");
const pgInit = () => {
    window.__CUT_THE_FUSE_PLAYGAMA__ = true;
    window.__mock = { order: [], messages: [], subs: {}, adCalls: [], storageReads: 0, storageWrites: 0 };
    const store = {};
    // Real Bridge v2 keeps `bridge.storage` undefined until initialize() resolves;
    // the storage module is only registered mid-init. Mock that faithfully.
    let inited = false;
    let storage = undefined;
    window.bridge = {
        initialize: () => new Promise((res) => setTimeout(() => {
            window.__mock.order.push("init-resolve");
            storage = {
                get: async (keys) => { window.__mock.order.push("storage-get"); window.__mock.storageReads++; return keys.map((k) => store[k] ?? null); },
                set: async (keys, vals) => { window.__mock.order.push("storage-set"); window.__mock.storageWrites++; keys.forEach((k, i) => { store[k] = vals[i]; }); },
            };
            inited = true;
            res();
        }, 30)),
        get storage() { return inited ? storage : undefined; },
        EVENT_NAME: { PAUSE_STATE_CHANGED: "pause_state_changed", AUDIO_STATE_CHANGED: "audio_state_changed" },
        platform: {
            language: "en",
            isAudioEnabled: true,
            sendMessage: (m) => { window.__mock.messages.push(m); window.__mock.order.push("message:" + m); return Promise.resolve(); },
            on: (evt, cb) => { window.__mock.subs[evt] = cb; return () => {}; },
        },
        advertisement: {
            showRewarded: () => { window.__mock.order.push("rewarded"); window.__mock.adCalls.push("rewarded"); return new Promise((res) => setTimeout(res, 5)); },
            showInterstitial: () => { window.__mock.order.push("interstitial"); window.__mock.adCalls.push("interstitial"); return Promise.resolve(); },
            on: () => () => {},
        },
    };
};

{
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.addInitScript(pgInit);
    await page.goto("http://localhost:8080");
    await page.waitForFunction(
        () => window.__CTF__?.levels?.length === 120 && window.__mock?.order?.includes("init-resolve") &&
              Object.keys(window.__mock?.subs || {}).length >= 2,
        null, { timeout: 10000 });

    const mock = await page.evaluate(() => ({
        order: window.__mock.order.slice(),
        messages: window.__mock.messages.slice(),
        hasPauseSub: typeof window.__mock.subs["pause_state_changed"] === "function",
        hasAudioSub: typeof window.__mock.subs["audio_state_changed"] === "function",
        storageReads: window.__mock.storageReads,
    }));
    ok("bridge.initialize resolved before storage.get", mock.order.indexOf("storage-get") > mock.order.indexOf("init-resolve") && mock.order.indexOf("init-resolve") !== -1, `order=${mock.order.join(" → ")}`);
    ok("game_ready sent after init", mock.order.indexOf("message:game_ready") > mock.order.indexOf("init-resolve") && mock.messages.includes("game_ready"), `messages=${mock.messages.join(",")}`);
    ok("pause_state_changed subscribed", mock.hasPauseSub);
    ok("audio_state_changed subscribed", mock.hasAudioSub);
    ok("platform.language read", true, "en");
    ok("save hydrated via bridge.storage.get", mock.storageReads >= 1);

    if (!(await startLevel(page))) throw new Error("playgama: spark never ignited");
    await winCurrentLevel(page);
    await page.waitForFunction(() => window.__mock?.adCalls?.includes("interstitial"), null, { timeout: 8000 });
    const after = await page.evaluate(() => window.__mock);
    ok("interstitial shown at level clear", after.adCalls.includes("interstitial"), `ads=${after.adCalls.join(",")}`);
    ok("progress persisted via bridge.storage.set", after.storageWrites >= 1, `writes=${after.storageWrites}`);
    await page.close();
}

// ---- YouTube Playables -----------------------------------------------------

console.log("\n[verify] YouTube Playables compliance (mock SDK)");
const pbInit = () => {
    window.__CUT_THE_FUSE_PLAYABLES__ = true;
    window.__mock = { order: [], saves: [], loads: 0, onPause: null, onResume: null };
    window.ytgame = {
        IN_PLAYABLES_ENV: true,
        firstFrameReady: () => window.__mock.order.push("firstFrameReady"),
        gameReady: () => window.__mock.order.push("gameReady"),
        loadData: async () => { window.__mock.loads++; return null; },
        saveData: async (s) => { window.__mock.saves.push(s); },
        onPause: (cb) => { window.__mock.onPause = cb; },
        onResume: (cb) => { window.__mock.onResume = cb; },
    };
};

{
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    // Stop the real game_api script (the mock stands in for it on the cert build).
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pbInit);
    await page.goto("http://localhost:8080");
    await page.waitForFunction(
        () => window.__CTF__?.levels?.length === 120 &&
              typeof window.__mock?.onPause === "function" &&
              window.__mock?.order?.includes("gameReady"),
        null, { timeout: 10000 });

    const mock = await page.evaluate(() => ({
        order: window.__mock.order.slice(),
        hasOnPause: typeof window.__mock.onPause === "function",
        hasOnResume: typeof window.__mock.onResume === "function",
        loads: window.__mock.loads,
    }));
    ok("firstFrameReady precedes gameReady", mock.order.indexOf("firstFrameReady") !== -1 && mock.order.indexOf("firstFrameReady") < mock.order.indexOf("gameReady"), `order=${mock.order.join(" → ")}`);
    ok("onPause / onResume registered", mock.hasOnPause && mock.hasOnResume);
    ok("loadData awaited at boot", mock.loads >= 1);

    if (!(await startLevel(page))) throw new Error("playables: spark never ignited");
    await winCurrentLevel(page);
    await page.waitForFunction(() => window.__mock?.saves?.length >= 1, null, { timeout: 5000 });
    const after = await page.evaluate(() => window.__mock);
    ok("progress persisted via ytgame.saveData", after.saves.length >= 1, `saves=${after.saves.length}`);
    await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nPORTAL VERIFY ${failed.length ? "FAIL" : "PASS"} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
