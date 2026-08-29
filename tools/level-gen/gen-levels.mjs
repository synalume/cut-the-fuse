#!/usr/bin/env node
/**
 * level-gen — generates the full 120-level ladder into src/data/levels.json.
 *
 * Encodes the difficulty model from the plan:
 *  - 3 acts of 20 (1-60) plus two 30-level acts (61-90, 91-120); within each
 *    act, 5-level waves of ramp-ramp-ramp-peak-relief.
 *  - Act 1 teaches one skill at a time (CHI PLAY learning-curve finding).
 *  - Act 3 pins snips to the theoretical minimum (mastery).
 *  - Wave curve plateaus after ~55 (boss levels recombine, not climb).
 *
 * Every level also gets a deterministic VISUAL RECIPE ("look") that changes how
 * the difficulty budget is drawn — spawn distribution (clusters/voids/asymmetry),
 * radius tiers, fan width, chokepoint routing topology (nearest/braid/cross/fan),
 * delay rhythm, and burn pace — so no two levels read the same on screen while
 * the difficulty ladder stays untouched.
 *
 * Placement is deterministic (seeded PRNG per level), so regeneration is stable.
 * Run: node tools/level-gen/gen-levels.mjs
 */
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import { validateLevel } from "../../src/engine/LevelManager.js";
import { getBezierXY } from "../../src/engine/MathUtils.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = path.join(ROOT, "src", "data", "levels.json");

// Deterministic PRNG (mulberry32).
function makeRng(seed) {
    let a = seed >>> 0;
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ---- knob computation -------------------------------------------------------

/** Act boundary: 1-60 keep the three 20-level acts; 61-90 is Act 4
 *  (Budget/Reading/Restraint) and 91-120 is Act 5 (Two Bombs), each 30 levels. */
function actFor(n) {
    if (n <= 60) return Math.ceil(n / 20);
    return n <= 90 ? 4 : 5;
}

/**
 * Returns the difficulty knobs for a level index (1-based).
 * Teaching phases are explicit for Act 1; Acts 2-3 use wave math; Acts 4-5
 * use 30-level band math (one new mechanic per band, then compounding).
 * NOTE: snips is NOT set here — buildLevels derives it from the minimum
 * number of cuts the geometry requires (see slackForLevel).
 */
function knobsForLevel(n) {
    const act = actFor(n);
    const k = { spawns: 2, chokepoints: 1, share: true, delay: "burst", speed: 0.001 };

    if (act === 1) {
        const pos = (n - 1) % 20; // 0..19 within act
        const wave = Math.floor(pos / 5); // 0..3 (wave 3 = peak, relief = pos%5===4)
        const wpos = pos % 5; // 0,1,2 ramp; 3 peak; 4 relief
        const relief = wpos === 4; // relief puzzles pull back a step
        // Teaching phases, one skill at a time. Gentle pace — reading the lines
        // comes before racing them.
        if (n === 1) {
            // Swipe-to-cut. Single direct fuse, generous snips.
            Object.assign(k, { spawns: 1, chokepoints: 0, share: true, delay: "burst", speed: 0.0006 });
        } else if (n === 2) {
            // Two fuses burn at once: watch both lines and cut each before the
            // fire lands. Still slow — the lesson is split attention, not speed.
            Object.assign(k, { spawns: 2, chokepoints: 0, share: true, delay: "burst", speed: 0.0006 });
        } else if (n === 3) {
            // Speed: one wick that burns 2x the tutorial's pace, so the player
            // learns to cut on sight instead of waiting for the last moment.
            Object.assign(k, { spawns: 1, chokepoints: 0, share: true, delay: "burst", speed: 0.0012 });
        } else if (n <= 6) {
            // Staggered delays.
            Object.assign(k, {
                spawns: 2 + (n % 2), chokepoints: 1, share: true,
                delay: "stagger", speed: 0.0008,
            });
        } else if (n <= 10) {
            // Shared chokepoint (L7 teaches it); the first fork arrives at L8
            // as a clean 2-wick showcase, then density returns.
            Object.assign(k, {
                spawns: n === 8 ? 2 : 3 + (n % 2), chokepoints: 1, share: true,
                delay: "close", speed: n === 8 ? 0.0008 : 0.0009,
            });
        } else if (n <= 14) {
            // Snip economy: split across 2 chokepoints, tighter timing.
            Object.assign(k, {
                spawns: 4, chokepoints: 2, share: false,
                delay: "close", speed: 0.001,
            });
        } else {
            // Planning: partial direct fuses from L14, gentler overlap peak.
            Object.assign(k, {
                spawns: 4 + (n % 2), chokepoints: 2, share: false, partial: true,
                delay: relief ? "close" : "overlap", speed: 0.0011 + wave * 0.00005,
            });
        }
    } else if (act === 2) {
        // Planning depth. Speed is recalibrated DOWN (the color pillar means
        // players read/trace wires before sniping): act-2 peak ~0.0014
        // (~11.9s/wick of reading time, down from ~9.8s).
        Object.assign(k, { spawns: 4, chokepoints: 2, share: false, delay: "close", speed: 0.0011 });
        const pos = (n - 1) % 20;
        const wave = Math.floor(pos / 5);
        const wpos = pos % 5;
        const relief = wpos === 4;
        k.spawns = 4 + wave + (relief ? 0 : wpos >= 2 ? 1 : 0);
        k.chokepoints = 2 + (wave >= 1 ? 1 : 0) - (relief ? 1 : 0);
        k.delay = wave >= 2 ? "overlap" : "close";
        k.speed = 0.0011 + wave * 0.0001; // 0.0011–0.0014
        // Level 21-24: speed variance focus.
        if (n <= 24) { k.spawns = 4 + (n % 2); k.chokepoints = 2; k.speed = 0.0011 + (n % 3) * 0.0001; }
        // 25-28: multi-chokepoint routing + the jump to two chains.
        if (n >= 25 && n <= 28) { k.spawns = 6; k.chokepoints = 3; k.delay = "close"; }
        // 29-33: overlapping timing pressure.
        if (n >= 29 && n <= 33) { k.spawns = 6; k.chokepoints = 2; k.delay = "overlap"; }
        // 34-37: partial coverage (some fuses direct).
        if (n >= 34 && n <= 37) { k.spawns = 6 + (n % 2); k.chokepoints = 2; k.partial = true; }
        // 38-40: peak — was the fastest band in the whole game; recalibrated
        // from 0.0017 down to the new act-2 cap 0.0014.
        if (n >= 38) { k.spawns = 6; k.chokepoints = 3; k.speed = 0.0014; k.delay = "overlap"; }
    } else if (act === 3) {
        // Act 3 — mastery via COMPLEXITY, not speed. The most tangled mazes
        // (many wicks, two forks, up to ten sparks) burn the SLOWEST, and
        // sparks arrive in a long trickle (spread) instead of an overlap, so
        // the player reads the lines and plans cuts instead of reacting.
        // Recalibrated: act cap 0.0014 → 0.0013, bosses 0.0011 → 0.0010.
        Object.assign(k, { spawns: 6, chokepoints: 2, share: false, delay: "spread", speed: 0.0013 });
        const pos = (n - 1) % 20;
        const wave = Math.floor(pos / 5);
        const wpos = pos % 5;
        const relief = wpos === 4;
        if (n <= 44) {
            // Minimal nets: 6 wicks through 2 crossroads — still the most
            // efficient cuts in the act (each cut clears 3 wicks), but the
            // matchsticks scatter AROUND the bomb instead of the old single
            // shared-chokepoint spider that funneled every wick down one path.
            Object.assign(k, { spawns: 6, chokepoints: 2, share: false, delay: "spread", speed: 0.0013 });
        } else if (n <= 50) {
            // Full nets: many spawns funneled through a few chokepoints.
            Object.assign(k, {
                spawns: 6 + (n % 2), chokepoints: 3, share: false,
                delay: "spread", speed: 0.0012 + (n % 3) * 0.0001,
            });
        } else if (n <= 55) {
            // Wave peak escalation — but the maze is densest here, so the burn
            // SLOWS: 8 spawns + 2 forks ≈ 10 sparks to track.
            Object.assign(k, {
                spawns: 7 + (n % 2), chokepoints: 3, share: false,
                delay: "spread", speed: 0.0011,
            });
        } else if (n <= 58) {
            // Boss levels: every chokepoint must be cut, zero slack. Calmest
            // burn in the act — the puzzle is the placement, not the race.
            Object.assign(k, {
                spawns: 8, chokepoints: 4, share: false,
                delay: "spread", speed: 0.0010,
            });
        } else {
            // 59-60 finale + relief.
            Object.assign(k, {
                spawns: 6 - (n % 2), chokepoints: 2, share: false,
                delay: "stagger", speed: 0.0012,
            });
        }
    } else if (act === 4) {
        // Act 4 (61-90) — Budget, Reading & Restraint. One new mechanic per
        // band, then compounding. Calm burn: reading time is the challenge,
        // not reaction speed.
        Object.assign(k, { spawns: 5, chokepoints: 2, share: false, delay: "spread", speed: 0.0011 });
        if (n <= 64) {
            // 61-64 Stars (tutorial at 61): bonus-snip pickups stretch the budget.
            Object.assign(k, { spawns: 4 + (n % 2), chokepoints: 2, delay: "spread", speed: 0.0011, stars: 1 });
        } else if (n <= 68) {
            // 65-68 Water drops (tutorial at 65): doused wicks need no cut.
            Object.assign(k, { spawns: 4 + (n % 2), chokepoints: 2, delay: "spread", speed: 0.0011, douse: n === 65 ? 1 : 2 });
        } else if (n <= 72) {
            // 69-72 Color + water compound (tutorial at 69): the legend still
            // rules, but some wicks self-douse. Read before you cut.
            Object.assign(k, { spawns: 5, chokepoints: 2, delay: "close", speed: 0.0011, color: true, douse: n === 69 ? 1 : 2 });
        } else if (n <= 76) {
            // 73-76 Color compounds: forbidden wires + one other mechanic.
            Object.assign(k, {
                spawns: 5, chokepoints: 2, delay: "spread", speed: 0.0011,
                color: true, douse: n % 2 === 0 ? 1 : 0, stars: n % 2 === 1 ? 1 : 0,
            });
        } else if (n <= 84) {
            // 77-84 Compounding: stars + water + color in combos.
            Object.assign(k, {
                spawns: 5 + (n % 2), chokepoints: 3, delay: "spread", speed: 0.0011,
                color: true, stars: 1 + (n % 2 === 0 ? 1 : 0), douse: n % 3 === 2 ? 1 : 0,
            });
        } else if (n <= 88) {
            // 85-88 Escalation: two forks, colored crossroads, and a
            // star-critical budget (snips = minCuts, so the 3-star needs a star).
            Object.assign(k, {
                spawns: 6 + (n % 2), chokepoints: 3, delay: "spread", speed: 0.0010,
                color: true, stars: 3, starCritical: true, douse: n % 2 === 0 ? 1 : 0,
            });
        } else {
            // 89-90 Act bosses: zero slack, calm burn.
            Object.assign(k, {
                spawns: 7, chokepoints: 3, delay: "spread", speed: 0.0009,
                color: true, stars: 2, douse: 1, boss: true,
            });
        }
    } else {
        // Act 5 (91-120) — Two Bombs. Every level splits its fuses between two
        // payloads; each mechanic returns compounded on the twin layout.
        Object.assign(k, { spawns: 5, chokepoints: 2, share: false, delay: "close", speed: 0.0012, twin: true });
        if (n <= 94) {
            // 91-94 Twin bombs (tutorial at 91): two targets, split attention.
            Object.assign(k, { spawns: 4 + (n % 2), chokepoints: 2, delay: "close", speed: 0.0012 });
        } else if (n <= 98) {
            // 95-98 Twin + stars.
            Object.assign(k, { spawns: 5, chokepoints: 2, delay: "close", speed: 0.0011, stars: 1 });
        } else if (n <= 102) {
            // 99-102 Twin + water.
            Object.assign(k, { spawns: 5 + (n % 2), chokepoints: 3, delay: "spread", speed: 0.0011, douse: 2 });
        } else if (n <= 106) {
            // 103-106 Twin + color (per-bomb wire rules).
            Object.assign(k, { spawns: 5, chokepoints: 2, delay: "spread", speed: 0.0010, color: true });
        } else if (n <= 110) {
            // 107-110 Twin + color compounds (stars/water on the colored net).
            Object.assign(k, {
                spawns: 5 + (n % 2), chokepoints: 3, delay: "spread", speed: 0.0010,
                color: true, stars: 1 + (n % 2 === 0 ? 1 : 0), douse: n % 3 === 1 ? 1 : 0,
            });
        } else if (n <= 116) {
            // 111-116 Escalation: full nets, 3-4 chokepoints, per-bomb color rules.
            Object.assign(k, {
                spawns: 7 + (n % 2), chokepoints: 3 + (n % 2 === 0 ? 1 : 0),
                delay: "spread", speed: 0.0010, color: true, stars: 2, douse: 1 + (n % 2),
            });
        } else if (n <= 118) {
            // 117-118 Relief: a calm two-bomb breather.
            Object.assign(k, { spawns: 5, chokepoints: 2, delay: "close", speed: 0.0012, stars: 1 });
        } else {
            // 119-120 Final bosses: everything compounded, calmest burn, zero slack.
            Object.assign(k, {
                spawns: 8, chokepoints: 4, delay: "spread", speed: 0.0009,
                color: true, stars: 2, douse: 2, boss: true,
            });
        }
    }
    // Fork ignition: introduced at L8 (right after the shared-chokepoint
    // tutorial), one fork through L24, two forks from L25. Some wicks FORK —
    // the burn reaches a point on a wick and lights a NEW wick there. Cutting
    // the parent before the fork stops it and saves a snip.
    if (n >= 8 && n <= 24) k.chains = 1;
    else if (n >= 25) k.chains = 2;
    // Partial coverage (some fuses route straight, no chokepoint) — taught at
    // L14, returns with act 3's relief puzzles and act 4's odd-numbered levels.
    // Stops every board from converging through a visible middle.
    if (n >= 14 && n <= 24) k.partial = true;
    else if (n >= 34 && n <= 37) k.partial = true;
    else if (act === 3 && ((n - 1) % 20) % 5 === 4) k.partial = true;
    else if (act === 4 && n % 4 === 0) k.partial = true;
    return k;
}

/**
 * Cut slack per level — how many mistakes the player can afford.
 * Snips = minimum cuts required by the geometry + slack.
 * Every level keeps >= 1 spare snip so the 3-star goal ("finish with a snip
 * left") is always achievable; teaching levels get 2.
 * Star-critical levels (85-88) and act bosses (89-90, 119-120) run ZERO slack —
 * the only spare snip comes from banking a gold star, so grabbing one is
 * forced. Star-critical levels always carry pickups.
 */
function slackForLevel(n) {
    if (n <= 3) return 2;
    if (n >= 85 && n <= 90) return 0;
    if (n >= 119) return 0;
    return 1;
}

/**
 * Branch burn pace: the wick a fork lights is the newest threat the player
 * hasn't planned for, so later acts let it burn slower (more reaction time).
 * Combined with the curvier branch arcs (branchCurveMag), late branches read
 * as long, slow snake burns instead of short fast dashes.
 */
function branchSpeedFactor(n) {
    if (n < 25) return 1.0;
    if (n < 40) return 0.9;
    return 0.8;
}

/** Branch arc intensity ramps with the ladder: early forks are gentle
 *  Y-splits; late forks sweep into long snake bows — longer burn along the
 *  arc, and the maze reads as a tangle of curves at first glance. */
function branchCurveMag(n) {
    return n >= 25 ? Math.min(0.34, 0.16 + (n - 25) * 0.007) : 0.12;
}

// ---- color pillar + new mechanics ------------------------------------------

/**
 * Color-coded wire scheme for a level, or null when the level has no legend.
 * Lives in acts 1-3 (plus compounding in acts 4-5 via the `color` knob).
 *
 * Real-world-accurate palette: forbidden (do not cut) = red (hot/live) and
 * fuchsia in later acts; safe (cut) = blue (neutral), purple (neutral), green
 * (ground). Black/amber are excluded (burnt ash / the burning fire).
 *
 *   L9      — gentle teaser: the legend appears with one forbidden decoy,
 *             winnable without reading it (the decoy never lights).
 *   L10     — color tutorial: a forbidden fuse sits in a busy crossroad so a
 *             blind cut at the "obvious" spot hits the wrong wire (unwinnable
 *             without reading the legend).
 *   L11-17  — seasoning: forbidden decoys woven into the snip economy.
 *   L18-20  — first mixed crossroads (a safe + a forbidden wick share a cut).
 *   Act 2   — mixed crossroads common (two-fork band 25-28, overlap 29-33).
 *   Act 3   — dense mazes + bosses colored; fuchsia joins red as forbidden.
 */
function colorSchemeFor(n) {
    const act = actFor(n);
    if (act > 3 || n <= 8) return null; // pure-tutorial band untouched

    const A = { red: "no", blue: "cut", purple: "cut" };                       // 2 safe
    const B = { red: "no", blue: "cut", purple: "cut", green: "cut" };         // 3 safe
    const C = { red: "no", fuchsia: "no", blue: "cut", purple: "cut", green: "cut" }; // 2 forbidden

    if (n === 9) return { legend: A, forbidden: ["red"], safe: ["blue", "purple"], mixed: false, forbiddenCount: 1 };
    if (n === 10) return { legend: A, forbidden: ["red"], safe: ["blue", "purple"], mixed: true, forbiddenCount: 1 };

    if (act === 1) {
        const mixed = n >= 18;
        return {
            legend: A,
            forbidden: ["red"],
            safe: ["blue", "purple"],
            mixed,
            forbiddenCount: n === 20 ? 2 : 1,
        };
    }
    if (act === 2) {
        const legend = n % 2 === 0 ? B : A;
        const mixed = (n >= 25 && n <= 33) || n % 3 === 0;
        return {
            legend,
            forbidden: ["red"],
            safe: Object.keys(legend).filter((c) => legend[c] === "cut"),
            mixed,
            forbiddenCount: n >= 34 ? 2 : 1,
        };
    }
    // Act 3: dense colored mazes. Fuchsia joins red as a second forbidden color
    // from the mid-act; bosses and the finale run mixed everywhere.
    if (n >= 56) {
        return { legend: C, forbidden: ["red", "fuchsia"], safe: ["blue", "purple", "green"], mixed: true, forbiddenCount: 2 };
    }
    return {
        legend: C,
        forbidden: ["red", "fuchsia"],
        safe: ["blue", "purple", "green"],
        mixed: n % 3 === 0,
        forbiddenCount: n % 2 === 0 ? 2 : 1,
    };
}

/** A fuse is forbidden when its color maps to "no" in the level's legend. */
function isForbiddenFuse(fuse, wireRule) {
    return !!(wireRule && wireRule.legend[fuse.color] === "no");
}

/**
 * Minimum snips a level's final geometry requires — the theoretical-clear
 * budget that `snipsAllowed` is built on.
 *
 *   - A chokepoint whose routed fuses are ALL safe costs 1 cut (it severs every
 *     non-doused safe wick routed through it).
 *   - A MIXED chokepoint (a forbidden wick shares the cut) is poisoned: the cut
 *     there is always denied, so every non-doused safe fuse routed through it
 *     must be cut upstream on its own leg — 1 each.
 *   - Direct (unrouted) safe fuses cost 1 each.
 *   - Forbidden decoys and doused fuses cost 0 (they never need cutting).
 */
function computeMinCuts(level) {
    const wr = level.wireRule || null;
    const doused = new Set((level.douse || []).map((d) => d.fuse));
    const byCp = new Map();
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
        byCp.get(f.routeThrough).push(f);
    }
    let minCuts = 0;
    for (const [, grp] of byCp) {
        const hasForbidden = grp.some((f) => isForbiddenFuse(f, wr));
        const cuttable = grp.filter((f) => !isForbiddenFuse(f, wr) && !doused.has(f.id));
        if (hasForbidden) {
            for (const f of cuttable) minCuts += 1;
        } else if (cuttable.length) {
            minCuts += 1;
        }
    }
    for (const f of level.fuses) {
        if (f.routeThrough) continue;
        if (isForbiddenFuse(f, wr) || doused.has(f.id)) continue;
        minCuts += 1;
    }
    return minCuts;
}

