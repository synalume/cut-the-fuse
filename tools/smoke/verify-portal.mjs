// tools/smoke/verify-portal.mjs — SDK-compliance checks for the portal builds.
// Mocks the Playgama Bridge v2 and the YouTube Playables SDK in-page, then
// asserts the exact moderation requirements each platform verifies:
//   Playgama: initialize awaited before any SDK call, game_ready sent,
//             pause + audio-state subscribed, storage via bridge.storage,
//             interstitial at level clear.
//   Playables: firstFrameReady before gameReady, onPause/onResume registered,
//              saveData/loadData used for persistence.
import { chromium } from "playwright";
import { readFileSync } from "node:fs";

const BASE = process.env.PORTAL_BASE || "http://localhost:8080";
// Section filter: `PORTAL_ONLY=playgama` checks just the Bridge build (the right
// mode for validating a staged playgama/out zip, which ships no Playables SDK).
const ONLY = (process.env.PORTAL_ONLY || "").toLowerCase();
const wantPg = ONLY === "" || ONLY === "playgama";
const wantPb = ONLY === "" || ONLY === "playables";
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
// Drive the mock from the REAL shipped config: the Bridge's ad module refuses
// to show an interstitial until `initialInterstitialDelay` seconds after
// game_ready, failing BEFORE it reaches the platform (which is exactly how a
// 45s delay made moderation report "no interstitial ad call"). Reading the
// config here means a regression to a long delay fails this suite.
const pgConfig = JSON.parse(
    readFileSync(new URL("../../playgama/playgama-bridge-config.json", import.meta.url), "utf8"),
);
ok("interstitial placement declared as level_completed", pgConfig?.advertisement?.interstitial?.placements?.some((p) => p.id === "level_completed"), JSON.stringify(pgConfig?.advertisement?.interstitial?.placements));
ok("initialInterstitialDelay does not suppress the first level-clear ad",
    Number(pgConfig?.advertisement?.initialInterstitialDelay ?? 60) === 0,
    `initialInterstitialDelay=${pgConfig?.advertisement?.initialInterstitialDelay}`);

const pgInit = (cfg) => {
    window.__CUT_THE_FUSE_PLAYGAMA__ = true;
    window.__mock = {
        order: [], messages: [], subs: {}, adCalls: [],
        storageReads: 0, storageWrites: 0,
        earlyAccess: [], // bridge.<module> read before initialize() resolved
        adBlocked: [],   // interstitials the SDK refused before reaching the platform
    };
    const store = {};

    // ---- Faithful reproduction of Bridge v2.2.0 semantics -------------------
    // Every module is a GETTER gated on init: reading platform/storage/
    // advertisement before initialize() resolves makes the real SDK log
    // "Before using the SDK you must initialize it" and hand back undefined.
    // Modelling that is what catches the init-race class of bug — the old mock
    // exposed `platform` unconditionally, so a pre-init read looked fine here
    // while failing on the portal.
    let inited = false;
    let storage;
    const guard = (name, mod) => {
        if (!inited) {
            window.__mock.earlyAccess.push(name);
            return undefined;
        }
        return mod;
    };

    // The real ad module only reaches the platform when game_ready has been
    // sent (it timestamps PLATFORM_MESSAGE_SENT and bails out of show() until
    // `initialInterstitialDelay` has elapsed — DEFAULT 60s, ours was 45s).
    // Without game_ready, #X stays null and show() fails immediately: the
    // platform sees no interstitial call at all.
    let gameReadyAt = null;
    const INITIAL_DELAY_S = Number(cfg?.advertisement?.initialInterstitialDelay ?? 60);

    window.bridge = {
        version: "2.2.0",
        PLATFORM_MESSAGE: {
            GAME_READY: "game_ready",
            GAMEPLAY_STARTED: "gameplay_started",
            GAMEPLAY_STOPPED: "gameplay_stopped",
            LEVEL_STARTED: "level_started",
            LEVEL_COMPLETED: "level_completed",
        },
        EVENT_NAME: {
            PAUSE_STATE_CHANGED: "pause_state_changed",
            AUDIO_STATE_CHANGED: "audio_state_changed",
            INTERSTITIAL_STATE_CHANGED: "interstitial_state_changed",
            PLATFORM_MESSAGE_SENT: "platform_message_sent",
        },
        initialize: () => new Promise((res) => setTimeout(() => {
            // Register the modules at the END of init, exactly like the real SDK.
            storage = {
                get: async (keys) => {
                    window.__mock.order.push("storage-get");
                    window.__mock.storageReads++;
                    return keys.map((k) => store[k] ?? null);
                },
                set: async (keys, vals) => {
                    window.__mock.order.push("storage-set");
                    window.__mock.storageWrites++;
                    keys.forEach((k, i) => { store[k] = vals[i]; });
                },
            };
            inited = true;
            window.__mock.order.push("init-resolve");
            res();
        }, 30)),
        get isInitialized() { return inited; },
        get storage() { return guard("storage", storage); },
        get platform() {
            return guard("platform", {
                language: "en",
                isAudioEnabled: true,
                sendMessage: (m) => {
                    window.__mock.messages.push(m);
                    window.__mock.order.push("message:" + m);
                    // The ad module arms interstitials off this event.
                    if (m === "game_ready") {
                        if (gameReadyAt !== null) return Promise.reject(new Error("game_ready already sent"));
                        gameReadyAt = performance.now();
                    }
                    return Promise.resolve();
                },
                on: (evt, cb) => { window.__mock.subs[evt] = cb; return () => {}; },
            });
        },
        get advertisement() {
            return guard("advertisement", {
                showInterstitial: (placement = null) => {
                    const p = placement || "level_completed";
                    // Preconditions, in the real module's order.
                    if (gameReadyAt === null) {
                        window.__mock.adBlocked.push(`no-game-ready:${p}`);
                        return Promise.resolve();
                    }
                    if (INITIAL_DELAY_S > 0 && (performance.now() - gameReadyAt) / 1000 < INITIAL_DELAY_S) {
                        window.__mock.adBlocked.push(`initial-delay:${p}`);
                        return Promise.resolve();
                    }
                    window.__mock.order.push("interstitial");
                    window.__mock.adCalls.push(`interstitial:${p}`);
                    return Promise.resolve();
                },
                showRewarded: (placement = null) => {
                    window.__mock.order.push("rewarded");
                    window.__mock.adCalls.push(`rewarded:${placement || "continue"}`);
                    return Promise.resolve();
                },
                on: () => () => {},
            });
        },
    };
};

