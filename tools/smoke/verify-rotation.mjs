// tools/smoke/verify-rotation.mjs — device rotation must re-fit the live level
// immediately, without a trip through the menu.
//
// MediaCube feedback: "When rotating the device from portrait to landscape
// mode, the UI elements break and become misaligned. To restore the correct
// layout the player has to exit to the menu and return to the level."
//
// Root cause: buildLevel() bakes the viewport centre into every coordinate and
// the camera is fitted to the build-time viewport, so a rotation left the whole
// puzzle laid out for the old orientation until the level was rebuilt. The fix
// re-centres the built level in place (relayoutLevel + game.relayout), so
// rotation must now land identically to a fresh load in the new orientation and
// must NOT disturb progress or the cut marks the sim reads.
//
// Requires the dev server on :8080. Run: node tools/smoke/verify-rotation.mjs
import { chromium } from "playwright";

const BASE = process.env.PORTAL_BASE || "http://localhost:8080";
const PORTRAIT = { width: 480, height: 800 };
const LANDSCAPE = { width: 800, height: 480 };
const EPS = 0.01;

let failures = 0;
const check = (ok, label, extra = "") => {
    if (ok) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ""}`); }
};
const close = (a, b, eps = EPS) => Math.abs(a - b) <= eps;

// Hard watchdog: a layout test must never hang the suite.
const watchdog = setTimeout(() => { console.error("\nWATCHDOG: rotation test timed out"); process.exit(3); }, 150000);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: PORTRAIT });
page.on("pageerror", (e) => { failures++; console.error("  ✗ pageerror:", e.message); });

// The cert zip loads the real YouTube game_api script. Stub it out so the run
// measures layout, not the network — the Playables code paths all guard on
// `typeof ytgame !== "undefined"`, so an absent SDK is a valid configuration.
await page.route("https://www.youtube.com/game_api/v1", (route) => route.fulfill({ status: 200, contentType: "application/javascript", body: "" }));

await page.goto(BASE);
console.log(`[rotation] base: ${BASE}`);
await page.waitForFunction(() => window.__CTF__?.levels?.length === 120, null, { timeout: 15000 });
console.log("[rotation] booted");

/** Dismiss the teaching card if one is up. Driven through the DOM so an
 *  overlay can never stall the run on Playwright's actionability checks. */
const dismissTutorial = async () => {
    await page.evaluate(() => {
        const box = document.getElementById("tutorial-overlay");
        if (box && getComputedStyle(box).display !== "none") document.getElementById("tutorial-next")?.click();
    });
    await page.waitForTimeout(120);
};

/** Load a level through the real level-select UI.
 *  Opens the grid from the HUD level label: it is reachable both at the hub and
 *  mid-level (the corner controls hide under modals, so the hub's LEVELS button
 *  is not a reliable entry point after a level is already running). */
async function loadLevel(id) {
    await dismissTutorial();
    await page.evaluate(() => document.getElementById("level-label").click());
    await page.waitForFunction(
        () => getComputedStyle(document.getElementById("modal-levels")).display !== "none",
        null, { timeout: 8000 });
    await page.evaluate((levelId) => {
        document.querySelector(`.level-cell[title="Play level ${levelId}"]`)?.click();
    }, id);
    await page.waitForFunction((levelId) => window.__CTF__?.game?.level?.level_id === levelId && window.__CTF__.game.fuses.length > 0,
        id, { timeout: 15000 });
    await dismissTutorial();
    await page.waitForTimeout(350);
    // Park the sim so geometry comparisons are deterministic.
    await page.evaluate(() => window.__CTF__.game.setPaused(true));
}

const resume = () => page.evaluate(() => window.__CTF__.game.setPaused(false));

/** Everything a rotation has to re-fit: camera, level geometry, cut marks,
 *  pickups, the CSS app shell and the DOM chrome's position. */
const snapshot = () => page.evaluate(() => {
    const { game, renderer } = window.__CTF__;
    const f = game.fuses[0];
    const cs = getComputedStyle(document.documentElement);
    const rect = (sel) => {
        const el = document.querySelector(sel);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: +r.x.toFixed(2), y: +r.y.toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) };
    };
    const pickup = (game.pickups || [])[0] || null;
    return {
        viewport: { w: innerWidth, h: innerHeight, vw: window.visualViewport?.width ?? null, vh: window.visualViewport?.height ?? null },
        appH: cs.getPropertyValue("--app-h").trim(),
        appW: cs.getPropertyValue("--app-w").trim(),
        renderer: { w: renderer.width, h: renderer.height },
        canvasCss: { w: document.querySelector("canvas").style.width, h: document.querySelector("canvas").style.height },
        containerH: document.getElementById("game-container").style.height,
        camera: { x: +game.camera.x.toFixed(3), y: +game.camera.y.toFixed(3), zoom: +game.camera.zoom.toFixed(5) },
        layoutViewport: game.level.layoutViewport ? { ...game.level.layoutViewport } : null,
        nodes: game.level.nodes.map((n) => [+n.x.toFixed(3), +n.y.toFixed(3)]),
        fuseGeometry: game.level.fuses.map((fu) => ({
            cp1: [+fu.cp1.x.toFixed(2), +fu.cp1.y.toFixed(2)],
            cp2: [+fu.cp2.x.toFixed(2), +fu.cp2.y.toFixed(2)],
            ip: fu.intersectionPt ? [+fu.intersectionPt.x.toFixed(2), +fu.intersectionPt.y.toFixed(2)] : null,
            path: (fu.path || []).map((s) => [+s.end.x.toFixed(2), +s.end.y.toFixed(2)]),
            len: fu._lens ? +fu._lens.reduce((a, b) => a + b, 0).toFixed(3) : null,
        })),
        cuts: game.cuts.map((c) => [+c.x.toFixed(2), +c.y.toFixed(2), c.fuseId, +(c.snipT ?? -1).toFixed(4)]),
        pickup: pickup ? [+pickup.x.toFixed(2), +pickup.y.toFixed(2), pickup.collected] : null,
        rects: { header: rect(".header"), controls: rect(".controls") },
        snipsRemaining: game.snipsRemaining,
        burnt: game.fuses.map((fu) => +fu.burntProgress.toFixed(4)),
    };
});

/** Geometry + camera must land exactly where a fresh load in this orientation
 *  puts them — that is what "auto-scale/reposition on rotation" means. */
function sameLayout(a, b, label) {
    const problems = [];
    if (!close(a.camera.x, b.camera.x, 0.5) || !close(a.camera.y, b.camera.y, 0.5) || !close(a.camera.zoom, b.camera.zoom, 0.005))
        problems.push(`camera rotated=${JSON.stringify(a.camera)} fresh=${JSON.stringify(b.camera)}`);
    if (a.nodes.length !== b.nodes.length) problems.push("node count differs");
    else a.nodes.forEach((n, i) => {
        if (!close(n[0], b.nodes[i][0], 0.5) || !close(n[1], b.nodes[i][1], 0.5))
            problems.push(`node ${i} rotated=${n} fresh=${b.nodes[i]}`);
    });
    if (a.fuseGeometry.length !== b.fuseGeometry.length) problems.push("fuse count differs");
    else a.fuseGeometry.forEach((g, i) => {
        const h = b.fuseGeometry[i];
        if (!close(g.cp1[0], h.cp1[0], 0.5) || !close(g.cp1[1], h.cp1[1], 0.5)) problems.push(`fuse ${i} cp1 ${g.cp1} vs ${h.cp1}`);
        if (g.ip && h.ip && (!close(g.ip[0], h.ip[0], 0.5) || !close(g.ip[1], h.ip[1], 0.5))) problems.push(`fuse ${i} ip ${g.ip} vs ${h.ip}`);
        if (g.path.length !== h.path.length) problems.push(`fuse ${i} path length differs`);
        else g.path.forEach((p, j) => {
            if (!close(p[0], h.path[j][0], 0.5) || !close(p[1], h.path[j][1], 0.5)) problems.push(`fuse ${i} path ${j} ${p} vs ${h.path[j]}`);
        });
        // Arc length is translation-invariant: a shift must never change it.
        if (g.len != null && h.len != null && !close(g.len, h.len, 0.5)) problems.push(`fuse ${i} length ${g.len} vs ${h.len}`);
    });
    check(problems.length === 0, label, problems.slice(0, 4).join(" | "));
    return problems.length === 0;
}

// ── 1. Portrait → landscape must equal a fresh landscape load ────────────────
console.log("\n[rotation] portrait → landscape (level 1)");
await loadLevel(1);
const portrait = await snapshot();
check(portrait.renderer.w === PORTRAIT.width && portrait.renderer.h === PORTRAIT.height,
    "canvas built at portrait size", JSON.stringify(portrait.renderer));

await page.setViewportSize(LANDSCAPE);
await page.waitForTimeout(700);
const rotated = await snapshot();
check(rotated.renderer.w === LANDSCAPE.width && rotated.renderer.h === LANDSCAPE.height,
    "canvas resized to landscape", JSON.stringify(rotated.renderer));
check(rotated.appH === `${LANDSCAPE.height}px`, "--app-h follows the new viewport", rotated.appH);
check(rotated.containerH === `${LANDSCAPE.height}px`, "#game-container height follows", rotated.containerH);
check(rotated.layoutViewport?.width === LANDSCAPE.width && rotated.layoutViewport?.height === LANDSCAPE.height,
    "level's layout viewport updated", JSON.stringify(rotated.layoutViewport));
check(rotated.snipsRemaining === portrait.snipsRemaining, "rotation does not touch progress (snips)",
    `${portrait.snipsRemaining} -> ${rotated.snipsRemaining}`);

// DOM chrome must stay on screen (the reviewer's "UI elements break").
const inView = (r) => r && r.x >= -0.5 && r.y >= -0.5 && r.x + r.w <= LANDSCAPE.width + 0.5 && r.y + r.h <= LANDSCAPE.height + 0.5;
check(inView(rotated.rects.header), "header stays inside the viewport after rotation", JSON.stringify(rotated.rects.header));
check(inView(rotated.rects.controls), "controls stay inside the viewport after rotation", JSON.stringify(rotated.rects.controls));

// Ground truth: load the same level fresh, already in landscape.
await loadLevel(1);
const freshLandscape = await snapshot();
sameLayout(rotated, freshLandscape, "rotated layout == fresh landscape load (no menu trip needed)");

// ── 2. Landscape → portrait round trip ──────────────────────────────────────
console.log("\n[rotation] landscape → portrait round trip");
await page.setViewportSize(PORTRAIT);
await page.waitForTimeout(700);
const backToPortrait = await snapshot();
await loadLevel(1);
const freshPortrait = await snapshot();
sameLayout(backToPortrait, freshPortrait, "rotating back matches a fresh portrait load");
check(backToPortrait.appH === `${PORTRAIT.height}px`, "--app-h restored on the way back", backToPortrait.appH);

// ── 3. Cut marks must ride with the wicks (gameplay integrity) ──────────────
// `game.cuts` are checked against fuse coordinates every frame, so a rotation
// that re-centred the level without moving them would let a severed spark burn
// straight through its own cut.
console.log("\n[rotation] cut marks survive a rotation");
await resume();
const toScreen = (wx, wy) => page.evaluate(([x, y]) => {
    const { game, renderer } = window.__CTF__;
    const c = game.camera;
    return { x: (x + c.x - renderer.width / 2) * c.zoom + renderer.width / 2, y: (y + c.y - renderer.height / 2) * c.zoom + renderer.height / 2 };
}, [wx, wy]);

// Swipe across the wick just ahead of the live spark — a real, severed cut.
const target = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const i = g.sparks.findIndex((s) => s.active && !s.chain);
    const f = g.fuses[i];
    const a = f.startNode, b = f.cp1, c = f.cp2, d = f.endNode;
    const u = 0.22; const v = 1 - u;
    return {
        i,
        ax: v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * c.x + u * u * u * d.x,
        ay: v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * c.y + u * u * u * d.y,
    };
});
const p1 = await toScreen(target.ax - 60, target.ay - 60);
const p2 = await toScreen(target.ax + 60, target.ay + 60);
await page.mouse.move(p1.x, p1.y);
await page.mouse.down();
await page.mouse.move(p2.x, p2.y, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(150);

const cutBefore = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const f = g.fuses[0];
    const t = g._cutAheadOnFuse(f, 0);
    const c = g.cuts[0];
    return { cuts: g.cuts.length, t, x: c?.x ?? null, y: c?.y ?? null };
});
check(cutBefore.cuts > 0, "a real swipe registered a cut", JSON.stringify(cutBefore));

await page.setViewportSize(LANDSCAPE);
await page.waitForTimeout(700);
const cutAfter = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const f = g.fuses[0];
    const t = g._cutAheadOnFuse(f, 0);
    const c = g.cuts[0];
    /* Distance from the stored cut point to its own wick: it must stay within
       the cut radius, which only holds if the cut moved with the level. */
    let dist = null;
    if (c) {
        const a = f.startNode, b = f.cp1, cc = f.cp2, d = f.endNode;
        let best = Infinity;
        for (let k = 0; k <= 100; k++) {
            const u = k / 100, v = 1 - u;
            const x = v * v * v * a.x + 3 * v * v * u * b.x + 3 * v * u * u * cc.x + u * u * u * d.x;
            const y = v * v * v * a.y + 3 * v * v * u * b.y + 3 * v * u * u * cc.y + u * u * u * d.y;
            best = Math.min(best, Math.hypot(c.x - x, c.y - y));
        }
        dist = best;
    }
    return { cuts: g.cuts.length, t, dist, x: c?.x ?? null, y: c?.y ?? null };
});
check(cutAfter.cuts === cutBefore.cuts, "cut count unchanged by rotation");
check(cutAfter.t != null && cutBefore.t != null && close(cutAfter.t, cutBefore.t, 0.0001),
    "cut still sits at the same point along its wick (t preserved)",
    `before=${cutBefore.t} after=${cutAfter.t}`);
check(cutAfter.dist != null && cutAfter.dist < 26,
    "cut point is still within the cut radius of its shifted wick",
    `distance=${cutAfter.dist?.toFixed(2)} (would be far larger if not shifted)`);
check(cutAfter.x !== cutBefore.x || cutAfter.y !== cutBefore.y,
    "cut was translated with the level", `before=(${cutBefore.x},${cutBefore.y}) after=(${cutAfter.x},${cutAfter.y})`);

// ── 4. Levels with pickups + shaped (multi-bend) wicks ──────────────────────
console.log("\n[rotation] shaped wicks + pickup stars (level 46)");
await page.setViewportSize(PORTRAIT);
await page.waitForTimeout(500);
await loadLevel(46);
const l46Portrait = await snapshot();
check((l46Portrait.fuseGeometry.some((g) => g.path.length > 0)), "level 46 has shaped wick paths to move");
await page.setViewportSize(LANDSCAPE);
await page.waitForTimeout(700);
const l46Rotated = await snapshot();
await loadLevel(46);
const l46Fresh = await snapshot();
sameLayout(l46Rotated, l46Fresh, "shaped wicks + pickups re-fit on rotation");
if (l46Portrait.pickup) {
    check(l46Rotated.pickup !== null, "pickup star still positioned after rotation", JSON.stringify(l46Rotated.pickup));
    check(l46Rotated.pickup[0] !== l46Portrait.pickup[0],
        "pickup star moved with the level", `portrait x=${l46Portrait.pickup[0]} rotated x=${l46Rotated.pickup[0]}`);
}
check(l46Rotated.rects.controls && l46Rotated.rects.controls.x >= -0.5,
    "controls in bounds on level 46 landscape", JSON.stringify(l46Rotated.rects.controls));

await browser.close();
clearTimeout(watchdog);
console.log(`\nROTATION ${failures ? "FAIL" : "PASS"} (${failures} failures)`);
process.exit(failures ? 1 : 0);