/** Whether the level's final geometry contains a poisoned (mixed) crossroad:
 *  a chokepoint carrying both a safe and a forbidden fuse. */
function levelIsMixed(level) {
    const wr = level.wireRule;
    if (!wr) return false;
    const byCp = new Map();
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
        byCp.get(f.routeThrough).push(f);
    }
    for (const [, grp] of byCp) {
        if (grp.some((f) => isForbiddenFuse(f, wr)) && grp.some((f) => !isForbiddenFuse(f, wr))) return true;
    }
    return false;
}

/** Compact tag of the mechanics in a generated level — used to guarantee
 *  adjacent levels don't read identically. */
function mechTag(level) {
    const parts = [];
    if (level.wireRule) parts.push(levelIsMixed(level) ? "mix" : "col");
    if (Array.isArray(level.payloads) && level.payloads.length > 1) parts.push("twin");
    const pickups = level.pickups || [];
    const douse = level.douse || [];
    if (pickups.length) parts.push(`s${pickups.length}`);
    if (douse.length) parts.push(`w${douse.length}`);
    return parts.join("+") || "plain";
}

// ---- placement --------------------------------------------------------------

const PAYLOAD_ID = "bomb";

/**
 * VISUAL RECIPE ("look").
 *
 * The difficulty model fixes the BUDGET — how many spawns/chokepoints, how fast
 * sparks burn (speed cap), how tightly they're scheduled (delay span), and how
 * many cuts the player gets. The look decides HOW THAT BUDGET IS ARRANGED on
 * screen, so two levels with identical difficulty read as totally different
 * puzzles:
 *
 *   distPattern   - uniform | clustered | asym | paired | void
 *                  (spawns spread evenly, bunched into 2-3 groups, skewed to one
 *                   side, in near-twin pairs, or with a big empty gap)
 *   fanDeg        - angular width of the spawn fan (narrow chandelier to wide
 *                   horizon). Narrow for single-shared-chokepoint levels so one
 *                   cut can stay fold-free for every wick.
 *   radiusProfile - even | tiered | mixed | random  (spawn distance from center)
 *   cpDist        - chokepoint ring distance factor (tight funnel vs loose net)
 *   routePattern  - nearest | braid | cross | fan  (how much the per-sector
 *                  cross-sections bend: nearest/fan sit subtle on the spawn→
 *                  bomb line, braid/cross offset tangentially so wicks arc and
 *                  genuinely cross the middle)
 *   delayPattern  - stagger | frontload | backload | alternate | paired | rain
 *                  (which spark ignites when — the *rhythm* of the timer)
 *   speedPattern  - even | lead | tide  (burn pace: all equal, one scout that
 *                  races ahead, or an alternating fast/slow rhythm)
 */
const LOOK_DIST = ["uniform", "clustered", "asym", "paired", "void"];
const LOOK_RADIUS = ["even", "tiered", "mixed", "random"];
const LOOK_ROUTE = ["nearest", "braid", "cross", "fan"];
const LOOK_DELAY = ["stagger", "frontload", "backload", "alternate", "paired", "rain"];
const LOOK_SPEED = ["even", "lead", "tide"];

function pick(rng, arr) {
    return arr[Math.floor(rng() * arr.length)];
}

function lookForLevel(n, k, seedOffset = 0, salt = 0) {
    const rng = makeRng(9000 + n * 577 + seedOffset * 104729 + salt * 31337);
    // `teaching` locks the difficulty FEEL (delay rhythm + burn pace) simple for
    // act 1. `visualTeaching` only forces the plain sunburst for the very first
    // single-fuse levels — from L4 on the maze ARRANGEMENT (distribution,
    // radius tiers, curve shape) varies so no two levels read the same.
    const teaching = n <= 7;
    // L1-L2 stay on the plain sunburst (straight wicks, even radii). From L3 the
    // maze ARRANGEMENT varies — L3 is deliberately given an arced wick so the
    // "fast fuse" reads as a new shape, and from L4 on the full recipe varies.
    const visualTeaching = n <= 2;
    const sharedSingle = k.share && k.chokepoints === 1;
    // Narrow fan for single-shared-chokepoint levels (spawns must stay on one
    // side of the bomb for the shared cut to stay fold-free); wide otherwise.
    const fanDeg = sharedSingle
        ? Math.round(80 + rng() * 90) // 80-170°
        : Math.round(170 + rng() * 140); // 170-310°
    return {
        fanDeg,
        distPattern: visualTeaching ? "uniform" : pick(rng, LOOK_DIST),
        radiusProfile: visualTeaching ? "even" : pick(rng, LOOK_RADIUS),
        cpDist: 0.72 + rng() * 0.45,
        routePattern: k.chokepoints >= 2 && !k.share ? pick(rng, LOOK_ROUTE) : "nearest",
        delayPattern: teaching || k.delay === "burst" ? "stagger" : pick(rng, LOOK_DELAY),
        speedPattern: teaching ? "even" : pick(rng, LOOK_SPEED),
        // Curve shape: flat (classic parabola) is weighted so most arcs stay
        // subtle; arc bows every wick one way; weave alternates per wick.
        // L3 is pinned to "arc" — the speed lesson doubles as the player's
        // first curved wick, so the fast fuse never looks like L1's straight one.
        curvePattern: visualTeaching ? "flat" : n === 3 ? "arc" : pick(rng, ["flat", "flat", "arc", "weave"]),
    };
}

/** Compact fingerprint of a look, used to guarantee adjacent levels differ. */
function lookSignature(look, mech = "plain") {
    const bucket = Math.round(look.fanDeg / 40);
    return `${look.distPattern}|${look.radiusProfile}|${bucket}|${look.routePattern}|${look.delayPattern}|${look.speedPattern}|${look.curvePattern}|${mech}`;
}

/**
 * Angular positions (absolute degrees) of the spawns within the fan, per the
 * distribution pattern. Returns a sorted ascending array.
 */
function spawnAngles(count, look, rng) {
    const n = Math.max(1, count - 1);
    let u = [];
    switch (look.distPattern) {
        case "uniform":
            u = Array.from({ length: count }, (_, i) => i / n);
            break;
        case "clustered": {
            const clusters = count <= 3 ? 2 : rng() < 0.45 ? 2 : 3;
            const centers = clusters === 2 ? [0.25, 0.75] : [0.12, 0.5, 0.88];
            const sizes = [];
            let rem = count;
            for (let c = 0; c < clusters; c++) {
                const left = clusters - c;
                sizes.push(c === clusters - 1 ? rem : Math.max(1, Math.round((rem / left) * (0.55 + rng() * 0.45))));
                rem -= sizes[sizes.length - 1];
            }
            for (let c = 0; c < clusters; c++) {
                const spread = 0.1 + rng() * 0.1;
                for (let i = 0; i < sizes[c]; i++) {
                    const t = sizes[c] === 1 ? 0.5 : i / (sizes[c] - 1);
                    u.push(Math.min(1, Math.max(0, centers[c] + (t - 0.5) * spread * 2)));
                }
            }
            break;
        }
        case "asym": {
            const skew = 1.6 + rng() * 1.3;
            u = Array.from({ length: count }, (_, i) => Math.pow(i / n, skew));
            break;
        }
        case "paired": {
            const gap = 0.08 + rng() * 0.07;
            for (let i = 0; i < count; i++) {
                const base = Math.floor(i / 2) / Math.max(1, Math.ceil((count - 1) / 2));
                u.push(Math.min(1, base + (i % 2 === 0 ? 0 : gap)));
            }
            break;
        }
        case "void": {
            const vMid = 0.4 + rng() * 0.3;
            const vHalf = 0.09 + rng() * 0.12;
            u = Array.from({ length: count }, (_, i) => {
                const p = i / n;
                return p < vMid ? p : Math.min(1, p + vHalf * 2);
            });
            break;
        }
    }
    const startDeg = rng() * (360 - look.fanDeg);
    return u.map((v) => startDeg + v * look.fanDeg);
}

/** Angular position of a point around an origin, normalized to [0, 360). */
function angleOf(p, o) {
    let d = Math.atan2(p.y - o.y, p.x - o.x) * (180 / Math.PI);
    return d < 0 ? d + 360 : d;
}