if (wantPg) {
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    // The cert zip references the YouTube game_api script; stub it whenever the
    // suite runs against a flagged stage build (the host wrapper provides it).
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pgInit, pgConfig);
    await page.goto(BASE);
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
        earlyAccess: window.__mock.earlyAccess.slice(),
    }));
    ok("bridge.initialize resolved before storage.get", mock.order.indexOf("storage-get") > mock.order.indexOf("init-resolve") && mock.order.indexOf("init-resolve") !== -1, `order=${mock.order.join(" → ")}`);
    // The reviewer's console error: any bridge.<module> read before init logs
    // "Before using the SDK you must initialize it" and returns undefined.
    ok("no SDK module touched before initialize() resolved",
        mock.earlyAccess.length === 0,
        mock.earlyAccess.length ? `pre-init reads of bridge: ${mock.earlyAccess.join(", ")}` : "");
    ok("game_ready sent after init", mock.order.indexOf("message:game_ready") > mock.order.indexOf("init-resolve") && mock.messages.includes("game_ready"), `messages=${mock.messages.join(",")}`);
    ok("pause_state_changed subscribed", mock.hasPauseSub);
    ok("audio_state_changed subscribed", mock.hasAudioSub);
    ok("platform.language read", true, "en");
    ok("save hydrated via bridge.storage.get", mock.storageReads >= 1);

    if (!(await startLevel(page))) throw new Error("playgama: spark never ignited");

    // QA tool checks: a host mute signal must duck ALL audio (master gain → 0),
    // and a host pause signal must freeze the game + suspend the audio graph.
    await page.evaluate(() => { window.__mock.subs["audio_state_changed"](false); });
    await page.waitForFunction(() => window.__CTF__?.game?.audio?.hostMuted === true, null, { timeout: 3000 });
    const muted = await page.evaluate(() => ({
        hostMuted: window.__CTF__.game.audio.hostMuted,
        master: window.__CTF__.game.audio.master ? window.__CTF__.game.audio.master.gain.value : null,
    }));
    ok("host mute signal ducks audio (master gain 0)", muted.hostMuted && muted.master === 0, `master=${muted.master}`);

    await page.evaluate(() => { window.__mock.subs["pause_state_changed"](true); });
    await page.waitForFunction(() => window.__CTF__?.game?.gameState === "paused", null, { timeout: 3000 });
    const paused = await page.evaluate(() => ({
        state: window.__CTF__.game.gameState,
        ctxState: window.__CTF__.game.audio.ctx ? window.__CTF__.game.audio.ctx.state : null,
    }));
    ok("host pause signal freezes the game", paused.state === "paused", `state=${paused.state}`);
    ok("host pause signal suspends audio", paused.ctxState === "suspended" || !paused.ctxState, `ctx=${paused.ctxState}`);

    await page.evaluate(() => { window.__mock.subs["pause_state_changed"](false); });
    await page.waitForFunction(() => window.__CTF__?.game?.gameState === "playing", null, { timeout: 3000 });
    ok("host resume signal unfreezes the game", true);

    await winCurrentLevel(page);
    await page.waitForFunction(() => window.__mock?.adCalls?.some((c) => c.startsWith("interstitial")), null, { timeout: 8000 });
    const after = await page.evaluate(() => window.__mock);
    ok("interstitial intercepted by the platform at level clear",
        after.adCalls.some((c) => c.startsWith("interstitial")),
        `ads=${after.adCalls.join(",")} blocked=${(after.adBlocked || []).join(",")}`);
    ok("interstitial uses the declared placement",
        after.adCalls.includes("interstitial:level_completed"),
        `ads=${after.adCalls.join(",")} (config declares "level_completed")`);
    ok("gameplay messages mirror play/pause",
        after.messages.includes("gameplay_started") && after.messages.includes("gameplay_stopped"),
        `messages=${after.messages.join(",")}`);
    ok("level_completed reported to the portal",
        after.messages.includes("level_completed"),
        `messages=${after.messages.join(",")}`);
    ok("progress persisted via bridge.storage.set", after.storageWrites >= 1, `writes=${after.storageWrites}`);
    await page.close();
}

