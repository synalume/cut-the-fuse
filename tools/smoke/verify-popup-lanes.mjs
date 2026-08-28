// tools/smoke/verify-popup-lanes.mjs — Playwright check that the announcement
// popups (PERFECT! / LAST SNIP! / +N / NO MORE SNIPS!) never overlap each other
// or the reaction chatter (AHH!/EEK!) when they fire at the same spot.
// Requires dev server on :8080.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const BASE = "http://localhost:8080";

let failures = 0;
function check(ok, label, extra = "") {
    if (ok) console.log(`  ✓ ${label}`);
    else { failures++; console.error(`  ✗ ${label}${extra ? " — " + extra : ""}`); }
}

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.on("pageerror", (e) => console.error("  [pageerror]", e.message));

async function openLevel(idx) {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });
    // Home screen first — press PLAY to load a level, then pick from the map.
    await page.click("#btn-menu-play");
    await page.waitForFunction(() => window.__CTF__?.game?.fuses?.length > 0, null, { timeout: 10000 });
    await page.click("#level-label");
    await page.waitForFunction(() => document.getElementById("modal-levels").style.display !== "none");
    await page.evaluate((i) => document.getElementById("level-grid").children[i].click(), idx);
    await page.waitForFunction(() => {
        const g = window.__CTF__.game;
        return g?.gameState === "playing";
    }, null, { timeout: 10000 });
}

// Mirrors Renderer._activeReactionObstacles + _drawPopupWords collision model.
const MIRROR = `
    const REACTION_SHOW_FRAMES = 55;
    const REACTION_WORDS = window.__CTF__.REACTION_WORDS || null;
    const pick = (levelId, nodeId, list) => {
        const seed = String(levelId) + ":" + nodeId;
        let h = 0;
        for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0;
        return list[h % list.length];
    };
    const popupOverlap = () => {
        const g = window.__CTF__.game;
        const active = (at, dur) => at != null && g.frameCount >= at && g.frameCount - at < dur;
        const list = [];
        if (g.noSnipsAt && active(g.noSnipsAt.at, 85)) list.push({ text: "NO MORE SNIPS!", x: g.noSnipsAt.x, y: g.noSnipsAt.y, size: 24, at: g.noSnipsAt.at, dy: -26 });
        if (g.lastSnipAt != null) {
            const last = g.cuts[g.cuts.length - 1];
            if (last && active(g.lastSnipAt, 70)) list.push({ text: "LAST SNIP!", x: last.x, y: last.y, size: 22, at: g.lastSnipAt, dy: -78 });
        }
        for (const p of g.perfectSnipsAt || []) if (active(p.at, 65)) list.push({ text: "PERFECT!", x: p.x, y: p.y, size: 21, at: p.at, dy: -38 });
        for (const mk of g.multikills || []) if (active(mk.at, 55)) list.push({ text: "+" + mk.count, x: mk.x, y: mk.y, size: 30 + mk.count * 5, at: mk.at, dy: -140 });

        const ctx = document.createElement("canvas").getContext("2d");
        const box = (text, size) => {
            ctx.font = size + "px 'Luckiest Guy', 'Courier New', Courier, monospace";
            return { halfH: size * 0.62 * 1.4, halfW: ctx.measureText(text).width / 2 };
        };

        // Reaction chatter already on screen acts as placed obstacles.
        const placed = [];
        const payload = (g.nodes || []).find((n) => n.type === "payload");
        if (payload) {
            let latestIgnite = -1;
            for (const s of g.sparks || []) {
                if (s.active && s.ignited && s.ignitedAt != null && s.progress < 1) latestIgnite = Math.max(latestIgnite, s.ignitedAt);
            }
            if (latestIgnite >= 0 && active(latestIgnite, REACTION_SHOW_FRAMES) && REACTION_WORDS) {
                const o = { text: pick(g.level.level_id, payload.id, REACTION_WORDS.payloadDanger), x: payload.x, y: payload.y - 128, size: 40 };
                placed.push({ x: o.x, y: o.y, ...box(o.text, o.size) });
            }
        }
        for (const node of g.nodes || []) {
            if (node.type !== "spawn") continue;
            const fuseIndex = g.fuses.findIndex((f) => f.start === node.id);
            const spark = fuseIndex >= 0 ? g.sparks[fuseIndex] : null;
            if (spark && spark.active && spark.ignited && active(spark.ignitedAt, REACTION_SHOW_FRAMES) && REACTION_WORDS) {
                const o = { text: pick(g.level.level_id, node.id, REACTION_WORDS.spawnLit), x: node.x, y: node.y - 58, size: 22 };
                placed.push({ x: o.x, y: o.y, ...box(o.text, o.size) });
            }
            if (spark && !spark.active && active(spark.diedAt, 60) && REACTION_WORDS) {
                const o = { text: pick(g.level.level_id, node.id, REACTION_WORDS.spawnDud), x: node.x, y: node.y - 58, size: 26 };
                placed.push({ x: o.x, y: o.y, ...box(o.text, o.size) });
            }
        }

        list.sort((a, b) => a.at - b.at);
        for (const p of list) {
            const b = box(p.text, p.size);
            let ty = p.y + p.dy;
            for (const q of placed) {
                if (Math.abs(q.x - p.x) > q.halfW + b.halfW + 14) continue;
                if (ty + b.halfH <= q.y - q.halfH) continue;
                if (ty - b.halfH < q.y + q.halfH) ty = q.y - q.halfH - b.halfH - 10;
            }
            placed.push({ x: p.x, y: ty, halfW: b.halfW, halfH: b.halfH, text: p.text });
        }
        for (let i = 0; i < placed.length; i++) {
            for (let j = i + 1; j < placed.length; j++) {
                const a = placed[i], b = placed[j];
                if (Math.abs(a.x - b.x) < a.halfW + b.halfW + 14 && Math.abs(a.y - b.y) < a.halfH + b.halfH) {
                    return { overlapping: [a.text, b.text] };
                }
            }
        }
        return { overlapping: null, lanes: placed.filter((p) => p.text).map((p) => p.text + "@" + Math.round(p.y)) };
    };
`;