/** Circular mean of angles (degrees) — wraps correctly across 0/360. */
function circularMean(degArray) {
    if (!degArray.length) return 0;
    let sx = 0, sy = 0;
    for (const d of degArray) {
        sx += Math.cos((d * Math.PI) / 180);
        sy += Math.sin((d * Math.PI) / 180);
    }
    let m = Math.atan2(sy, sx) * (180 / Math.PI);
    return m < 0 ? m + 360 : m;
}

/**
 * Full-circle spawn angles (degrees, sorted ascending). Matchsticks scatter
 * around the bomb instead of lining up in a wedge; the distribution pattern
 * only MODIFIES the scatter (clusters, gaps, pairs, bias) rather than forcing
 * a one-sided fan. Shared-single-chokepoint levels keep the one-sided wedge
 * via spawnAngles() — a single shared cut can't stay fold-free for wicks that
 * approach from all sides of the bomb.
 */
function spawnAnglesFull(count, look, rng) {
    // Equally-spaced baseline around the full circle. `n = count`, not
    // count-1: the last spawn lands just under 360°, so spawn 0 and the last
    // spawn never collide at the same angle (0° == 360° after wrapping).
    const n = Math.max(1, count);
    let u = Array.from({ length: count }, (_, i) => i / n);
    switch (look.distPattern) {
        case "clustered": {
            // Cluster centers spread around the circle (≥ ~110° apart) so the
            // level keeps full-circle coverage even when wicks are bunched.
            const clusters = count <= 3 ? 2 : rng() < 0.45 ? 2 : 3;
            const c0 = rng();
            const centers = [];
            for (let c = 0; c < clusters; c++) centers.push((c0 + (c + rng() * 0.28) / clusters) % 1);
            centers.sort((a, b) => a - b);
            const per = Math.ceil(count / clusters);
            u = [];
            for (let c = 0; c < clusters; c++) {
                const start = c * per;
                const end = Math.min(count, start + per);
                const size = end - start;
                for (let i = start; i < end; i++) {
                    const t = size === 1 ? 0.5 : (i - start) / (size - 1);
                    const halfW = 0.05 + rng() * 0.06; // cluster half-width
                    u.push(Math.min(1, Math.max(0, centers[c] + (t - 0.5) * halfW * 2)));
                }
            }
            break;
        }
        case "paired": {
            const gap = 0.035 + rng() * 0.03;
            u = [];
            if (count === 2) {
                // A single "pair" of twins degenerates into coincident angles
                // (both at 0°) — spread a 2-matchstick board to opposite sides.
                u = [0, 0.5];
                break;
            }
            for (let i = 0; i < count; i++) {
                // Pairs sit on a ladder that stays under 1.0, so the last pair
                // never wraps back onto the first.
                const base = Math.floor(i / 2) / Math.max(1, Math.ceil(count / 2));
                u.push(Math.min(1, base + (i % 2 === 0 ? 0 : gap)));
            }
            break;
        }
        case "asym": {
            // Density biased toward one arc, but the circle is still covered.
            const skew = 1.5 + rng() * 1.2;
            u = Array.from({ length: count }, (_, i) => Math.pow(i / n, skew));
            break;
        }
        case "void": {
            // One empty wedge; every spawn still lands on the remaining arc.
            const gapStart = rng() * 360;
            const gapW = 55 + rng() * 75;
            u = Array.from({ length: count }, (_, i) => {
                const p = i / n;
                return (gapStart + gapW + p * (360 - gapW)) / 360;
            });
            break;
        }
    }
    // To degrees with per-spawn jitter, wrapped + sorted.
    return u
        .map((v) => (v * 360 + rng() * 12 - 6 + 360) % 360)
        .sort((a, b) => a - b);
}

/**
 * Per-sector chokepoints: spawns are partitioned by angular rank into `m`
 * contiguous sectors; each sector gets ONE chokepoint at its centroid angle,
 * on a ring between the spawns and the bomb. Cross-sections therefore spread
 * AROUND the bomb instead of stacking on one side, and wicks enter the banana
 * from different directions. A small tangential offset bends the wick through
 * the cut so it reads as a crossing (deHairpin still resolves any folds).
 */
function chokepointsForSectors(spawns, payload, m, look, rng) {
    if (m === 0) return [];
    const byAngle = spawns
        .map((s) => ({ s, a: angleOf(s, payload) }))
        .sort((p, q) => p.a - q.a);
    const count = spawns.length;
    const out = [];
    for (let j = 0; j < m; j++) {
        const members = byAngle.filter((_, idx) => Math.min(m - 1, Math.floor((idx * m) / count)) === j);
        const meanA = circularMean(members.map((e) => e.a));
        const meanR = members.reduce((sum, e) => sum + Math.hypot(e.s.x - payload.x, e.s.y - payload.y), 0) / members.length;
        const r = Math.max(PAYLOAD_CLEARANCE + 25, meanR * (0.48 + rng() * 0.14));
        // Tangential bend: braid/cross reads as a real crossing, others subtle.
        const braid = look.routePattern === "braid" || look.routePattern === "cross";
        const tang = (braid ? 40 + rng() * 45 : 12 + rng() * 34) * (rng() < 0.5 ? -1 : 1);
        const rad = (meanA * Math.PI) / 180;
        out.push({
            id: `cut${j + 1}`,
            x: Math.round(Math.cos(rad) * r + Math.cos(rad + Math.PI / 2) * tang),
            y: Math.round(Math.sin(rad) * r + Math.sin(rad + Math.PI / 2) * tang),
        });
    }
    return out;
}

/** Per-spawn distance from center, per the radius profile. */
function spawnRadius(i, count, look, rng) {
    const base = 300 + rng() * 60;
    switch (look.radiusProfile) {
        case "even":
            return base * (0.84 + rng() * 0.18);
        case "tiered":
            return base * (i % 2 === 0 ? 0.7 : 1.0) * (0.9 + rng() * 0.14);
        case "mixed":
            return base * (i < Math.ceil(count / 2) ? 0.64 : 1.0) * (0.86 + rng() * 0.18);
        case "random":
            return base * (0.6 + rng() * 0.5);
    }
    return base;
}

/** Which spark ignites when — the RHYTHM of the timer (same total span as the
 *  difficulty budget, so difficulty holds while the feel changes). */
function delayFor(k, index, count, look, rng) {
    if (k.delay === "burst") return 0;
    const n = Math.max(1, count - 1);
    let u;
    switch (look.delayPattern) {
        case "stagger": u = index / n; break;
        case "frontload": u = Math.pow(index / n, 1.6); break; // front pair nearly together, tail strung out
        case "backload": u = Math.pow(index / n, 0.55); break; // slow trickle, then a burst at the end
        case "alternate": u = (index + (index % 2) * 0.55) / (n + 0.55); break; // fast-slow-fast-slow
        case "paired": {
            const pair = Math.floor(index / 2);
            u = (pair + (index % 2) * 0.1) / Math.max(1, Math.ceil(n / 2)); // two-at-a-time bursts
            break;
        }
        case "rain": {
            const ladder = Array.from({ length: count }, (_, i) => i / n);
            for (let i = ladder.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [ladder[i], ladder[j]] = [ladder[j], ladder[i]];
            }
            u = ladder[index];
            break;
        }
        default: u = index / n;
    }
    u = Math.min(1, Math.max(0, u));
    return Math.round(u * delaySpan(k, count, rng) + rng() * 10);
}

/** Total delay span for the level — the difficulty budget (unchanged from the
 *  original formulas, only the distribution within it now varies). */
function delaySpan(k, count, rng) {
    switch (k.delay) {
        case "stagger": return (count - 1) * (70 + rng() * 40);
        case "close": return (count - 1) * (30 + rng() * 20);
        case "overlap": return 60 + (count - 1) * 12;
        // Act-3 signature: sparks trickle in over a long window (roughly
        // count * 2s apart) so the player reads the maze and plans cuts
        // instead of reacting to a burst of near-simultaneous sparks.
        case "spread": return (count - 1) * (130 + rng() * 50);
        default: return 0;
    }
}

/** Burn pace per fuse. The FASTEST fuse never exceeds the difficulty budget
 *  (k.speed); the patterns only make the others slower for texture. */
function speedFor(k, index, look, rng) {
    const base = k.speed;
    switch (look.speedPattern) {
        case "even": return Math.round(base * (0.9 + rng() * 0.1) * 10000) / 10000;
        case "lead": return Math.round(base * (index === 0 ? 1 : 0.5 + rng() * 0.4) * 10000) / 10000;
        case "tide": return Math.round(base * (index % 2 === 0 ? 1 : 0.55 + rng() * 0.35) * 10000) / 10000;
    }
    return base;
}

/**
 * Layout archetypes. Each returns { payload, spawns, intersections } for the
 * level. The style decides the GLOBAL skeleton (where the bomb sits and how the
 * spawn band relates to it); the look fills in the per-level arrangement.
 *
 * Shared-single-chokepoint levels (one cut snips every wick) MUST keep their
 * spawns on one side of the bomb — a single cross-section can only stay
 * fold-free for wicks approaching from the same direction. Those levels use
 * the one-sided fan (hub/offset/train). Everything else scatters the
 * matchsticks AROUND the bomb and spreads the cross-sections per sector, so
 * wicks enter the banana from different sides and no wick shares another's
 * curve.
 *
 *  hub    - bomb dead-center, matchsticks scattered around it.
 *  offset - bomb pushed to one side, matchsticks scattered around it.
 *  train  - one-sided row (shared-single levels only).
 *  split  - two angular clusters flanking the bomb, cross-sections between.
 *  weave  - full-circle scatter with alternating near/far radii (layered).
 *  rings  - concentric rings: spawns alternate outer/inner radius.
 */

/** Scatter `count` matchsticks around `payload` at full-circle angles with a
 *  per-spawn radius (default: the look's radius profile). */
function scatteredSpawns(count, look, rng, payload, radiusFn) {
    const angles = spawnAnglesFull(count, look, rng);
    return angles.map((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const radius = radiusFn ? radiusFn(i, count, look, rng) : spawnRadius(i, count, look, rng);
        return {
            id: `s${i + 1}`,
            x: Math.round(payload.x + Math.cos(a) * radius),
            y: Math.round(payload.y + Math.sin(a) * radius),
        };
    });
}

/** One-sided spawn fan + chokepoints on the fan arc (shared-single levels). */
function oneSidedFan(n, k, rng, look, payload, fanMid) {
    const angles = spawnAngles(k.spawns, look, rng);
    const spawns = angles.map((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const radius = spawnRadius(i, k.spawns, look, rng);
        return { id: `s${i + 1}`, x: Math.round(payload.x + Math.cos(a) * radius), y: Math.round(payload.y + Math.sin(a) * radius) };
    });
    const intersections = chokepointsBetween(k, rng, Math.min(...angles), look.fanDeg, fanMid);
    return { spawns, intersections };
}

const PLACEMENTS = {
    hub(n, k, rng, look) {
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        if (k.share && k.chokepoints === 1) {
            const { spawns, intersections } = oneSidedFan(n, k, rng, look, payload, 200 * look.cpDist);
            return { payload, spawns, intersections };
        }
        const spawns = scatteredSpawns(k.spawns, look, rng, payload);
        return { payload, spawns, intersections: chokepointsForSectors(spawns, payload, k.chokepoints, look, rng) };
    },

    offset(n, k, rng, look) {
        const angle = rng() * Math.PI * 2;
        const dist = 90 + rng() * 60;
        const payload = { id: PAYLOAD_ID, x: Math.round(Math.cos(angle) * dist), y: Math.round(Math.sin(angle) * dist) };
        if (k.share && k.chokepoints === 1) {
            // Far-side fan: spawns sit opposite the bomb's offset.
            const centerDeg = (angle * 180) / Math.PI + 180;
            const raw = spawnAngles(k.spawns, look, rng);
            const baseStart = raw[0];
            const rot = centerDeg - look.fanDeg / 2;
            const spawns = raw.map((deg, i) => {
                const a = ((deg - baseStart + rot) * Math.PI) / 180;
                const radius = spawnRadius(i, k.spawns, look, rng);
                return { id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) };
            });
            const intersections = chokepointsBetween(k, rng, rot, look.fanDeg, 185 * look.cpDist);
            return { payload, spawns, intersections };
        }
        const spawns = scatteredSpawns(k.spawns, look, rng, payload);
        return { payload, spawns, intersections: chokepointsForSectors(spawns, payload, k.chokepoints, look, rng) };
    },

    train(n, k, rng, look) {
        // One-sided row — kept only for single-fuse practice and shared
        // chokepoints, where the wicks must approach from one side.
        const horiz = rng() < 0.5; // spawn row runs horizontally (bomb above) or vertically
        const half = (Math.max(1, k.spawns - 1) * (52 + rng() * 24)) / 2;
        const line = 190 + rng() * 45;
        const payload = {
            id: PAYLOAD_ID,
            x: Math.round(horiz ? 0 : -line),
            y: Math.round(horiz ? -line : 0),
        };
        const nSpawns = Math.max(1, k.spawns - 1);
        const spawns = [];
        for (let i = 0; i < k.spawns; i++) {
            let t = i / nSpawns - 0.5;
            // Asymmetric distribution bunches the row toward one end.
            if (look.distPattern === "asym") t = Math.pow(i / nSpawns, 1.5) - 0.5;
            const along = t * half * 2 + (rng() - 0.5) * 14;
            // Tiered radius bows the row into a smile toward the bomb; random
            // makes it a noisy street; even/mixed keep it straight.
            const jitter = look.radiusProfile === "random" ? 40 : 22;
            const bow = look.radiusProfile === "tiered" ? Math.abs(t) * (90 + rng() * 60) : 0;
            if (horiz)
                spawns.push({ id: `s${i + 1}`, x: Math.round(along), y: Math.round(line - bow + (rng() - 0.5) * jitter) });
            else
                spawns.push({ id: `s${i + 1}`, x: Math.round(line - bow + (rng() - 0.5) * jitter), y: Math.round(along) });
        }
        const intersections = [];
        for (let c = 0; c < k.chokepoints; c++) {
            const t = (c / Math.max(1, k.chokepoints) - 0.5) * 1.4;
            const along = t * half * 2;
            const h = (line / 2) * look.cpDist + (rng() - 0.5) * 16;
            if (horiz) intersections.push({ id: `cut${c + 1}`, x: Math.round(along), y: Math.round(h) });
            else intersections.push({ id: `cut${c + 1}`, x: Math.round(h), y: Math.round(along) });
        }
        return { payload, spawns, intersections };
    },

    split(n, k, rng, look) {
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const axis = rng() * Math.PI * 2;
        // Split spawns between two sides (occasionally asymmetric for look variety).
        const perSide = k.spawns <= 3 ? Math.ceil(k.spawns / 2) : Math.floor(k.spawns / 2) + (rng() < 0.35 ? 1 : 0);
        const spawns = [];
        for (let i = 0; i < k.spawns; i++) {
            const side = i < perSide ? 0 : 1;
            const idx = side === 0 ? i : i - perSide;
            const count = side === 0 ? perSide : k.spawns - perSide;
            const spreadDeg = (45 + rng() * 30) * (look.distPattern === "uniform" ? 1 : 0.7 + rng() * 0.4);
            const a = axis + side * Math.PI + (idx / Math.max(1, count - 1) - 0.5) * ((spreadDeg * Math.PI) / 180);
            const radius = spawnRadius(i, k.spawns, look, rng);
            spawns.push({ id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) });
        }
        const intersections = chokepointsForSectors(spawns, payload, k.chokepoints, look, rng);
        return { payload, spawns, intersections };
    },

    weave(n, k, rng, look) {
        // Full-circle scatter with alternating near/far radii → layered, woven
        // look; cross-sections spread per sector.
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const spawns = scatteredSpawns(k.spawns, look, rng, payload, (i, count, l, r) => {
            const base = 300 + rng() * 60;
            return (i % 2 === 0 ? 0.7 : 1.0) * base * (0.9 + rng() * 0.14);
        });
        const intersections = chokepointsForSectors(spawns, payload, k.chokepoints, look, rng);
        return { payload, spawns, intersections };
    },

    rings(n, k, rng, look) {
        // Concentric tiers: spawns alternate between an outer and inner ring,
        // cross-sections sit per sector on an intermediate ring. Reads as a
        // mini-maze — no two wicks look like they meet at the same point.
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const spawns = scatteredSpawns(k.spawns, look, rng, payload, (i, count, l, r) => (i % 2 === 0 ? 1 : 0.72) * (300 + rng() * 55));
        const intersections = chokepointsForSectors(spawns, payload, k.chokepoints, look, rng);
        return { payload, spawns, intersections };
    },
};

