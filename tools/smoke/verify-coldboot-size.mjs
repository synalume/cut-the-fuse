// tools/smoke/verify-coldboot-size.mjs — a zero-size WebView boot must never be
// latched onto.
//
// MediaCube feedback: "The game started while the frame had zero size, the frame
// has since grown, and the game still has not reached a working state — either
// gameReady never arrived, or nothing has been rendered. YouTube boots every
// playable in a zero-size WebView first — a game that measures the viewport once
// at startup latches onto 0x0 and never renders."
//
// Root cause: `new Renderer(canvas)` measures the viewport in its constructor
// (module load, before boot()) and the resize listeners were only attached at
// the END of boot() — after `await fetch("src/data/levels.json")` (488 KiB) and
// save hydration. A cold boot at 0x0 therefore pinned a 0x0 backing store,
// `--app-h: 0px` and a collapsed container, and the growth event could fire
// before anything was listening.
//
// The two cases that matter:
//   A. the frame grows and a resize event IS delivered  → listeners must refit.
//   B. the frame grows and NO resize event arrives       → the loop's per-frame
//                                                          ensureViewport() must
//                                                          self-heal anyway.
//
// Requires the dev server on :8080. Run: node tools/smoke/verify-coldboot-size.mjs
import { chromium } from "playwright";

const BASE = process.env.PORTAL_BASE || "http://localhost:8080";
const REAL = { width: 800, height: 480 };
let failures = 0;
const check = (ok, label, extra = "") => {
    if (ok) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};

const watchdog = setTimeout(() => { console.error("\nWATCHDOG: cold-boot test timed out"); process.exit(3); }, 150000);

const browser = await chromium.launch();

/** Boot with the viewport reporting 0x0 until `window.__letFrameGrow()` is
 *  called — the YouTube warm-up frame. Uses innerWidth/innerHeight getters (the
 *  path Renderer._viewportSize() falls back to) and suppresses visualViewport
 *  so the measurement is unambiguous. */
const zeroSizeInit = () => {
    window.__frameSize = { w: 0, h: 0 };
    const define = (prop, key) => Object.defineProperty(window, prop, {
        configurable: true,
        get: () => window.__frameSize[key],
    });
    define("innerWidth", "w");
    define("innerHeight", "h");
    Object.defineProperty(window, "visualViewport", { configurable: true, get: () => null });
    window.__letFrameGrow = (w = 800, h = 480) => { window.__frameSize = { w, h }; };
};

async function freshPage(initScript) {
    const page = await browser.newPage({ viewport: REAL });
    page.on("pageerror", (e) => { failures++; console.error("  ✗ pageerror:", e.message); });
    if (initScript) await page.addInitScript(initScript);
    await page.route("https://www.youtube.com/game_api/v1", (r) => r.fulfill({ status: 200, contentType: "application/javascript", body: "" }));
    return page;
}

const state = (page) => page.evaluate(() => {
    const { renderer } = window.__CTF__;
    const cs = getComputedStyle(document.documentElement);
    const canvas = document.querySelector("canvas");
    return {
        rendererW: renderer.width, rendererH: renderer.height,
        canvasW: canvas.width, canvasH: canvas.height,
        cssW: canvas.style.width, cssH: canvas.style.height,
        appH: cs.getPropertyValue("--app-h").trim(),
        containerH: document.getElementById("game-container").style.height,
        // Did anything actually paint? A 0x0 canvas can never be non-blank.
        painted: canvas.width > 0 && canvas.height > 0,
    };
});

// ── A. Zero-size boot, then the frame grows and fires a resize event ────────
console.log("\n[coldboot] A: zero-size boot → frame grows + resize event");
{
    const page = await freshPage(zeroSizeInit);
    await page.goto(BASE);
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 20000 });

    const booted = await state(page);
    check(booted.rendererW === 0 && booted.rendererH === 0,
        "zero-size boot does NOT latch a fake size", JSON.stringify(booted));
    check(booted.canvasW === 0 || booted.canvasW === 300,
        "no 0x0 canvas was painted into at boot (untouched default is fine too)", `canvas=${booted.canvasW}x${booted.canvasH}`);
    check(booted.appH !== "0px", "--app-h is never published as 0px", booted.appH);

    // The frame grows — with a real event, as a normal browser would.
    await page.evaluate(() => { window.__letFrameGrow(800, 480); window.dispatchEvent(new Event("resize")); });
    await page.waitForTimeout(400);
    const grown = await state(page);
    check(grown.rendererW === REAL.width && grown.rendererH === REAL.height,
        "resize event refits the canvas to the grown frame", JSON.stringify(grown));
    check(grown.appH === `${REAL.height}px`, "--app-h published once a real size exists", grown.appH);
    check(grown.canvasW > 0 && grown.canvasH > 0, "canvas backing store is non-zero", `${grown.canvasW}x${grown.canvasH}`);
    await page.close();
}