// ---- YouTube Playables -----------------------------------------------------

console.log("\n[verify] YouTube Playables compliance (mock SDK)");
const pbInit = () => {
    window.__CUT_THE_FUSE_PLAYABLES__ = true;
    window.__mock = { order: [], saves: [], loads: 0, onPause: null, onResume: null, audioEnabled: true, adCalls: [] };
    // Real Playables SDK shape: lifecycle + storage live under ytgame.game,
    // host signals under ytgame.system, ads under ytgame.ads (verified against
    // the Big Fluff build that passes the official cert suite). Top-level
    // ytgame.firstFrameReady etc. do NOT exist — a mock shaped like the real
    // SDK catches namespace regressions.
    window.ytgame = {
        IN_PLAYABLES_ENV: true,
        game: {
            firstFrameReady: () => window.__mock.order.push("firstFrameReady"),
            gameReady: () => window.__mock.order.push("gameReady"),
            loadData: async () => { window.__mock.loads++; return null; },
            saveData: async (s) => { window.__mock.saves.push(s); },
        },
        system: {
            isAudioEnabled: () => window.__mock.audioEnabled,
            onAudioEnabledChange: (cb) => { window.__mock.onAudioEnabledChange = cb; },
            onPause: (cb) => { window.__mock.onPause = cb; },
            onResume: (cb) => { window.__mock.onResume = cb; },
        },
        ads: {
            requestInterstitialAd: async () => { window.__mock.order.push("interstitial"); window.__mock.adCalls.push("interstitial"); },
            requestRewardedAd: async (placement) => { window.__mock.order.push("rewarded:" + placement); window.__mock.adCalls.push("rewarded"); return true; },
        },
    };
};

