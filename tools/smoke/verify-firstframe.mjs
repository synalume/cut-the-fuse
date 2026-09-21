// tools/smoke/verify-firstframe.mjs — MediaCube CTF_01 regression.
//
// firstFrameReady must be called while the LOADING SPLASH is on screen, and it
// must NOT depend on a rendered canvas frame. The SDK test suite launches the
// game in an off-screen iframe, where requestAnimationFrame never fires — the
// old implementation signalled off the game loop's first painted frame, so the
// signal could never arrive while gameReady still did, and the suite reported
// "the firstFrameReady test fails".
//
// Two scenarios:
//   A) rAF neutered (the reported failure): firstFrameReady + gameReady must
//      BOTH still fire, in order, with the splash visibly up. FAILS on the
//      pre-fix code, where firstFrameReady never arrives at all.
//   B) normal boot: the splash must come down once the menu is usable, and the
//      canvas must actually render — otherwise the splash itself becomes a
//      "nothing has been rendered" bug.
import { chromium } from "playwright";

const BASE = process.env.PORTAL_BASE || "http://localhost:8080";
const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/** Playables SDK mock. Records the splash state at the exact moment each
 *  lifecycle call lands, which is the part MediaCube actually tests. */
const pbInit = () => {
    window.__CUT_THE_FUSE_PLAYABLES__ = true;
    window.__mock = { order: [], ffr: null, gr: null };
    const snap = () => {
        const el = document.getElementById("loading-overlay");
        return {
            present: !!el,
            visible: !!el && el.style.display !== "none" && !el.classList.contains("is-hidden"),
            title: el ? (el.querySelector("#loading-title") || {}).textContent : null,
        };
    };
    window.ytgame = {
        IN_PLAYABLES_ENV: true,
        game: {
            firstFrameReady: () => {
                window.__mock.order.push("firstFrameReady");
                if (!window.__mock.ffr) window.__mock.ffr = snap();
            },
            gameReady: () => {
                window.__mock.order.push("gameReady");
                if (!window.__mock.gr) window.__mock.gr = snap();
            },
            loadData: async () => null,
            saveData: async () => {},
        },
        system: {
            isAudioEnabled: () => true,
            onAudioEnabledChange: () => {},
            onPause: () => {},
            onResume: () => {},
        },
        ads: {
            requestInterstitialAd: async () => {},
            requestRewardedAd: async () => true,
        },
    };
};

// ---- A) off-screen iframe: requestAnimationFrame never fires ---------------
console.log("\n[verify] CTF_01 firstFrameReady — rAF suppressed (off-screen iframe)");
{
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pbInit);
    // THE regression condition: a backgrounded / off-screen iframe gets no rAF.
    // The game loop can therefore never draw a frame.
    await page.addInitScript(() => {
        window.__rafCalls = 0;
        window.requestAnimationFrame = () => { window.__rafCalls++; return 0; };
        window.cancelAnimationFrame = () => {};
    });
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => window.__mock?.order?.includes("gameReady"), null, { timeout: 15000 });
    const m = await page.evaluate(() => ({
        order: window.__mock.order.slice(),
        ffr: window.__mock.ffr,
        gr: window.__mock.gr,
        rafCalls: window.__rafCalls,
        framesDrawn: window.__CTF__?.game?._firstFrameDrawn ?? null,
    }));
    ok("requestAnimationFrame never fired (iframe is off-screen)", m.rafCalls > 0 && m.framesDrawn !== true,
        `raf calls=${m.rafCalls}, loop drew a frame=${m.framesDrawn}`);
    ok("firstFrameReady still fired without any rAF", m.order.includes("firstFrameReady"), `order=${m.order.join(" → ")}`);
    ok("firstFrameReady fired before gameReady",
        m.order.indexOf("firstFrameReady") !== -1 && m.order.indexOf("firstFrameReady") < m.order.indexOf("gameReady"),
        `order=${m.order.join(" → ")}`);
    ok("firstFrameReady was called with the splash visible", m.ffr && m.ffr.present && m.ffr.visible,
        JSON.stringify(m.ffr));
    ok("the splash actually names the loading state", m.ffr && m.ffr.title === "CUT THE FUSE",
        `title=${m.ffr && m.ffr.title}`);
    ok("both lifecycle calls fired exactly once each",
        m.order.filter((o) => o === "firstFrameReady").length === 1 && m.order.filter((o) => o === "gameReady").length === 1,
        `order=${m.order.join(" → ")}`);
    await page.close();
}

// ---- B) normal boot: the splash comes down, the game renders --------------
console.log("\n[verify] CTF_01 splash lifecycle — normal boot");
{
    const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
    page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
    await page.route("https://www.youtube.com/game_api/v1", (route) =>
        route.fulfill({ status: 200, contentType: "text/javascript", body: "" }));
    await page.addInitScript(pbInit);
    await page.goto(BASE, { waitUntil: "load" });
    await page.waitForFunction(() => window.__mock?.order?.includes("gameReady"), null, { timeout: 15000 });
    // The splash fades over 260ms, then is removed on transitionend / the timer.
    await page.waitForFunction(() => document.getElementById("loading-overlay")?.style.display === "none",
        null, { timeout: 4000 });
    const after = await page.evaluate(() => ({
        display: document.getElementById("loading-overlay").style.display,
        canvasW: document.querySelector("canvas").width,
        canvasH: document.querySelector("canvas").height,
        menuOpen: document.getElementById("modal-menu").style.display === "flex",
    }));
    ok("splash is taken down once the menu is up", after.display === "none", `display=${after.display}`);
    ok("menu is interactable behind it", after.menuOpen);
    ok("canvas is sized (game can render)", after.canvasW > 0 && after.canvasH > 0,
        `${after.canvasW}x${after.canvasH}`);

    // The splash must never eat input once dismissed.
    const clickable = await page.evaluate(() => {
        const el = document.getElementById("loading-overlay");
        const r = el.getBoundingClientRect();
        const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return top === el || el.contains(top);
    });
    ok("dismissed splash does not intercept taps", !clickable);
    await page.close();
}

await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "FIRSTFRAME FAIL" : "FIRSTFRAME PASS"} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exit(1);