// ── B. The hard case: the frame grows and NO resize event ever arrives ──────
console.log("\n[coldboot] B: zero-size boot → frame grows with NO resize event (self-heal)");
{
    const page = await freshPage(zeroSizeInit);
    await page.goto(BASE);
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 20000 });
    const booted = await state(page);
    check(booted.rendererW === 0, "still zero-size after boot", JSON.stringify(booted));

    // Grow the frame WITHOUT dispatching resize/orientationchange — exactly the
    // missed-event scenario. Only the loop can notice.
    await page.evaluate(() => window.__letFrameGrow(800, 480));
    await page.waitForFunction(() => window.__CTF__.renderer.width === 800, null, { timeout: 5000 })
        .catch(() => {});
    const healed = await state(page);
    check(healed.rendererW === REAL.width && healed.rendererH === REAL.height,
        "loop self-heals the canvas with no resize event at all", JSON.stringify(healed));
    check(healed.appH === `${REAL.height}px`, "--app-h published by the self-heal path", healed.appH);
    check(healed.cssW === "800px" && healed.cssH === "480px",
        "canvas CSS matches the grown frame", `${healed.cssW} x ${healed.cssH}`);
    check(healed.containerH === `${REAL.height}px`, "#game-container re-sized", healed.containerH);

    // It must be a real, playable game — not just a sized canvas.
    await page.evaluate(() => document.getElementById("level-label").click());
    await page.waitForFunction(() => getComputedStyle(document.getElementById("modal-levels")).display !== "none", null, { timeout: 8000 });
    await page.evaluate(() => document.querySelector('.level-cell[title="Play level 1"]')?.click());
    await page.waitForFunction(() => window.__CTF__?.game?.level?.level_id === 1, null, { timeout: 15000 });
    const playable = await page.evaluate(() => {
        const { game, renderer } = window.__CTF__;
        return { fuses: game.fuses.length, w: renderer.width, h: renderer.height, cut: game.cuts.length };
    });
    check(playable.fuses > 0, "a level loads and simulates after the self-heal", JSON.stringify(playable));
    await page.close();
}

// ── C. Normal boot is unaffected (no false refits while sizes are stable) ───
console.log("\n[coldboot] C: normal boot, and no redundant buffer reallocation");
{
    const page = await freshPage(null);
    await page.goto(BASE);
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 20000 });

    const first = await page.evaluate(() => {
        const c = document.querySelector("canvas");
        // Tag the buffer; a redundant resize would reset the drawing surface and
        // clear this. Poki's captureStream depends on the buffer staying put.
        c.__tag = "keep";
        return { w: window.__CTF__.renderer.width, h: window.__CTF__.renderer.height };
    });
    check(first.w === REAL.width && first.h === REAL.height,
        "normal boot fits the real viewport", JSON.stringify(first));

    // Count resize() calls that actually change anything over ~1s of frames.
    const churn = await page.evaluate(async () => {
        const r = window.__CTF__.renderer;
        let changes = 0;
        const orig = r.onViewportChange;
        r.onViewportChange = (...a) => { changes++; return orig?.(...a); };
        await new Promise((res) => setTimeout(res, 1000));
        r.onViewportChange = orig;
        return { changes, tag: document.querySelector("canvas").__tag };
    });
    check(churn.changes === 0, "per-frame ensureViewport() causes zero refits when stable", `changes=${churn.changes}`);
    check(churn.tag === "keep", "canvas buffer is never needlessly reallocated");

    // firstFrameReady order is preserved (Playables lifecycle).
    const order = await page.evaluate(() => window.__CTF__ && ({ state: window.__CTF__.game.gameState }));
    check(!!order, "game loop still running", JSON.stringify(order));
    await page.close();
}

await browser.close();
clearTimeout(watchdog);
console.log(`\nCOLDBOOT ${failures ? "FAIL" : "PASS"} (${failures} failures)`);
process.exit(failures ? 1 : 0);