// ---- 1. One snip fires PERFECT + LAST SNIP + +N at the same spot -----------
console.log("[verify] one snip fires PERFECT + LAST SNIP + +N at the same spot");
await openLevel(3); // L4 — two wicks through a shared chokepoint
const cut = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const cp = g.level.intersectionMap.cut1;
    for (let i = 0; i < g.sparks.length; i++) {
        g.sparks[i].ignited = true;
        g.sparks[i].active = true;
        g.sparks[i].progress = 0.45;
        g.sparks[i].ignitedAt = g.frameCount;
    }
    g.snipsRemaining = 2;
    const ok = g.tryCut(
        { x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y },
        [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]
    );
    if (!ok) return null;
    const r = g.renderer, c = g.camera;
    const sx = (cp.x + c.x - r.width / 2) * c.zoom + r.width / 2;
    const sy = (cp.y + c.y - r.height / 2) * c.zoom + r.height / 2;
    return { sx, sy, perfects: g.perfectSnips, multikill: g.multikills[0]?.count, lastSnip: g.lastSnipAt != null, snipsLeft: g.snipsRemaining };
});
check(cut != null, "popups: snip lands at the shared chokepoint", JSON.stringify(cut));
check(cut.perfects === 1, "popups: the snip is a PERFECT snip", String(cut.perfects));
check(cut.multikill === 2, "popups: the snip severs 2 wicks (+N)", String(cut.multikill));
check(cut.lastSnip && cut.snipsLeft === 1, "popups: the snip is also the LAST SNIP", `left=${cut.snipsLeft}`);
const overlap1 = await page.evaluate(`(() => {${MIRROR} return popupOverlap();})()`);
check(overlap1.overlapping == null, "popups: PERFECT/LAST/+N resolve without overlap", JSON.stringify(overlap1.overlapping) + " lanes=" + JSON.stringify(overlap1.lanes));
await page.waitForTimeout(240);
const box = { x: Math.max(0, cut.sx - 150), y: Math.max(0, cut.sy - 330), width: 300, height: 350 };
writeFileSync(path.join(ROOT, "tools/smoke/verify-popup-lanes.png"), await page.screenshot({ clip: box }));
console.log("  → screenshot tools/smoke/verify-popup-lanes.png");