// Chokepoints must stay clearly OUTSIDE the payload's VISIBLE art. The banana
// png is 800x436 with visible art ~266x393 (transparent margins), drawn at
// targetHeight 150 → visible ~91x135 world px (half-width ~46, half-height ~68).
// 150px keeps a clear run of wick between the bend and the banana.
const PAYLOAD_CLEARANCE = 150;

// Chokepoints may never drift absurdly far from the payload: the fit camera
// bounds the whole level to the viewport, so an outlying chokepoint (a relaxed
// hairpin can wander to 700-1200+ px) shrinks the entire puzzle on screen —
// on mobile portrait it falls to the zoom floor and the wicks become tiny.
// Spawns sit at radius ~300-450, so anything past 480 is a drift artifact.
const MAX_CP_DISTANCE = 480;

// A fork closer than this leaves a stubby, half-hidden branch wick; the fork
// is pushed earlier along the parent until the branch has this much span.
const FORK_MIN_LENGTH = 200;

// Relaxation target (good-looking, well-balanced arcs).
const HAIRPIN_MARGIN = 0.08; // u pushed toward [margin, 1-margin]
// Actual fold threshold: u outside (0,1) reverses the spark — u in [0,1] is a
// monotonic (possibly asymmetric) arc that never doubles back.
const FOLD_THRESHOLD = 0.02;

/** Chokepoints spread between the spawn angles, at a jittered mid radius. */
function chokepointsBetween(k, rng, startDeg, arcDeg, midRadius) {
    const out = [];
    for (let c = 0; c < k.chokepoints; c++) {
        const ang = ((startDeg + (arcDeg * (c + 0.5)) / Math.max(1, k.chokepoints)) * Math.PI) / 180;
        const r = Math.max(midRadius * (0.78 + rng() * 0.44), PAYLOAD_CLEARANCE);
        out.push({ id: `cut${c + 1}`, x: Math.round(Math.cos(ang) * r), y: Math.round(Math.sin(ang) * r) });
    }
    return out;
}

/**
 * DE-HAIRPIN PASS.
 *
 * The forced-intersection fuse uses a single shared control point so the curve
 * passes exactly through the chokepoint at t=0.5. But when the chokepoint's
 * projection onto the spawn->payload chord lands OUTSIDE the segment, the cubic
 * folds back on itself: the wick visually overlaps and the spark appears to
 * turn around mid-path (it follows the parameter, which reverses in screen space
 * at the fold).
 *
 * Fold-free condition: the control point's normalized projection u on the chord
 * must stay in [0,1] (we keep a margin). For a single fuse the safe region is a
 * slab perpendicular to the chord; for a shared chokepoint we iterate a
 * projection onto every routed fuse's slab until it satisfies all of them.
 */

function projectionU(start, end, intersection) {
    const wx = end.x - start.x, wy = end.y - start.y;
    const L2 = wx * wx + wy * wy;
    const cp = {
        x: (intersection.x - 0.125 * (start.x + end.x)) / 0.75,
        y: (intersection.y - 0.125 * (start.y + end.y)) / 0.75,
    };
    return ((cp.x - start.x) * wx + (cp.y - start.y) * wy) / L2;
}

/** Reposition chokepoints so every routed fuse is fold-free and clear of the payload(s). */
function deHairpin(level) {
    const iMap = {};
    level.intersections.forEach((c) => (iMap[c.id] = c));
    const sMap = {};
    level.spawns.forEach((s) => (sMap[s.id] = s));
    const payloads = level.payloads || [level.payload];
    const pMap = {};
    payloads.forEach((p) => (pMap[p.id] = p));
    const bomb = payloads[0];
    const endOf = (f) => pMap[f.end] || payloads[0];

    const routed = {}; // chokepoint id -> [{ start, end }]
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        const start = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!start) continue;
        (routed[f.routeThrough] ??= []).push({ start, end: endOf(f) });
    }
    // Direct fuses' cut points: the midpoint of their spawn->payload segment.
    // Branch fuses have no spawn and no chokepoint (always direct) — their cut
    // points are validated after positionBranches pins the fork.
    const directMidpoints = [];
    for (const f of level.fuses) {
        if (f.routeThrough || f.branchOf) continue;
        const end = endOf(f);
        directMidpoints.push({ x: (sMap[f.start].x + end.x) / 2, y: (sMap[f.start].y + end.y) / 2 });
    }

    // Outer loop: alternate hairpin relaxation and payload clearance until both hold.
    for (let pass = 0; pass < 8; pass++) {
        // 1) Payload clearance: push chokepoints out of EVERY payload's footprint.
        let clear = true;
        for (const cid of Object.keys(routed)) {
            const I = iMap[cid];
            for (const p of payloads) {
                const dx = I.x - p.x, dy = I.y - p.y;
                const d = Math.hypot(dx, dy);
                if (d < PAYLOAD_CLEARANCE && d > 0.001) {
                    const k = PAYLOAD_CLEARANCE / d;
                    I.x = p.x + dx * k;
                    I.y = p.y + dy * k;
                    clear = false;
                }
            }
        }
        // 2) Hairpin relaxation: move each chokepoint along each routed fuse's
        //    chord so its control-point projection returns to the safe range.
        let fold = false;
        for (const cid of Object.keys(routed)) {
            const I = iMap[cid];
            for (let iter = 0; iter < 40; iter++) {
                let maxViol = 0;
                for (const { start, end } of routed[cid]) {
                    const u = projectionU(start, end, I);
                    let desired = u;
                    if (u < HAIRPIN_MARGIN) desired = HAIRPIN_MARGIN;
                    else if (u > 1 - HAIRPIN_MARGIN) desired = 1 - HAIRPIN_MARGIN;
                    if (desired === u) continue;
                    maxViol = Math.max(maxViol, Math.abs(desired - u));
                    // u = (cp - start).w / L2, cp = (8I - s - b)/6, so
                    // Δu = ((4/3)ΔI.w)/L2 -> ΔI = (3/4)·Δu·w
                    const du = desired - u;
                    I.x += 0.75 * du * (end.x - start.x);
                    I.y += 0.75 * du * (end.y - start.y);
                }
                if (maxViol < 0.001) break;
            }
            // Residual fold check for this chokepoint (only an actual fold matters).
            for (const { start, end } of routed[cid]) {
                const u = projectionU(start, end, I);
                if (u < FOLD_THRESHOLD || u > 1 - FOLD_THRESHOLD) fold = true;
            }
        }
        // 3) Direct-fuse separation: the game dedupes cuts within 30px, so a
        //    direct fuse's midpoint must stay clear of every chokepoint (and of
        //    other direct midpoints) or the player can't place both cuts.
        for (const cid of Object.keys(routed)) {
            const I = iMap[cid];
            for (const m of directMidpoints) {
                const dx = I.x - m.x, dy = I.y - m.y;
                const d = Math.hypot(dx, dy);
                if (d < CUT_SEPARATION && d > 0.001) {
                    const k = CUT_SEPARATION / d;
                    I.x = m.x + dx * k;
                    I.y = m.y + dy * k;
                }
            }
        }
        if (clear && !fold) break;
    }

    // Final safety net: any fuse still genuinely folding is too far from its
    // chokepoint's compromise position — drop its routing so it becomes a direct
    // fuse (still winnable; snips are recomputed from the final geometry after).
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        const I = iMap[f.routeThrough];
        const st = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!st) continue;
        const u = projectionU(st, endOf(f), I);
        if (u < FOLD_THRESHOLD || u > 1 - FOLD_THRESHOLD) {
            delete f.routeThrough;
        }
    }
}

/** A cut must be placeable at every chokepoint AND at every direct fuse's
 *  midpoint. The game dedupes cut placements within 30px (one suppresses the
 *  other) while a cut only covers 15px of wick — so a direct midpoint landing
 *  near a chokepoint makes the level unwinnable. Keep them 40px apart. */
const CUT_SEPARATION = 40;

/** A required cut point must stay this far from every forbidden wire's curve.
 *  Cuts within the blade radius (15) of a forbidden wire are denied, so this is
 *  the blade radius plus a safety margin. */
const FORBIDDEN_CUT_CLEARANCE = 22;
/** Pickups/drops must not sit inside another cut's reach (dedupe 30 + blade 15
 *  + a little air) — a required cut shouldn't accidentally bank a star. */
const PICKUP_CLEARANCE = 42;

