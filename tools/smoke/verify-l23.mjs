// verify-l23.mjs — play through L2 (two fuses) and L3 (speed), check tutorials.
import { chromium } from "playwright";

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

await page.goto("http://localhost:8080");
await page.waitForFunction(() => window.__CTF__?.levels?.length === 60, null, { timeout: 10000 });
await page.click("#btn-menu-play");
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 1, null, { timeout: 8000 });

const r = [];
let pass = (ok, label, extra = "") => { r.push([ok, label, extra]); return ok; };

// The tutorial freezes the simulation — dismiss it before cutting.
await page.evaluate(() => { const ov = document.getElementById("tutorial-overlay"); if (ov.style.display === "flex") document.getElementById("tutorial-next").click(); });
await page.waitForTimeout(100);

// ---- L1 win to reach L2 ----
const winL1 = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const s = g.sparks.find((x) => x.active);
    const f = g.fuses[s.fuseIndex];
    const bez = (t) => {
        const u = 1 - t;
        return {
            x: u*u*u*f.startNode.x + 3*u*u*t*f.cp1.x + 3*u*t*t*f.cp2.x + t*t*t*f.endNode.x,
            y: u*u*u*f.startNode.y + 3*u*u*t*f.cp1.y + 3*u*t*t*f.cp2.y + t*t*t*f.endNode.y,
        };
    };
    const t = Math.min(0.98, s.progress + 0.02);
    const p = bez(t);
    return g.tryCut({ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }, [{ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }]);
});
pass(typeof winL1 === "boolean" || typeof winL1 === "object", "L1 cut placed");
await page.waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 15000 });
await page.click("#btn-next");

// ---- L2 ----
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 2, null, { timeout: 10000 });
const l2boot = await page.evaluate(() => {
    const g = window.__CTF__.game;
    return {
        fuses: g.fuses.length,
        snips: g.snipsRemaining,
        tutorial: document.getElementById("tutorial-overlay").style.display,
        tutorialText: document.getElementById("tutorial-text").textContent.slice(0, 60),
        sparks: g.sparks.filter((s) => s.active).length,
        ignitedSoon: g.sparks.every((s) => s.delay === 0),
    };
});
pass(l2boot.fuses === 2, "L2 has two fuses", JSON.stringify(l2boot.fuses));
pass(l2boot.snips === 4, "L2 gives 4 snips (2 cuts + 2 slack)", String(l2boot.snips));
pass(l2boot.tutorial === "flex", "L2 shows a tutorial");
pass(l2boot.tutorialText.includes("Two fuses"), "L2 tutorial mentions two fuses", l2boot.tutorialText);
pass(l2boot.ignitedSoon, "L2 both sparks start at the same time");
await page.evaluate(() => document.getElementById("tutorial-next").click());

// Win L2: cut both fuses.
const winL2 = await page.evaluate(() => {
    const g = window.__CTF__.game;
    const snip = (s) => {
        const f = g.fuses[s.fuseIndex];
        const bez = (t) => {
            const u = 1 - t;
            return {
                x: u*u*u*f.startNode.x + 3*u*u*t*f.cp1.x + 3*u*t*t*f.cp2.x + t*t*t*f.endNode.x,
                y: u*u*u*f.startNode.y + 3*u*u*t*f.cp1.y + 3*u*t*t*f.cp2.y + t*t*t*f.endNode.y,
            };
        };
        const t = Math.min(0.98, s.progress + 0.02);
        const p = bez(t);
        return g.tryCut({ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }, [{ x: p.x - 8, y: p.y }, { x: p.x + 8, y: p.y }]);
    };
    for (const s of g.sparks.filter((x) => x.active)) snip(s);
    return true;
});
pass(winL2, "L2 both fuses cut");
const l2win = await page.waitForFunction(() => document.getElementById("modal-win").style.display === "block", null, { timeout: 20000 })
    .then(() => true).catch(() => false);
pass(l2win, "L2 cleared with both cuts");
await page.click("#btn-next").catch(() => {});

// ---- L3 ----
await page.waitForFunction(() => window.__CTF__.game.level?.level_id === 3, null, { timeout: 10000 });
const l3boot = await page.evaluate(() => {
    const g = window.__CTF__.game;
    return {
        fuses: g.fuses.length,
        snips: g.snipsRemaining,
        tutorial: document.getElementById("tutorial-overlay").style.display,
        tutorialText: document.getElementById("tutorial-text").textContent.slice(0, 60),
        speed: g.fuses[0].speed ?? g.sparks[0]?.speed,
        bulged: !!(g.fuses[0].cp1.x !== g.fuses[0].cp2.x || g.fuses[0].cp1.y !== g.fuses[0].cp2.y),
    };
});
pass(l3boot.fuses === 1, "L3 has one fuse", String(l3boot.fuses));
pass(l3boot.snips === 3, "L3 gives 3 snips", String(l3boot.snips));
pass(l3boot.tutorial === "flex", "L3 shows a tutorial");
pass(l3boot.tutorialText.toLowerCase().includes("fast"), "L3 tutorial teaches speed", l3boot.tutorialText);
pass(l3boot.bulged, "L3 wick is curved (bulged control points)");
pass(l3boot.speed > 0.0008, "L3 fuse burns faster than L1-L2", String(l3boot.speed));

console.log("\n=== verify-l23 ===");
let ok = true;
for (const [ok_, label, extra] of r) { console.log(`${ok_ ? "✓" : "✗"} ${label}${extra ? " — " + extra : ""}`); if (!ok_) ok = false; }
if (errors.length) { ok = false; console.log("errors:\n" + errors.join("\n")); }
console.log(ok ? "\nPASS" : "\nFAIL");
await browser.close();
process.exit(ok ? 0 : 1);