// ---- 2. Spending the last snip + a denied swipe stacks NO MORE SNIPS! --------
console.log("\n[verify] NO MORE SNIPS! stacks with +N / LAST SNIP, no overlap");
await openLevel(3);
const denied = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const cp = g.level.intersectionMap.cut1;
    const r = g.renderer, c = g.camera;
    const sx = (cp.x + c.x - r.width / 2) * c.zoom + r.width / 2;
    const sy = (cp.y + c.y - r.height / 2) * c.zoom + r.height / 2;
    const cut1 = g.tryCut({ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }, [{ x: cp.x - 26, y: cp.y }, { x: cp.x + 26, y: cp.y }]);
    const f = g.fuses.find((x) => x.routeThrough !== "cut1") || g.fuses[0];
    const p = f.intersectionPt;
    const cut2 = g.tryCut({ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }, [{ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }]);
    const denied = g.notifyNoSnips({ x: cp.x - 20, y: cp.y }, { x: cp.x + 20, y: cp.y });
    return { cut1, cut2, denied, sx, sy };
});
check(denied.cut1 && denied.cut2, "popups: two cuts spent the budget", JSON.stringify(denied));
check(denied.denied === true, "popups: denied swipe registers NO MORE SNIPS!", String(denied.denied));
const overlap2 = await page.evaluate(`(() => {${MIRROR} return popupOverlap();})()`);
check(overlap2.overlapping == null, "popups: NO MORE SNIPS! resolves without overlap", JSON.stringify(overlap2.overlapping) + " lanes=" + JSON.stringify(overlap2.lanes));
await page.waitForTimeout(120);
const box2 = { x: Math.max(0, denied.sx - 150), y: Math.max(0, denied.sy - 330), width: 300, height: 350 };
writeFileSync(path.join(ROOT, "tools/smoke/verify-popup-lanes-denied.png"), await page.screenshot({ clip: box2 }));
console.log("  → screenshot tools/smoke/verify-popup-lanes-denied.png");

// ---- 3. A perfect snip right at an igniting matchstick clears its EEK! -------
console.log("\n[verify] PERFECT! near an igniting spawn clears its reaction word");
await openLevel(0); // L1 — single fuse, first snip is perfect-sniffable
const spawnTest = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const f = g.fuses[0];
    // Ignite the spark and put the cut just ahead of it, close to the matchstick.
    g.sparks[0].ignited = true;
    g.sparks[0].active = true;
    g.sparks[0].progress = 0.02;
    g.sparks[0].ignitedAt = g.frameCount;
    const bez = (t) => {
        const u = 1 - t;
        return {
            x: u * u * u * f.startNode.x + 3 * u * u * t * f.cp1.x + 3 * u * t * t * f.cp2.x + t * t * t * f.endNode.x,
            y: u * u * u * f.startNode.y + 3 * u * u * t * f.cp1.y + 3 * u * t * t * f.cp2.y + t * t * t * f.endNode.y,
        };
    };
    const p = bez(0.1);
    g.snipsRemaining = 1;
    const ok = g.tryCut({ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }, [{ x: p.x - 20, y: p.y }, { x: p.x + 20, y: p.y }]);
    const r = g.renderer, c = g.camera;
    return { ok, perfects: g.perfectSnips, sx: (p.x + c.x - r.width / 2) * c.zoom + r.width / 2, sy: (p.y + c.y - r.height / 2) * c.zoom + r.height / 2 };
});
check(spawnTest.ok === true, "popups: near-spawn snip lands", JSON.stringify(spawnTest));
check(spawnTest.perfects === 1, "popups: near-spawn snip is PERFECT", String(spawnTest.perfects));
const overlap3 = await page.evaluate(`(() => {${MIRROR} return popupOverlap();})()`);
check(overlap3.overlapping == null, "popups: PERFECT! clears the spawn's EEK!", JSON.stringify(overlap3.overlapping) + " lanes=" + JSON.stringify(overlap3.lanes));
await page.waitForTimeout(160);
const box3 = { x: Math.max(0, spawnTest.sx - 140), y: Math.max(0, spawnTest.sy - 200), width: 280, height: 220 };
writeFileSync(path.join(ROOT, "tools/smoke/verify-popup-lanes-spawn.png"), await page.screenshot({ clip: box3 }));
console.log("  → screenshot tools/smoke/verify-popup-lanes-spawn.png");

await browser.close();
console.log(failures === 0 ? "\nVERIFY POPUP LANES PASS" : `\nVERIFY POPUP LANES FAIL — ${failures} failing check(s)`);
process.exit(failures === 0 ? 0 : 1);