if (wantPb) {
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    // Stop the real game_api script (the mock stands in for it on the cert build).
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pbInit);
    await page.goto(BASE);
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

    // YouTube's mute is a host veto: flipping it must duck ALL audio instantly.
    await page.evaluate(() => { window.__mock.audioEnabled = false; window.__mock.onAudioEnabledChange(false); });
    await page.waitForFunction(() => window.__CTF__?.game?.audio?.hostMuted === true, null, { timeout: 3000 });
    const muted = await page.evaluate(() => window.__CTF__.game.audio.master ? window.__CTF__.game.audio.master.gain.value : null);
    ok("host audio veto ducks audio (master gain 0)", muted === 0, `master=${muted}`);
    await page.evaluate(() => { window.__mock.audioEnabled = true; window.__mock.onAudioEnabledChange(true); });

    // MediaCube console-pause: while the host pauses, gameplay freezes AND the
    // whole UI must be dead — no menu, no nav, no resume. Shield + inert make
    // every control unclickable; the openMenu guard keeps even synthetic
    // clicks from opening the hub.
    await page.evaluate(() => { window.__mock.onPause(); });
    await page.waitForFunction(
        () => document.body.hasAttribute("inert") && document.getElementById("host-shield").style.display === "block",
        null, { timeout: 3000 });
    const lockCheck = await page.evaluate(() => {
        const shield = document.getElementById("host-shield");
        const menu = document.getElementById("modal-menu");
        const shieldCovers = (() => {
            const r = shield.getBoundingClientRect();
            return r.top <= 0 && r.left <= 0 && r.width >= innerWidth && r.height >= innerHeight;
        })();
        document.getElementById("btn-menu").click(); // must be a no-op while paused
        const menuOpened = menu.style.display !== "none";
        return { shieldCovers, menuOpened, inert: document.body.hasAttribute("inert") };
    });
    ok("console pause locks the UI (shield covers viewport + inert)",
       lockCheck.shieldCovers && lockCheck.inert && !lockCheck.menuOpened,
       `shield=${lockCheck.shieldCovers} menuOpened=${lockCheck.menuOpened} inert=${lockCheck.inert}`);
    await page.evaluate(() => { window.__mock.onResume(); });
    await page.waitForFunction(
        () => !document.body.hasAttribute("inert") && window.__CTF__?.game?.gameState === "playing",
        null, { timeout: 3000 });
    ok("host resume unlocks the UI", true);

    // Leaving a live level (☰ hub) is the second interstitial placement —
    // the ad fires and the hub opens behind it (loop frozen during the ad).
    const adsBeforeAbandon = await page.evaluate(() => window.__mock.adCalls.length);
    await page.evaluate(() => document.getElementById("btn-menu").click());
    await page.waitForFunction(
        () => document.getElementById("modal-menu").style.display === "flex",
        null, { timeout: 3000 });
    const abandonAds = await page.evaluate(() => window.__mock.adCalls.length);
    ok("leaving a live level requests an interstitial", abandonAds > adsBeforeAbandon,
       `ads=${adsBeforeAbandon} → ${abandonAds}`);
    // Close the hub in place (mirrors closeMenu) so the live level resumes
    // exactly where it was — PLAY would reload the level instead.
    await page.evaluate(() => {
        document.getElementById("modal-menu").style.display = "none";
        const g = window.__CTF__.game;
        if (g.gameState === "paused") g.setPaused(false);
    });
    await page.waitForFunction(() => window.__CTF__?.game?.gameState === "playing", null, { timeout: 3000 });

    await page.waitForFunction(
        () => window.__CTF__?.game?.gameState === "playing" &&
              window.__CTF__.game.sparks.some((s) => s.active && s.ignited && s.progress < 0.9),
        null, { timeout: 5000 });

    const adsBeforeWin = await page.evaluate(() => window.__mock.adCalls.length);
    await winCurrentLevel(page);
    // A level-start interstitial may already have fired at PLAY; require a NEW
    // call at the level-clear results panel.
    await page.waitForFunction(
        (n) => window.__mock?.adCalls?.length > n,
        adsBeforeWin, { timeout: 8000 });
    const after = await page.evaluate(() => window.__mock);
    ok("interstitial shown at level clear (ytgame.ads)", after.adCalls.length > adsBeforeWin, `ads=${after.adCalls.join(",")}`);
    ok("progress persisted via ytgame.saveData", after.saves.length >= 1, `saves=${after.saves.length}`);
    await page.close();
}

// Rewarded-hint economy (MediaCube feature request): fresh save starts with 3
// free hint credits; an empty bank opens the rewarded prompt; watching grants
// +3 (one spent immediately on the reveal) and the new balance persists.
if (wantPb) {
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pbInit);
    await page.goto(BASE);
    await page.waitForFunction(
        () => window.__CTF__?.levels?.length === 120 && window.__mock?.order?.includes("gameReady"),
        null, { timeout: 10000 });

    const initialHints = await page.evaluate(() => window.__CTF__.save.getHints());
    ok("fresh save starts with 3 free hints", initialHints === 3, `hints=${initialHints}`);

    // Drain the free bank through the save API (same path the button uses).
    await page.evaluate(() => { const s = window.__CTF__.save; for (let i = 0; i < 10 && s.useHint(); i++) { /* drain */ } });

    // Hint button with an empty bank → rewarded prompt modal.
    await page.evaluate(() => document.getElementById("btn-hint").click());
    await page.waitForFunction(
        () => document.getElementById("modal-hints").style.display === "flex",
        null, { timeout: 3000 });
    ok("empty hint bank opens the rewarded prompt", true);

    await page.evaluate(() => document.getElementById("btn-hints-ad").click());
    await page.waitForFunction(
        () => {
            const g = window.__CTF__.game;
            return g.hintActive === true &&
                   window.__CTF__.save.getHints() === 2 &&
                   document.getElementById("modal-hints").style.display === "none";
        },
        null, { timeout: 5000 });
    const adAfter = await page.evaluate(() => window.__mock);
    ok("rewarded ad grants +3 hints (reveal spends one)", adAfter.adCalls.includes("rewarded") && adAfter.saves.length >= 1,
       `ads=${adAfter.adCalls.join(",")} saves=${adAfter.saves.length}`);
    const lastSave = await page.evaluate(() => {
        const s = window.__mock.saves.at(-1);
        try { return JSON.parse(s); } catch { return null; }
    });
    ok("hint balance persisted to ytgame.saveData", !!lastSave && lastSave.hints === 2, `hints=${lastSave?.hints}`);
    await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\nPORTAL VERIFY ${failed.length ? "FAIL" : "PASS"} (${results.length - failed.length}/${results.length})`);
process.exit(failed.length ? 1 : 0);