function validatePlacement(level) {
    const { spawns, intersections, fuses } = level;
    const payloads = level.payloads || [level.payload];
    const pMap = {};
    payloads.forEach((p) => (pMap[p.id] = p));
    const endOf = (f) => pMap[f.end] || payloads[0];
    const wr = level.wireRule || null;
    const isForb = (f) => isForbiddenFuse(f, wr);
    const doused = new Set((level.douse || []).map((d) => d.fuse));

    const sMap = {};
    spawns.forEach((s) => (sMap[s.id] = s));
    const iMap = {};
    intersections.forEach((c) => (iMap[c.id] = c));
    const byId = new Map(fuses.map((f) => [f.id, f]));

    // No wick may fold (spark reversal). Branch wicks route through their own
    // cross-section, so their start is the fork point, not a spawn.
    for (const f of fuses) {
        if (!f.routeThrough) continue;
        const st = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!st) return { ok: false, reason: `fuse ${f.id} has no start` };
        const u = projectionU(st, endOf(f), iMap[f.routeThrough]);
        if (u < FOLD_THRESHOLD || u > 1 - FOLD_THRESHOLD) return { ok: false, reason: `fold on ${f.start || f.id}` };
    }
    // Chokepoints must sit clear of EVERY payload's visible art (twin bombs
    // each own a ring), not drift absurdly far, and not hide under a spawn.
    for (const c of intersections) {
        const near = Math.min(...payloads.map((p) => Math.hypot(c.x - p.x, c.y - p.y)));
        if (near < PAYLOAD_CLEARANCE) return { ok: false, reason: "chokepoint under payload" };
        if (near > MAX_CP_DISTANCE) return { ok: false, reason: "chokepoint too far from payload" };
        for (const s of spawns) {
            if (Math.hypot(c.x - s.x, c.y - s.y) < 60) return { ok: false, reason: "chokepoint too close to a spawn" };
        }
    }

    // Forbidden-wire clearance: sample every forbidden fuse's curve; any point
    // on a REQUIRED cut path must stay clear of it, or cutting there would be
    // denied and the level becomes unwinnable.
    const forbSamples = fuses.filter(isForb).map((f) => {
        const st = f.branchOf ? f.branchPoint : sMap[f.start];
        const end = endOf(f);
        const cpI = iMap[f.routeThrough] || { x: (st.x + end.x) / 2, y: (st.y + end.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(st, end, cpI, f.bulge || 0);
        const out = [];
        for (let u = 0; u <= 1; u += 0.02) out.push(getBezierXY(u, st, cp1, cp2, end));
        return out;
    });
    const clearOfForbidden = (x, y) => {
        for (const samples of forbSamples) {
            for (const s of samples) {
                if (Math.hypot(s.x - x, s.y - y) < FORBIDDEN_CUT_CLEARANCE) return false;
            }
        }
        return true;
    };

    // Required cut points (chokepoints, direct/branch midpoints, and the
    // upstream legs of safe fuses in poisoned crossroads), with forbidden
    // clearance and pairwise separation. Mixed-leg cuts of ONE poisoned
    // crossroad converge near the chokepoint — the player serves them with a
    // single blade (one cut severs every safe wick sharing the leg), so they
    // are exempt from the mutual separation check.
    const pts = [];
    const mixedGroups = [];
    const byCp = new Map();
    for (const f of fuses) {
        if (!f.routeThrough) continue;
        if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
        byCp.get(f.routeThrough).push(f);
    }
    // No cross-section may bunch more than 3 ROOT wicks through one cut point
    // (a 4-5 wick knot reads as a thick folded band and one snip would sever
    // everything). The exception is a single SHARED chokepoint where every wick
    // is meant to converge on one blade.
    {
        const roots = fuses.filter((f) => !f.branchOf);
        const sharedSingle = roots.length > 0 && roots.every((f) => f.routeThrough === roots[0].routeThrough);
        if (!sharedSingle) {
            for (const [cpId, grp] of byCp) {
                const nRoots = grp.filter((f) => !f.branchOf).length;
                if (nRoots > 3) return { ok: false, reason: `cross-section ${cpId} bunches ${nRoots} wicks` };
            }
        }
    }
    for (const [cpId, grp] of byCp) {
        const hasForbidden = grp.some(isForb);
        const cuttable = grp.filter((f) => !isForb(f) && !doused.has(f.id));
        if (hasForbidden) {
            // Poisoned crossroad: each safe fuse routed here must have an
            // upstream leg the player can cut without touching a forbidden wire.
            // The cut sits EARLY on the leg (u≈0.24, just past its midpoint) —
            // near the chokepoint every wick converges into the forbidden curve
            // and the cut would be denied. A converging pair of safe legs is
            // severed by ONE blade, so no separation is required between them.
            const group = [];
            for (const f of cuttable) {
                const st = sMap[f.start];
                if (!st) return { ok: false, reason: `fuse ${f.id} has no start` };
                const end = endOf(f);
                const cpI = iMap[cpId];
                const [cp1, cp2] = forcedFuseCPs(st, end, cpI, f.bulge || 0);
                for (let u = 0.16; u <= 0.32; u += 0.02) {
                    const s = getBezierXY(u, st, cp1, cp2, end);
                    if (!clearOfForbidden(s.x, s.y)) return { ok: false, reason: `mixed leg ${f.id} touches a forbidden wire` };
                }
                const leg = getBezierXY(0.24, st, cp1, cp2, end);
                group.push({ ...leg, mixedLeg: true, fuseId: f.id });
            }
            if (group.length) mixedGroups.push(group);
        } else if (cuttable.length) {
            const cp = iMap[cpId];
            if (!cp) return { ok: false, reason: `unknown chokepoint ${cpId}` };
            if (!clearOfForbidden(cp.x, cp.y)) return { ok: false, reason: `chokepoint ${cpId} touches a forbidden wire` };
            pts.push({ ...cp, fuseId: cuttable[0].id });
        }
    }
    // Direct + branch (unrouted) safe fuses.
    for (const f of fuses) {
        if (f.routeThrough || isForb(f) || doused.has(f.id)) continue;
        const st = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!st) return { ok: false, reason: `fuse ${f.id} has no start` };
        const mid = { x: (st.x + endOf(f).x) / 2, y: (st.y + endOf(f).y) / 2 };
        if (!clearOfForbidden(mid.x, mid.y)) return { ok: false, reason: `cut on ${f.id} touches a forbidden wire` };
        pts.push({ ...mid, fuseId: f.id });
    }
    // Every required cut point must be separately placeable (dedupe + blade).
    // Mixed legs are checked against everything except their own crossroad's legs.
    const allMixed = mixedGroups.flat();
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < CUT_SEPARATION) return { ok: false, reason: "cut points too close" };
        }
    }
    for (const m of allMixed) {
        for (const p of pts) {
            if (Math.hypot(m.x - p.x, m.y - p.y) < CUT_SEPARATION) return { ok: false, reason: "mixed leg too close to a cut point" };
        }
    }
    for (let gi = 0; gi < mixedGroups.length; gi++) {
        for (let gj = gi + 1; gj < mixedGroups.length; gj++) {
            for (const a of mixedGroups[gi]) {
                for (const b of mixedGroups[gj]) {
                    if (Math.hypot(a.x - b.x, a.y - b.y) < CUT_SEPARATION) return { ok: false, reason: "mixed legs of different crossroads too close" };
                }
            }
        }
    }

    // A level designed as a mixed crossroad must actually contain one — if the
    // geometry can't host a poisoned crossroad, re-seed and try again.
    if (level.mixed && !levelIsMixed(level)) return { ok: false, reason: "mixed crossroad not realized" };

    // The fork is the puzzle: a cut placed at a chokepoint — or at the parent's
    // own cut target — snuffs ANY spark within its ~15px radius, so a branch
    // wick threading within that radius would be killed by the parent's normal
    // cut and the fork would be decorative. Keep the branch's whole path clear
    // of every OTHER chokepoint and of a direct parent's cut target. (Its own
    // cross-section is the exception — the branch passes through that one.)
    for (const f of fuses) {
        if (!f.branchOf || !f.branchPoint) continue;
        const st = f.branchPoint;
        const end = endOf(f);
        const cpI = f.routeThrough ? iMap[f.routeThrough] : { x: (st.x + end.x) / 2, y: (st.y + end.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(st, end, cpI, f.bulge || 0);
        const samples = [];
        for (let u = 0; u <= 1; u += 0.04) samples.push(getBezierXY(u, st, cp1, cp2, end));
        for (const s of samples) {
            for (const c of intersections) {
                if (c.id === f.routeThrough) continue; // the branch's own cross-section
                if (Math.hypot(s.x - c.x, s.y - c.y) < BRANCH_CUT_CLEARANCE) {
                    return { ok: false, reason: `branch ${f.id} passes near chokepoint ${c.id}` };
                }
            }
        }
        const parent = byId.get(f.branchOf);
        if (parent && !parent.routeThrough) {
            const ps = sMap[parent.start];
            const parentCut = { x: (ps.x + endOf(parent).x) / 2, y: (ps.y + endOf(parent).y) / 2 };
            for (const s of samples) {
                if (Math.hypot(s.x - parentCut.x, s.y - parentCut.y) < BRANCH_CUT_CLEARANCE) {
                    return { ok: false, reason: `branch ${f.id} passes near its parent's cut` };
                }
            }
        }
    }

    // Pickups and douse drops must sit on their fuse clear of the required cut
    // points (and clear of each other) so a required cut doesn't accidentally
    // bank a star — "placement clears pickup/douse nodes from chokepoints".
    const pickupSpots = [];
    for (const p of level.pickups || []) {
        const fuse = fuses.find((f) => f.id === p.fuse);
        if (!fuse) return { ok: false, reason: `pickup ${p.id} on unknown fuse` };
        const st = fuse.branchOf ? fuse.branchPoint : sMap[fuse.start];
        const end = endOf(fuse);
        const cpI = iMap[fuse.routeThrough] || { x: (st.x + end.x) / 2, y: (st.y + end.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(st, end, cpI, fuse.bulge || 0);
        const pos = getBezierXY(p.at, st, cp1, cp2, end);
        for (const q of [...pts, ...allMixed]) {
            if (q.fuseId === fuse.id) continue; // a fuse's own cut may sit near its star
            if (Math.hypot(pos.x - q.x, pos.y - q.y) < PICKUP_CLEARANCE) return { ok: false, reason: "pickup too close to a cut point" };
        }
        for (const q of pickupSpots) {
            if (Math.hypot(pos.x - q.x, pos.y - q.y) < PICKUP_CLEARANCE) return { ok: false, reason: "pickups too close" };
        }
        pickupSpots.push(pos);
    }
    for (const d of level.douse || []) {
        const fuse = fuses.find((f) => f.id === d.fuse);
        if (!fuse) return { ok: false, reason: `douse ${d.id} on unknown fuse` };
        const st = fuse.branchOf ? fuse.branchPoint : sMap[fuse.start];
        const end = endOf(fuse);
        const cpI = iMap[fuse.routeThrough] || { x: (st.x + end.x) / 2, y: (st.y + end.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(st, end, cpI, fuse.bulge || 0);
        const pos = getBezierXY(d.at, st, cp1, cp2, end);
        for (const q of [...pts, ...allMixed]) {
            if (q.fuseId === fuse.id) continue; // a doused fuse's own cut is beside the point
            if (Math.hypot(pos.x - q.x, pos.y - q.y) < PICKUP_CLEARANCE) return { ok: false, reason: "douse too close to a cut point" };
        }
    }
    return { ok: true };
}

/** A branch wick must stay this far from any chokepoint and from its parent's
 *  cut target. Cuts snuff every spark within their ~15px radius, so this is the
 *  kill radius plus a safety margin (and it keeps the fork from colliding with
 *  the parent's own cut point when both converge near the payload). */
const BRANCH_CUT_CLEARANCE = 26;

/** Assign a layout archetype deterministically, varying it across the ladder.
 *  Single-shared-chokepoint levels need the spawns on ONE side of the bomb
 *  (hub/offset/train) — in split/weave the spawns flank the bomb, so no single
 *  point can sit fold-free between every spawn and the bomb. */
function styleForLevel(n, k) {
    if (n <= 1) return "hub"; // the swipe tutorial keeps the familiar sunburst
    const act = actFor(n);
    // Single-fuse practice (L3), two-fuse intro (L2), and single-shared-chokepoint
    // levels keep the one-sided pools (spawns must sit on one side of the bomb);
    // everything else draws from the full archetype set.
    const simple = n <= 3;
    const sharedSingle = k.share && k.chokepoints === 1;
    const pool = simple || sharedSingle
        ? ["hub", "offset", "train"]
        : act >= 2
            ? ["hub", "offset", "split", "weave", "rings"]
            : ["hub", "offset", "split"];
    const rng = makeRng(2000 + n * 911);
    let idx = Math.floor(rng() * pool.length);
    // Never repeat the previous level's style.
    const prev = styleForLevel(n - 1, k);
    if (pool[idx] === prev && pool.length > 1) idx = (idx + 1) % pool.length;
    return pool[idx];
}

/** Route a spawn through the chokepoint of its ANGLE SECTOR around the bomb.
 *  Spawns sorted by angular rank partition into contiguous sectors, so each
 *  cross-section serves at most ~ceil(spawns/chokepoints) wicks and the cut
 *  points spread around the bomb instead of piling on one side. */
function routeFor(i, spawn, k, look, intersections, spawns, payload, rng) {
    if (k.chokepoints === 0) return undefined; // direct fuse (tutorial)
    if (k.share) return "cut1";
    if (k.partial && i % 3 === 2) return undefined; // some fuses direct (partial coverage)
    const byAngle = spawns
        .map((s, idx) => ({ idx, a: angleOf(s, payload) }))
        .sort((p, q) => p.a - q.a);
    const rank = byAngle.findIndex((e) => e.idx === i);
    const m = Math.max(1, intersections.length);
    const sector = Math.min(m - 1, Math.floor((rank * m) / Math.max(1, spawns.length)));
    return intersections[sector].id;
}

/** Control points for the forced-intersection fuse (mirrors
 *  createForcedIntersectionFuse) so the generator can sample the parent's wick
 *  at the chain trigger point and anchor the branch tie-in there. */
function forcedFuseCPs(start, end, intersection, bulge = 0) {
    const mX = (intersection.x - 0.125 * (start.x + end.x)) / 0.75;
    const mY = (intersection.y - 0.125 * (start.y + end.y)) / 0.75;
    if (!bulge) return [{ x: mX, y: mY }, { x: mX, y: mY }];
    const wx = end.x - start.x, wy = end.y - start.y;
    const L = Math.hypot(wx, wy) || 1;
    const d = bulge * L;
    const perpX = -wy / L, perpY = wx / L;
    return [
        { x: mX + perpX * d, y: mY + perpY * d },
        { x: mX - perpX * d, y: mY - perpY * d },
    ];
}

/** BRANCH SHOWCASE: a forked wick is a branch fuse whose start is a point on
 *  its parent's wick (the fork). Runs AFTER de-hairpin relaxation so the fork
 *  uses the final geometry. Each branch gets its OWN cross-section (a fresh
 *  chokepoint placed just past the branch's midpoint, offset to the side away
 *  from the parent's wick) — so the branch has a real cut target that a normal
 *  parent cut can't touch, and the layout reads as a branching tree.
 *  The branch cross-sections are relaxed by a second de-hairpin pass. */
function positionBranches(level) {
    const { payload, spawns, intersections, fuses } = level;
    const payloads = level.payloads || [payload];
    const pMap = {};
    payloads.forEach((p) => (pMap[p.id] = p));
    const endOf = (f) => pMap[f.end] || payloads[0];
    const sMap = {};
    spawns.forEach((s) => (sMap[s.id] = s));
    const iMap = {};
    intersections.forEach((c) => (iMap[c.id] = c));
    const byId = new Map(fuses.map((f) => [f.id, f]));
    const toRemove = [];
    const curveMag = branchCurveMag(level.n ?? 0);
    let branchIdx = 0;
    for (const f of fuses) {
        if (!f.branchOf) continue;
        const parent = byId.get(f.branchOf);
        if (!parent) continue;
        const pEnd = endOf(parent);
        const ps = sMap[parent.start];
        const pCp = iMap[parent.routeThrough] || { x: (ps.x + pEnd.x) / 2, y: (ps.y + pEnd.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(ps, pEnd, pCp, parent.bulge || 0);

        // A fork too close to the payload leaves a stubby, half-hidden branch
        // wick. Push the fork earlier along the parent until the branch has a
        // real span (the parent's cut is still at t=0.5, so the fork always
        // fires before a normal cut can stop it). If even the earliest `at`
        // can't clear the bomb art, the parent's wick never leaves the bomb's
        // footprint — drop the branch rather than emit a hidden stub.
        let at = f.at;
        let P = getBezierXY(at, ps, cp1, cp2, pEnd);
        let L = Math.hypot(pEnd.x - P.x, pEnd.y - P.y);
        for (let guard = 0; guard < 8 && L < FORK_MIN_LENGTH; guard++) {
            at = Math.max(0.14, at - 0.025);
            P = getBezierXY(at, ps, cp1, cp2, pEnd);
            L = Math.hypot(pEnd.x - P.x, pEnd.y - P.y);
        }
        if (L < 160) {
            toRemove.push(f);
            continue;
        }
        f.at = Math.round(at * 1000) / 1000;
        f.branchPoint = { x: Math.round(P.x), y: Math.round(P.y) };

        // Long wicks get the branch a real cross-section: ~55% along the
        // fork->payload chord, offset to the side away from the parent's
        // mid-curve (flipped if that side crowds another cut point), then
        // pushed out of the payload clearance ring. Short-wick forks can't
        // host a chokepoint inside the clearance ring — those stay direct
        // (their midpoint is the cut target) with a bulge so the fork still
        // reads as a Y.
        const wx = pEnd.x - P.x, wy = pEnd.y - P.y;
        const perpX = -wy / L, perpY = wx / L;
        const parentMid = getBezierXY(0.5, ps, cp1, cp2, pEnd);
        let side = perpX * (parentMid.x - P.x) + perpY * (parentMid.y - P.y) > 0 ? -1 : 1;
        if (L < 185) {
            delete f.routeThrough;
            f.bulge = Math.round(side * curveMag * 1000) / 1000;
            continue;
        }
        const MIN_R = PAYLOAD_CLEARANCE + 14;
        let placed = false;
        for (let guard = 0; guard < 4 && !placed; guard++) {
            const oc = 0.16 + guard * 0.05; // widen the offset if the first side is crowded
            let cx = P.x + wx * 0.55 + perpX * side * L * oc;
            let cy = P.y + wy * 0.55 + perpY * side * L * oc;
            // Single-payload levels keep the pre-twin clamp (radial push from the
            // origin) so the 1-60 geometry stays byte-identical to the shipped
            // ladder; twin levels clamp against each bomb's own ring.
            const r = level.payloads ? Math.hypot(cx - pEnd.x, cy - pEnd.y) : Math.hypot(cx, cy);
            if (r < MIN_R && r > 0.001) {
                const k = MIN_R / r;
                if (level.payloads) {
                    cx = pEnd.x + (cx - pEnd.x) * k;
                    cy = pEnd.y + (cy - pEnd.y) * k;
                } else {
                    cx *= k;
                    cy *= k;
                }
            }
            const crowded = intersections.some((q) => Math.hypot(q.x - cx, q.y - cy) < 52);
            if (crowded) {
                side = -side;
                continue;
            }
            const cid = `b${branchIdx++}`;
            intersections.push({ id: cid, x: Math.round(cx), y: Math.round(cy) });
            f.routeThrough = cid;
            // Routed branches also bow (softer than direct ones — they already
            // bend through their own cross-section). Still passes exactly
            // through the chokepoint at t=0.5.
            f.bulge = Math.round(side * curveMag * 0.55 * 1000) / 1000;
            placed = true;
        }
        if (!placed) {
            delete f.routeThrough;
            f.bulge = Math.round(side * curveMag * 1000) / 1000;
        }
    }
    if (toRemove.length) {
        for (const f of toRemove) {
            const i = level.fuses.indexOf(f);
            if (i >= 0) level.fuses.splice(i, 1);
        }
    }
}

/** Safety net: after the branch cross-sections are relaxed against the final
 *  fork geometry, a routed branch whose cross-section ended up too close to
 *  the bomb or to another cut point is downgraded to a direct wick — same
 *  fork, still a Y. Keeps dense levels from inheriting chokepoints that
 *  validatePlacement would reject. */
function settleBranches(level) {
    const { payload, spawns, intersections, fuses } = level;
    const payloads = level.payloads || [payload];
    const pMap = {};
    payloads.forEach((p) => (pMap[p.id] = p));
    const endOf = (f) => pMap[f.end] || payloads[0];
    const sMap = {};
    spawns.forEach((s) => (sMap[s.id] = s));
    const iMap = {};
    intersections.forEach((c) => (iMap[c.id] = c));
    const byId = new Map(fuses.map((f) => [f.id, f]));
    const curveMag = branchCurveMag(level.n ?? 0);
    const drop = new Set();

    for (const f of fuses) {
        if (!f.branchOf || !f.routeThrough) continue;
        const cp = iMap[f.routeThrough];
        if (!cp) continue;
        const pEnd = endOf(f);
        const r = Math.hypot(cp.x - pEnd.x, cp.y - pEnd.y);
        const near = intersections.some((q) => q.id !== f.routeThrough && Math.hypot(q.x - cp.x, q.y - cp.y) < 48);
        if (r < PAYLOAD_CLEARANCE + 6 || near) drop.add(f.routeThrough);
    }
    if (!drop.size) return;

    for (const f of fuses) {
        if (!f.branchOf || !f.routeThrough || !drop.has(f.routeThrough)) continue;
        const parent = byId.get(f.branchOf);
        delete f.routeThrough;
        let side = 1;
        if (parent) {
            const ps = sMap[parent.start];
            if (ps) {
                const pEnd = endOf(parent);
                const pCp = iMap[parent.routeThrough] || { x: (ps.x + pEnd.x) / 2, y: (ps.y + pEnd.y) / 2 };
                const [cp1, cp2] = forcedFuseCPs(ps, pEnd, pCp, parent.bulge || 0);
                const P = f.branchPoint || getBezierXY(f.at, ps, cp1, cp2, pEnd);
                const wx = pEnd.x - P.x, wy = pEnd.y - P.y;
                const L = Math.hypot(wx, wy) || 1;
                const perpX = -wy / L, perpY = wx / L;
                const parentMid = getBezierXY(0.5, ps, cp1, cp2, pEnd);
                side = perpX * (parentMid.x - P.x) + perpY * (parentMid.y - P.y) > 0 ? -1 : 1;
            }
        }
        f.bulge = Math.round(side * curveMag * 1000) / 1000;
    }
    level.intersections = intersections.filter((c) => !drop.has(c.id));
}

/** Twin-bomb layout: two payloads opposite each other on a random axis; the
 *  spawns scatter full-circle around the center and each routes to the nearer
 *  bomb, with per-bomb sector chokepoints (each cross-section sits on its own
 *  bomb's ring, so wicks enter each banana from different sides). */
function twinLayout(n, k, rng, look) {
    const axis = rng() * Math.PI * 2;
    const spread = 150 + rng() * 40;
    const d = { x: Math.round(Math.cos(axis) * spread), y: Math.round(Math.sin(axis) * spread) };
    const payload1 = { id: "bomb1", x: d.x, y: d.y };
    const payload2 = { id: "bomb2", x: -d.x, y: -d.y };
    const payloads = [payload1, payload2];

    const count = Math.max(2, k.spawns);
    const angles = spawnAnglesFull(count, look, rng);
    const spawns = angles.map((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const radius = 350 + rng() * 140;
        return { id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) };
    });

    // Each spawn feeds the nearer bomb.
    const assign = spawns.map((s) => {
        const d1 = Math.hypot(s.x - payload1.x, s.y - payload1.y);
        const d2 = Math.hypot(s.x - payload2.x, s.y - payload2.y);
        return d1 <= d2 ? "bomb1" : "bomb2";
    });

    // Per-bomb sector chokepoints (ids prefixed so the two bombs never collide).
    const intersections = [];
    const perBombCps = { bomb1: [], bomb2: [] };
    const totalCps = k.chokepoints;
    for (const [bi, p] of payloads.entries()) {
        const members = spawns.filter((_, i) => assign[i] === p.id);
        if (!members.length) continue;
        const want = bi === 0 ? Math.ceil(totalCps / 2) : Math.floor(totalCps / 2);
        const m = Math.max(1, Math.min(members.length, want));
        const cps = chokepointsForSectors(members, p, m, look, rng).map((c) => ({ ...c, id: `${p.id}_${c.id}` }));
        perBombCps[p.id] = cps;
        intersections.push(...cps);
    }
    return { payload: payload1, payloads, spawns, intersections, assign, perBombCps };
}

/**
 * Paint the level's mechanics onto its base fuses (runs inside placeLevel,
 * after routing but before branch fuses are added):
 *   - color-coded wires (wireRule + per-fuse color; forbidden fuses are decoys
 *     that never light) + the color tax (readFactor) on burn speed
 *   - mixed crossroads: a forbidden decoy shares a busy chokepoint with safe
 *     wicks, so the "efficient" cut there is denied and the player must trace
 *   - water-drop douse, gold-star pickups
 * Branch fuses later inherit their parent's color/end.
 */
function applyMechanics(level, k, rng, shift = 0) {
    const n = level.n;
    // `k._scheme` lets the pinned 1-60 path retry color layouts against the
    // frozen geometry (e.g. relax a mixed crossroad that can't host a decoy).
    const scheme = k._scheme || colorSchemeFor(n);
    let wire = null;
    if (scheme) {
        wire = { legend: scheme.legend, forbidden: scheme.forbidden, safe: scheme.safe, mixed: scheme.mixed, forbiddenCount: scheme.forbiddenCount };
    } else if (k.color) {
        // Act 4-5 color compounding.
        const legend = { red: "no", blue: "cut", purple: "cut", green: "cut" };
        wire = {
            legend,
            forbidden: ["red"],
            safe: ["blue", "purple", "green"],
            mixed: n % 2 === 0,
            forbiddenCount: 1 + (n % 2),
        };
    }

    if (wire) {
        level.wireRule = { legend: wire.legend };
        level.mixed = wire.mixed;
        // Color tax: players read/trace colors before sniping, so color levels
        // burn slower (×0.85), mixed crossroads slower still (×0.75).
        const factor = wire.mixed ? 0.75 : 0.85;
        for (const f of level.fuses) {
            if (f.branchOf) continue; // branch speeds inherit from scaled parents
            f.speed = Math.round(f.speed * factor * 100000) / 100000;
        }

        // Select which base fuses are forbidden.
        const baseFuses = level.fuses.filter((f) => !f.branchOf);
        const sMap = new Map(level.spawns.map((s) => [s.id, s]));
        const iMap = new Map(level.intersections.map((c) => [c.id, c]));
        const byCp = new Map();
        for (const f of baseFuses) {
            if (!f.routeThrough) continue;
            if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
            byCp.get(f.routeThrough).push(f);
        }
        const groups = [...byCp.values()].sort((a, b) => a.length - b.length);
        const direct = baseFuses.filter((f) => !f.routeThrough);

        // A forbidden decoy never lights, so it can never be a fork parent — a
        // fork only fires when its parent's spark crosses it. Exclude the
        // earliest-burning fuses (the ones the chain code picks as parents)
        // from decoy candidacy; otherwise the fork re-attaches to a different
        // wick and the layout drifts from the pinned 1-60 geometry.
        const nChains = Math.min(k.chains || 0, Math.max(0, Math.floor(k.spawns / 2)));
        const forkParents = new Set();
        if (nChains > 0) {
            const byDelay = baseFuses
                .map((f, i) => ({ f, i }))
                .sort((a, b) => a.f.delayFrames - b.f.delayFrames || a.i - b.i)
                .slice(0, nChains);
            for (const { f } of byDelay) forkParents.add(f);
        }

        // A forbidden decoy must sit CLEAR of the wicks it shares a crossroad
        // with: the other members' upstream legs (their cut targets once the
        // crossroad is poisoned) are only cuttable if the forbidden curve stays
        // far from them. Prefer the member whose spawn is most angularly
        // isolated from the group's other spawns around the shared chokepoint —
        // the fan extreme — so the safe wicks fan away from the forbidden one.
        // `shift` (pinned path) rotates the preference order so the overlay can
        // walk candidate victims until the frozen geometry validates.
        const rankByIsolation = (group) => {
            const cp = iMap.get(group[0].routeThrough);
            const ref = cp || level.payload || (level.payloads && level.payloads[0]);
            const angleOfSpawn = (f) => {
                const s = sMap.get(f.start);
                return s && ref ? angleOf(s, ref) : 0;
            };
            const scored = group.map((cand) => {
                const a = angleOfSpawn(cand);
                let minSep = Infinity;
                for (const other of group) {
                    if (other === cand) continue;
                    let d = Math.abs(a - angleOfSpawn(other));
                    d = Math.min(d, 360 - d);
                    if (d < minSep) minSep = d;
                }
                return { cand, minSep: minSep === Infinity ? -1 : minSep };
            });
            return scored.sort((a, b) => b.minSep - a.minSep).map((s) => s.cand);
        };
        const pickVictim = (group) => {
            const candidates = group.filter((f) => !forkParents.has(f));
            if (!candidates.length) return group[0];
            return rankByIsolation(candidates)[shift % candidates.length];
        };
        const rotate = (arr) => (arr.length ? arr.slice(shift % arr.length).concat(arr.slice(0, shift % arr.length)) : arr);

        const forbiddenSet = new Set();
        let remaining = wire.forbiddenCount;
        if (wire.mixed) {
            // Poison the BUSIEST crossroad first: forbid one of its members so a
            // safe + forbidden wick share the cut (the tracing lesson). The
            // victim is the most isolated member, so the survivors' upstream
            // legs stay clear of the forbidden curve. The remaining forbidden
            // fuses go to OTHER crossroads (forbidden-only traps) — never back
            // into the poisoned one, or it stops being mixed.
            const byCpRanked = rotate([...byCp.values()].sort((a, b) => b.length - a.length));
            let busiest = null;
            for (const g of byCpRanked) {
                if (g.length >= 2 && g.some((f) => !forkParents.has(f))) { busiest = g; break; }
            }
            let poisonedCp = null;
            if (busiest) {
                const victim = pickVictim(busiest);
                forbiddenSet.add(victim);
                poisonedCp = victim.routeThrough;
                remaining--;
            }
            for (const g of rotate(groups)) {
                if (remaining <= 0) break;
                if (g[0] && g[0].routeThrough === poisonedCp) continue; // keep the mixed crossroad mixed
                for (const f of g) {
                    if (remaining <= 0) break;
                    if (forbiddenSet.has(f) || forkParents.has(f)) continue;
                    forbiddenSet.add(f);
                    remaining--;
                }
            }
            for (const f of rotate(direct)) {
                if (remaining <= 0) break;
                if (forkParents.has(f)) continue;
                forbiddenSet.add(f);
                remaining--;
            }
        } else {
            // Seasoning: prefer DIRECT fuses as decoys (they never poison a
            // crossroad — "don't waste a snip on a wire you're not supposed to
            // touch"). Then whole smallest crossroads (forbidden-only traps). A
            // forbidden fuse only poisons a crossroad when the count forces it,
            // and then it's the most isolated member.
            for (const f of rotate(direct)) {
                if (remaining <= 0) break;
                if (forkParents.has(f)) continue;
                forbiddenSet.add(f);
                remaining--;
            }
            for (const g of rotate(groups)) {
                if (remaining <= 0) break;
                if (g.length <= remaining) {
                    // Whole group → forbidden-only trap.
                    for (const f of g) {
                        if (remaining <= 0) break;
                        if (forkParents.has(f)) continue;
                        forbiddenSet.add(f);
                        remaining--;
                    }
                } else if (g.length > 1) {
                    // Partial → poison the crossroad with the isolated member.
                    if (g.some((f) => !forkParents.has(f))) {
                        forbiddenSet.add(pickVictim(g));
                        remaining--;
                    }
                } else {
                    if (!forkParents.has(g[0])) {
                        forbiddenSet.add(g[0]);
                        remaining--;
                    }
                }
            }
        }
        // Safety: if somehow still short, forbid whatever is left (the level
        // stays winnable — forbidden decoys never light and never need a cut).
        for (const f of baseFuses) {
            if (remaining <= 0) break;
            if (forbiddenSet.has(f)) continue;
            forbiddenSet.add(f);
            remaining--;
        }

        let fi = 0;
        for (const f of baseFuses) {
            if (forbiddenSet.has(f)) {
                f.color = wire.forbidden[fi % wire.forbidden.length];
                f.neverLights = true;
            } else {
                f.color = wire.safe[fi % wire.safe.length];
            }
            fi++;
        }
    }

    // Water drops: a doused fuse's spark self-extinguishes before the bomb —
    // that wick costs 0 in the snip budget. Drops sit after the chokepoint so
    // the wick reads as "burning to the drop", not "dead before the crossing".
    const douseCount = k.douse || 0;
    if (douseCount > 0) {
        const candidates = level.fuses.filter(
            (f) => !f.branchOf && !isForbiddenFuse(f, level.wireRule)
        );
        for (let i = candidates.length - 1; i > 0; i--) {
            const j = Math.floor(rng() * (i + 1));
            [candidates[i], candidates[j]] = [candidates[j], candidates[i]];
        }
        level.douse = [];
        for (let i = 0; i < Math.min(douseCount, candidates.length); i++) {
            level.douse.push({
                id: `w${i}`,
                fuse: candidates[i].id,
                at: Math.round((0.56 + rng() * 0.2) * 1000) / 1000,
            });
        }
    }

    // Gold pickups (bonus snips): stars ride on safe fuses the player cuts
    // anyway. Star-critical levels put them on DIRECT fuses so the star is
    // collectible within the zero-slack budget (the fuse's own cut can double
    // as the star grab).
    const starCount = k.stars || 0;
    if (starCount > 0) {
        const notDoused = (f) => !(level.douse || []).some((d) => d.fuse === f.id);
        const eligible = (f) => !f.branchOf && !isForbiddenFuse(f, level.wireRule) && notDoused(f);
        const directFuses = level.fuses.filter((f) => eligible(f) && !f.routeThrough);
        const routedFuses = level.fuses.filter((f) => eligible(f) && f.routeThrough);
        for (const arr of [directFuses, routedFuses]) {
            for (let i = arr.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [arr[i], arr[j]] = [arr[j], arr[i]];
            }
        }
        level.pickups = [];
        let placed = 0;
        const placeStar = (fuse) => {
            level.pickups.push({
                id: `star${placed}`,
                fuse: fuse.id,
                at: Math.round((0.16 + rng() * 0.26) * 1000) / 1000,
            });
            placed++;
        };
        while (placed < starCount && directFuses.length) placeStar(directFuses.pop());
        while (placed < starCount && routedFuses.length) placeStar(routedFuses.pop());
        if (placed < starCount) {
            const any = level.fuses.filter((f) => !f.branchOf && !isForbiddenFuse(f, level.wireRule) && notDoused(f));
            for (let i = any.length - 1; i > 0; i--) {
                const j = Math.floor(rng() * (i + 1));
                [any[i], any[j]] = [any[j], any[i]];
            }
            while (placed < starCount && any.length) placeStar(any.pop());
        }
    }
    return { wireRule: level.wireRule, douse: level.douse, pickups: level.pickups, mixed: level.mixed };
}

function placeLevel(n, k, seedOffset = 0, salt = 0, opts = {}) {
    const rng = makeRng(1000 + n * 137 + seedOffset * 7919);
    const look = lookForLevel(n, k, seedOffset, salt);
    const style = styleForLevel(n, k);
    const layout = k.twin ? twinLayout(n, k, rng, look) : PLACEMENTS[style](n, k, rng, look);
    const { payload, spawns, intersections } = layout;
    const payloads = layout.payloads || null;
    const assign = layout.assign || null;
    const perBombCps = layout.perBombCps || null;
    const bombById = payloads ? { bomb1: payloads[0], bomb2: payloads[1] } : {};

    // Per-spawn local index within its bomb's side (twin routing).
    const localIdx = new Map();
    const sideSpawns = {};
    if (assign) {
        const counts = { bomb1: 0, bomb2: 0 };
        for (let i = 0; i < spawns.length; i++) {
            const side = assign[i];
            localIdx.set(i, counts[side]++);
        }
        for (const side of ["bomb1", "bomb2"]) {
            sideSpawns[side] = spawns.filter((_, i) => assign[i] === side);
        }
    }

    // Fuses: route spawns through chokepoints (shared vs sector vs partial).
    const fuses = spawns.map((s, i) => {
        const endId = assign ? assign[i] : PAYLOAD_ID;
        const routeThrough = assign
            ? routeFor(localIdx.get(i), s, k, look, perBombCps[endId], sideSpawns[endId], bombById[endId], rng)
            : routeFor(i, s, k, look, intersections, spawns, payload, rng);
        const f = {
            id: `f${i}`,
            start: s.id,
            ...(routeThrough ? { routeThrough } : {}),
            end: endId,
            speed: speedFor(k, i, look, rng),
            delayFrames: delayFor(k, i, k.spawns, look, rng),
        };
        // Curve shape variety: split control points bow the arc without moving
        // the chokepoint pass-through (see createForcedIntersectionFuse). The
        // bulge offsets the two control points symmetrically, so it keeps the
        // chokepoint exactly at t=0.5 while bending the final leg to a gentle
        // curve. The magnitudes stay small (max ±0.1): the wick must still read
        // as one continuous line to the payload endpoint, so the tail near the
        // bomb stays tight — big bows made the last legs swirl and drift off
        // past the banana.
        const curve = look.curvePattern || "flat";
        // L3's speed lesson doubles as the player's first curved wick — pin a
        // pronounced bow so the fast fuse never reads as L1's straight one.
        f.bulge = n === 3
            ? Math.round((0.15 + rng() * 0.02) * 1000) / 1000
            : curve === "flat" ? 0 : curve === "arc" ? Math.round((0.06 + rng() * 0.05) * 1000) / 1000 : i % 2 === 0 ? 0.1 : -0.1;
        return f;
    });

    // Tail separation for shared chokepoints: wicks routed through the SAME
    // crossroad share a control point, so their final legs (chokepoint →
    // payload) are IDENTICAL overlapping curves — the "bunch" that vanishes
    // under the banana as one thick line and reads as disconnected. Give each
    // wick in a group a DISTINCT bulge, ramped across ±mag, so the tails fan
    // apart through their run and only converge right at the bomb. Magnitude
    // is capped by the chokepoint->bomb chord so the mid-leg bow stays within
    // ~35px — visible separation, never an off-screen swirl.
    {
        const grouped = new Map();
        for (const f of fuses) {
            if (!f.routeThrough) continue;
            if (!grouped.has(f.routeThrough)) grouped.set(f.routeThrough, []);
            grouped.get(f.routeThrough).push(f);
        }
        for (const [cpId, grp] of grouped) {
            if (grp.length < 2) continue;
            const ref = payloads ? payloads.find((p) => p.id === grp[0].end) : payload;
            grp.sort((a, b) => {
                const s1 = spawns.find((s) => s.id === a.start);
                const s2 = spawns.find((s) => s.id === b.start);
                const a1 = Math.atan2((s1 ? s1.y : ref.y) - ref.y, (s1 ? s1.x : ref.x) - ref.x);
                const a2 = Math.atan2((s2 ? s2.y : ref.y) - ref.y, (s2 ? s2.x : ref.x) - ref.x);
                return a1 - a2;
            });
            const nGrp = grp.length;
            const cp = intersections.find((c) => c.id === cpId);
            const L = cp ? Math.hypot(cp.x - ref.x, cp.y - ref.y) : 300;
            const maxBulge = Math.min(0.3, 35 / (0.289 * Math.max(60, L)));
            const mag = Math.min(maxBulge, 0.05 + nGrp * 0.045);
            grp.forEach((f, i) => {
                const v = nGrp === 1 ? 0 : -mag + (2 * mag * i) / (nGrp - 1);
                f.bulge = Math.round(Math.max(-0.3, Math.min(0.3, v)) * 1000) / 1000;
            });
        }
    }

    // Direct fuses: give each a small UNIQUE bow too, so no two wicks — even
    // wicks that never share a crossroad — follow the same curve shape.
    for (const f of fuses) {
        if (f.routeThrough) continue;
        const base = f.bulge ?? 0;
        f.bulge = Math.round(Math.max(-0.16, Math.min(0.16, base + (rng() - 0.5) * 0.14)) * 1000) / 1000;
    }

    // Every level ignites its FIRST spark immediately on load — the burn
    // starts and the player reacts. The "rain" rhythm shuffles the arrival
    // ladder per fuse, so by luck it can push EVERY timer up (e.g. L48/L51
    // waited ~7s before anything lit). Renormalize so the earliest timed fuse
    // starts now, preserving the relative trickle of the rest.
    {
        const timed = fuses.filter((f) => f.delayFrames < 99999);
        const min = timed.length ? Math.min(...timed.map((f) => f.delayFrames)) : 0;
        if (min > 15) {
            for (const f of timed) f.delayFrames -= min;
        }
    }

    // Color pillar + mechanics (wire colors, douse, pickups, color tax).
    // Runs before chains so branch fuses can inherit parent color/end below.
    // `opts.mechanics === false` (pinned 1-60 path) defers the color overlay so
    // the frozen geometry can be matched first and colors retried against it.
    const mechLevel = opts.mechanics === false ? {} : applyMechanics({ n, payload, payloads, spawns, intersections, fuses }, k, rng);

    // Fork ignition: attach branch fuses to the earliest-burning wicks. A
    // branch wick starts AT a fork point on its parent's wick and stays DARK
    // until the parent's spark crosses the fork (`at`), then a new spark races
    // down it — so the layout reads as a branching tree.
    //
    // `at` sits BEFORE the parent's cut target (chokepoint or direct midpoint,
    // both at t=0.5), so the branch lights BEFORE a normal cut on the parent
    // can stop it — the fork actually fires and the branch is a real second
    // threat that needs its own cut. To PREVENT the branch the player must cut
    // the parent EARLY (before the fork), which saves that snip. (Forks
    // downstream of the cut made every chain trivially breakable by the normal
    // chokepoint cut — the branch never ignited and sections of a level became
    // pointless, which read as an "early win".)
    const nChains = Math.min(k.chains || 0, Math.max(0, Math.floor(k.spawns / 2)));
    if (nChains > 0) {
        const ordered = fuses
            .map((f, i) => ({ f, i }))
            .filter(({ f }) => !f.neverLights) // decoys never burn — no forks
            .sort((a, b) => a.f.delayFrames - b.f.delayFrames || a.i - b.i);
        for (let c = 0; c < nChains; c++) {
            const parent = ordered[c];
            const at = Math.round((0.26 + rng() * 0.12) * 1000) / 1000; // 0.26–0.38, before t=0.5
            fuses.push({
                id: `f${fuses.length}`,
                branchOf: parent.f.id,
                at,
                end: parent.f.end,
                color: parent.f.color,
                speed: Math.round(Math.max(0.0007, Math.min(0.0045, parent.f.speed * (branchSpeedFactor(n) + rng() * 0.12))) * 10000) / 10000,
                delayFrames: 99999, // no timer — lit when the parent's burn reaches `at`
            });
        }
    }

    if (process.env.GEN_DELAY_DEBUG && (n === 48 || n === 51 || n === 55 || n === 45)) {
        console.log(`[delaydebug] L${n} delayPattern=${look.delayPattern} k.delay=${k.delay} spawns=${k.spawns} chainDelaySpan=${delaySpan(k, k.spawns, rng)}`);
        for (const f of fuses) console.log(`[delaydebug]   ${f.id} delay=${f.delayFrames}${f.branchOf ? " branchOf=" + f.branchOf : ""}`);
    }
    if (process.env.GEN_DELAY_DEBUG && (n === 48 || n === 51 || n === 55 || n === 45)) {
        console.log(`[delaydebug] L${n} delayPattern=${look.delayPattern} k.delay=${k.delay} spawns=${k.spawns} chainDelaySpan=${delaySpan(k, k.spawns, rng)}`);
        for (const f of fuses) console.log(`[delaydebug]   ${f.id} delay=${f.delayFrames}${f.branchOf ? " branchOf=" + f.branchOf : ""}`);
    }
    return { n, payload, payloads, spawns, intersections, fuses, k, style, look, ...mechLevel };
}

/** PAR time: the clear time if every fuse is cut at its ideal point (its
 *  chokepoint or direct-fuse midpoint, both at t=0.5) the moment the level
 *  starts. Sparks routed through a shared chokepoint die when they reach the
 *  gap, so the level clears when the LAST spark crosses its cut. Beating par
 *  means cutting sparks close-in (fast play), which spends extra snips — the
 *  speed-vs-economy trade-off that keeps both strategies meaningful.
 *  Branch sparks have no timer: they light when their parent crosses the fork,
 *  then burn to their own cut. Forbidden decoys never burn; doused sparks die
 *  at the drop. */
function parSeconds(fuses, douse = []) {
    let par = 0;
    const byId = new Map(fuses.map((f) => [f.id, f]));
    const douseAt = new Map(douse.map((d) => [d.fuse, d.at]));
    for (const f of fuses) {
        if (f.neverLights) continue;
        let ign = f.delayFrames >= 99999 ? 0 : f.delayFrames;
        if (f.branchOf) {
            const parent = byId.get(f.branchOf);
            if (parent) {
                const pDelay = parent.delayFrames >= 99999 ? 0 : parent.delayFrames;
                ign = pDelay + (f.at / parent.speed);
            }
        }
        const clearAt = douseAt.has(f.id) ? douseAt.get(f.id) : 0.5;
        par = Math.max(par, ign + clearAt / f.speed);
    }
    return Math.max(2, Math.round((par / 60) * 10) / 10);
}

/** PAR floors for the pure-teaching levels: the demo hand + reading eats the
 *  whole budget, so a low par there reads as "you missed" on a tutorial. */
const PAR_FLOOR = { 1: 30, 2: 24, 3: 20 };

// ---- assemble ---------------------------------------------------------------

/** Frozen geometry for levels 1-60 (pre-color-pillar): the plan pins 1-60 to
 *  "color fields + speeds only, no geometry redesign", so these levels reuse
 *  their shipped spawns/intersections/fuse routes verbatim and the color
 *  overlay is retried against the frozen layout instead of re-seeding it. */
const PINNED_1_60 = JSON.parse(readFileSync(path.join(ROOT, "tools", "level-gen", "base-1-60.json"), "utf8"));

/** Everything a player sees except burn speed/colors. Speeds are recalibrated
 *  per-plan and colors are the new pillar, so neither participates in the
 *  geometry fingerprint; delay rhythm is part of the layout feel and stays
 *  frozen with the geometry. */
function geometrySignature(lvl) {
    return JSON.stringify({
        payload: lvl.payload,
        spawns: lvl.spawns,
        intersections: lvl.intersections,
        fuses: lvl.fuses.map((f) => ({
            id: f.id,
            start: f.start,
            end: f.end,
            routeThrough: f.routeThrough,
            branchOf: f.branchOf,
            at: f.at,
            branchPoint: f.branchPoint,
            bulge: f.bulge,
            delayFrames: f.delayFrames,
        })),
    });
}

/** Copy a placed level so color variants can be tried without disturbing the
 *  shared geometry. Fuses are shallow-copied — applyMechanics mutates fuse
 *  objects, not the arrays themselves. */
function clonePlacement(p) {
    return {
        n: p.n,
        payload: p.payload,
        payloads: p.payloads,
        spawns: p.spawns,
        intersections: p.intersections.map((c) => ({ ...c })),
        fuses: p.fuses.map((f) => ({ ...f })),
        look: p.look,
        style: p.style,
    };
}

/** Color-layout ladder tried against the frozen geometry: the full planned
 *  scheme first, then relaxations (drop the mixed crossroad, trim decoys one
 *  at a time). The legend stays on screen even with zero decoys, so a tight
 *  layout reads as colored without ever forcing a geometry change. */
function schemeLadder(n) {
    const base = colorSchemeFor(n);
    if (!base) return [null];
    const ladder = [];
    const mixedOptions = base.mixed ? [true, false] : [false];
    for (const mixed of mixedOptions) {
        for (let fc = base.forbiddenCount; fc >= (mixed ? 1 : 0); fc--) {
            ladder.push({ ...base, forbiddenCount: fc, mixed });
        }
    }
    return ladder;
}

/** Branch fuses inherit their parent's color/end once the overlay runs (the
 *  chains code does this inline in the free-form path). */
function inheritBranchColors(level) {
    const byId = new Map(level.fuses.map((f) => [f.id, f]));
    for (const f of level.fuses) {
        if (!f.branchOf) continue;
        const parent = byId.get(f.branchOf);
        if (!parent) continue;
        f.end = parent.end;
        if (parent.color) f.color = parent.color;
    }
}

/** Place a level on its pinned 1-60 geometry. Finds the (salt, seed) whose
 *  post-processing reproduces the frozen layout byte-for-byte, then tries the
 *  color-scheme ladder against that geometry so the level validates without
 *  ever re-seeding the layout. */
function pinnedPlacement(n, k) {
    const baseSig = geometrySignature(PINNED_1_60[n]);
    const schemes = schemeLadder(n);
    for (let salt = 0; salt < 8; salt++) {
        for (let seed = 0; seed < 12; seed++) {
            const p = placeLevel(n, k, seed, salt, { mechanics: false });
            deHairpin(p);
            positionBranches(p);
            deHairpin(p);
            settleBranches(p);
            if (geometrySignature(p) !== baseSig) continue;
            // Geometry matches the frozen layout — overlay colors on a copy and
            // accept the first scheme+shift that still validates.
            for (const scheme of schemes) {
                const kk = scheme ? { ...k, _scheme: scheme } : k;
                for (let shift = 0; shift < 6; shift++) {
                    const q = clonePlacement(p);
                    const rng = makeRng(4000 + n * 613 + seed * 101 + salt * 7 + shift * 97);
                    applyMechanics(q, kk, rng, shift);
                    inheritBranchColors(q);
                    const v = validatePlacement(q);
                    if (v.ok) {
                        q.schemeUsed = scheme;
                        q.shiftUsed = shift;
                        return q;
                    }
                }
            }
        }
    }
    return null;
}

function buildLevels() {
    const levels = [];
    let prevSig = "";
    for (let n = 1; n <= 120; n++) {
        const k = knobsForLevel(n);
        let placed = null;
        let validation = { ok: false, reason: "none attempted" };

        // Levels 1-60 are pinned to their shipped geometry (color fields +
        // recalibrated speeds only, no redesign). The free-form retry loop is
        // only for the new 61-120 acts.
        if (n <= 60) {
            placed = pinnedPlacement(n, k);
            if (placed) {
                validation = { ok: true };
                const s = geometrySignature(placed);
                const b = geometrySignature(PINNED_1_60[n]);
                if (process.env.GEN_PIN_LOG) console.log(`[pin] L${n} geometry matches pinned: ${s === b}`);
            } else {
                console.error(`  ! L${n}: pinned geometry could not host the color pillar (falling back to free-form)`);
            }
        }
        if (n > 60 || !placed) {
            // Placement retry: the geometry constraints (no folds, clearance, cut-point
            // separation) are structural, and the look must differ from the previous
            // level — so try several geometry seeds AND look salts before giving up.
            const reasonCounts = {};
            for (let salt = 0; salt < 8 && !placed; salt++) {
                for (let seed = 0; seed < 12; seed++) {
                    const p = placeLevel(n, k, seed, salt);
                    // Remove folds/overlaps so no wick doubles back on itself and no
                    // chokepoint hides under the payload. Runs before snips are computed
                    // (a fuse may be un-routed by the safety net, changing min cuts).
                    deHairpin(p);
                    // Pin the fork points + branch cross-sections (uses the relaxed
                    // geometry, so the fork lands on the wick the player sees).
                    positionBranches(p);
                    // Relax the fresh branch cross-sections against the final fork
                    // geometry (fold-free + payload clearance + cut separation).
                    deHairpin(p);
                    // Downgrade routed branches whose cross-sections couldn't hold
                    // a clean spot after relaxation (dense levels). Runs before
                    // validation so the retry loop sees the real geometry.
                    settleBranches(p);
                    const v = validatePlacement(p);
                    validation = v;
                    if (!v.ok) {
                        if (process.env.GEN_ACCEPT_LOG && n === +process.env.GEN_ACCEPT_LOG) {
                            console.log(`[accept] L${n} salt=${salt} seed=${seed} REJECTED: ${v.reason}`);
                        }
                        reasonCounts[v.reason] = (reasonCounts[v.reason] || 0) + 1;
                        continue;
                    }
                    if (lookSignature(p.look, n > 60 ? mechTag(p) : "legacy") === prevSig) {
                        if (process.env.GEN_ACCEPT_LOG && n === +process.env.GEN_ACCEPT_LOG) {
                            console.log(`[accept] L${n} salt=${salt} seed=${seed} SKIP: look equals previous`);
                        }
                        continue; // visually identical to last level → new look
                    }
                    placed = p;
                    validation = v;
                    if (process.env.GEN_ACCEPT_LOG && n === +process.env.GEN_ACCEPT_LOG) {
                        console.log(`[accept] L${n} ACCEPTED salt=${salt} seed=${seed} (tried ${reasonCounts.total || 0} rejects)`);
                    }
                    break;
                }
            }
            if (!placed) {
                console.error(`  ! L${n}: no clean distinct placement found (last: ${validation.reason})`);
                if (process.env.GEN_DEBUG) {
                    const top = Object.entries(reasonCounts).sort((a, b) => b[1] - a[1]).slice(0, 4);
                    console.error(`      reasons: ${top.map(([r, c]) => `${r}×${c}`).join(", ")}`);
                }
                placed = placeLevel(n, k, 0, 0);
                deHairpin(placed);
                positionBranches(placed);
                deHairpin(placed);
                settleBranches(placed);
            }
        }
        const { payload, payloads, spawns, intersections, fuses, style, look } = placed;
        const wireRule = placed.wireRule || null;
        const douse = placed.douse || [];
        const pickups = placed.pickups || [];
        prevSig = lookSignature(look, n > 60 ? mechTag(placed) : "legacy");

        // Snips = minimum cuts the geometry requires + slack. The minimum is
        // computed from the FINAL geometry (poisoned crossroads, doused/
        // forbidden freebies) so 3-star is always reachable.
        const minCuts = computeMinCuts(placed);
        const snips = minCuts + slackForLevel(n);

        const level = {
            level_id: n,
            layout: payloads ? "twin" : style, // layout archetype (hub/offset/train/split/weave/twin)
            snipsAllowed: snips,
            par: Math.max(parSeconds(fuses, douse), PAR_FLOOR[n] || 0),
            payload,
            ...(payloads ? { payloads } : {}),
            spawns,
            intersections,
            fuses,
            ...(wireRule ? { wireRule } : {}),
            ...(douse.length ? { douse } : {}),
            ...(pickups.length ? { pickups } : {}),
        };
        // One-skill-at-a-time tutorial (CHI PLAY learning curve).
        if (n === 1) {
            level.tutorial = {
                text: "Swipe across a fuse to snip it! You have a limited number of snips, so make each cut count.",
                focus: "swipe",
                highlight: "s1",
            };
        } else if (n === 2) {
            level.tutorial = {
                text: "Two fuses burn at the same time! Watch both — snip each before the fire reaches the bomb.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 3) {
            level.tutorial = {
                text: "This fuse burns FAST! The moment the spark appears, cut it — don't wait.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 4) {
            level.tutorial = {
                text: "Sparks start one at a time — watch the delay, snip each fuse as it ignites.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 7) {
            level.tutorial = {
                text: "Every fuse passes through the same point. One well-placed cut snips them all!",
                focus: "intersection",
                highlight: "cut1",
            };
        } else if (n === 8) {
            level.tutorial = {
                text: "See that fork in the wick? When the fire reaches it, a NEW wick lights from that point! Snip the first fuse EARLY to stop it — or be ready to cut the new wick.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 9) {
            level.tutorial = {
                text: "Color-coded wires! Check the legend at the top of the screen: blue and purple are SAFE to cut. Red is a trap — cutting it gives one warning, then boom.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 14) {
            level.tutorial = {
                text: "Some fuses run straight to the bomb — no crossroads to find. Track every wick, not just the crossings.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 25) {
            level.tutorial = {
                text: "TWO wicks fork now. Cut a parent EARLY to stop both — or be ready to snip every new wick it lights.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 61) {
            level.tutorial = {
                text: "Gold stars give BONUS snips! Cut close to a star to bank +1 — grab them to stretch your budget.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 65) {
            level.tutorial = {
                text: "Water drops douse the fuse! A spark that reaches a drop snuffs itself — those wicks need NO cuts.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 69) {
            level.tutorial = {
                text: "Water drops douse some wicks — but the color rule still applies! Read the legend before you cut: never touch the red wires, and let doused wicks burn themselves out.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 91) {
            level.tutorial = {
                text: "TWO BOMBS! Sparks split between both targets — lose if fire reaches EITHER one. Watch both sides.",
                focus: "spawn",
                highlight: "s1",
            };
        }
        levels.push(level);
    }
    return levels;
}

function lookTag(lvl) {
    const f = lvl.fuses;
    const routes = new Set(f.map((x) => x.routeThrough || "D")).size;
    const delays = [...new Set(f.map((x) => x.delayFrames))].length;
    return `${routes}r/${delays}d`;
}

function main() {
    const levels = buildLevels();

    // Validate everything and report.
    let warnings = 0;
    for (const lvl of levels) {
        const w = validateLevel(lvl);
        for (const msg of w) {
            warnings++;
            console.error(`  ! ${msg}`);
        }
    }

    mkdirSync(path.dirname(OUT), { recursive: true });
    writeFileSync(OUT, JSON.stringify(levels, null, 2) + "\n");

    // Summary table per act.
    const ACT_NAMES = { 1: "Act 1", 2: "Act 2", 3: "Act 3", 4: "Act 4", 5: "Act 5" };
    const summary = { 1: {}, 2: {}, 3: {}, 4: {}, 5: {} };
    for (const lvl of levels) {
        const act = actFor(lvl.level_id);
        summary[act][lvl.level_id] = {
            spawns: lvl.spawns.length,
            chokepoints: lvl.intersections.length,
            snips: lvl.snipsAllowed,
            speeds: [...new Set(lvl.fuses.map((f) => f.speed))].length,
            layout: lvl.layout || "hub",
            look: lookTag(lvl),
            mech: mechTag(lvl),
        };
    }

    console.log(`\nWrote ${levels.length} levels → ${path.relative(ROOT, OUT)} (${warnings} validation warnings)`);
    for (const act of [1, 2, 3, 4, 5]) {
        const rows = Object.entries(summary[act])
            .map(([id, v]) => `L${id.padStart(2, "0")}:${v.spawns}s/${v.chokepoints}c/s${v.snips}/${v.layout}/${v.look}${v.mech ? `/${v.mech}` : ""}`)
            .join("  ");
        console.log(`${ACT_NAMES[act]}: ${rows}`);
    }
    if (warnings > 0) process.exit(1);
}

const IS_MAIN = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (IS_MAIN) main();

export { buildLevels, knobsForLevel, placeLevel, applyMechanics, validatePlacement, computeMinCuts, lookForLevel, colorSchemeFor, slackForLevel, deHairpin, positionBranches, settleBranches, pinnedPlacement, schemeLadder, geometrySignature, clonePlacement, inheritBranchColors, main };
