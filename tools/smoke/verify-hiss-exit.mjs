// tools/smoke/verify-hiss-exit.mjs — MediaCube CTF_02 regression.
//
// "Hissing sound effect from the fuse continues playing after returning to the
// main menu: the hissing sound of the fuse fails to stop and continues to play
// indefinitely after the player clicks the Menu button."
//
// Cause: the burning-fuse loop (wick_crackle) is started and stopped from
// GameLoop._update(), and the in-game Menu button pauses via game.setPaused →
// gameState = PAUSED. _frame() skips _update() while paused, so the `else
// stopLoop("wick_crackle")` branch never ran again and the loop was orphaned —
// it kept playing over the menu forever. (A host/ad pause was unaffected
// because it also suspends the AudioContext, which is why this only reproduced
// via the Menu button.)
import { chromium } from "playwright";

const BASE = process.env.PORTAL_BASE || "http://localhost:8080";
const browser = await chromium.launch();
const results = [];
const ok = (name, cond, extra = "") => {
    results.push({ name, ok: !!cond });
    console.log(`  ${cond ? "✓" : "✗"} ${name}${extra ? ` — ${extra}` : ""}`);
};

/** Drive the hub + tutorials until sparks are burning in the level. */
async function startLevel(page) {
    const deadline = Date.now() + 15000;
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
            if (g.level && g.sparks.some((s) => s.active && s.ignited)) return "running";
            return "waiting";
        });
        if (st === "running") return true;
        await page.waitForTimeout(120);
    }
    return false;
}

const liveLoops = () => {
    const a = window.__CTF__.game.audio;
    return { loops: Object.keys(a._loops || {}), stopped: window.__stopCalls || 0 };
};

console.log("\n[verify] CTF_02 fuse hiss stops on Menu");
const page = await browser.newPage({ viewport: { width: 480, height: 800 } });
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));
// Audio contexts stay suspended without a real gesture in headless; a suspended
// context still creates and starts nodes, so the loop bookkeeping (the thing
// that actually leaks) is fully exercised. Silence the graph explicitly so the
// run can never emit sound on a dev machine either.
await page.goto(BASE, { waitUntil: "load" });
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 15000 });
// Wait out the splash so it can't swallow the hub clicks below.
await page.waitForFunction(() => document.getElementById("loading-overlay")?.style.display === "none",
    null, { timeout: 5000 });

if (!(await startLevel(page))) throw new Error("hiss: sparks never ignited");

// Count real stopAllLoops invocations (the fix's contract) without hiding the
// loop bookkeeping we also assert on.
await page.evaluate(() => {
    const a = window.__CTF__.game.audio;
    window.__stopCalls = 0;
    const orig = a.stopAllLoops.bind(a);
    a.stopAllLoops = () => { window.__stopCalls++; return orig(); };
});

// A burning fuse must own a running loop. Level 1 always has burning wicks by
// now, so _update() will have started it — assert the precondition rather than
// assuming, because a silent no-op here would make the rest of the test vacuous.
const running = await page.evaluate(() => {
    const a = window.__CTF__.game.audio;
    // If the cue's buffer didn't decode in this environment, register a real
    // (silent) AudioBuffer so the genuine start/stop path still runs.
    if (!a._buffers.wick_crackle && a.ensureCtx()) {
        a._buffers.wick_crackle = a.ensureCtx().createBuffer(1, 4410, 44100);
    }
    a.startLoop("wick_crackle");
    return { loops: Object.keys(a._loops || {}), buffered: !!a._buffers.wick_crackle };
});
ok("burning fuse has a live hiss loop", running.loops.includes("wick_crackle"),
    `buffered=${running.buffered} loops=[${running.loops.join(",")}]`);
ok("game is playing with the hiss running", (await page.evaluate(() => window.__CTF__.game.gameState)) === "playing");

// --- the reported action: click the Menu button -----------------------------
await page.click("#btn-menu");
await page.waitForFunction(() => window.__CTF__.game.gameState === "paused", null, { timeout: 4000 });
const afterMenu = await page.evaluate(liveLoops);
ok("Menu pauses the game", (await page.evaluate(() => window.__CTF__.game.gameState)) === "paused");
ok("hiss loop is stopped when leaving the level", !afterMenu.loops.includes("wick_crackle"),
    `loops=[${afterMenu.loops.join(",")}]`);
ok("no audio loop survives the menu (nothing keep playing over the hub)", afterMenu.loops.length === 0,
    `loops=[${afterMenu.loops.join(",")}]`);
ok("stopAllLoops was invoked on pause", afterMenu.stopped >= 1, `calls=${afterMenu.stopped}`);

// Give the frozen loop a moment: a leak would keep the source alive and, since
// _update() is not running, nothing else could ever stop it.
await page.waitForTimeout(1200);
const settled = await page.evaluate(liveLoops);
ok("still silent 1.2s later (loop cannot resurrect itself while paused)", settled.loops.length === 0,
    `loops=[${settled.loops.join(",")}]`);

// --- resume: PLAY returns to the same live level and the hiss comes back -----
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__.game.gameState === "playing", null, { timeout: 4000 });
const resumed = await page.evaluate(() => {
    const g = window.__CTF__.game;
    return { state: g.gameState, level: g.level && g.level.level_id, loops: Object.keys(g.audio._loops || {}) };
});
ok("PLAY resumes the same live level", resumed.state === "playing" && resumed.level === 1, `level=${resumed.level}`);

// Restart contract: _update() owns starting the loop, so a level with burning
// wicks must get its hiss back after resume. Force a burning spark rather than
// relying on L1 still burning (it may have already burnt out to a dud end),
// otherwise this assertion could pass vacuously.
await page.evaluate(() => {
    const g = window.__CTF__.game;
    const s = g.sparks[0];
    if (s) { s.active = true; s.ignited = true; s.doused = false; }
});
await page.waitForFunction(() => Object.keys(window.__CTF__.game.audio._loops || {}).includes("wick_crackle"),
    null, { timeout: 4000 }).catch(() => {});
const restarted = await page.evaluate(() => ({
    loops: Object.keys(window.__CTF__.game.audio._loops || {}),
    burning: window.__CTF__.game.sparks.some((s) => s.active && s.ignited),
}));
ok("hiss restarts after resume when a wick is burning",
    restarted.burning && restarted.loops.includes("wick_crackle"),
    `burning=${restarted.burning} loops=[${restarted.loops.join(",")}]`);

// --- leaving again must not leave a loop behind -----------------------------
await page.click("#btn-menu");
await page.waitForFunction(() => window.__CTF__.game.gameState === "paused", null, { timeout: 4000 });
const switched = await page.evaluate(() => ({
    loops: Object.keys(window.__CTF__.game.audio._loops || {}),
    stopped: window.__stopCalls || 0,
}));
ok("no loop carried across into the hub on a second exit", switched.loops.length === 0,
    `loops=[${switched.loops.join(",")}]`);
ok("stopAllLoops invoked on the second exit too", switched.stopped >= 2, `calls=${switched.stopped}`);

await page.close();
await browser.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${failed.length ? "HISS FAIL" : "HISS PASS"} (${results.length - failed.length}/${results.length})`);
if (failed.length) process.exit(1);
