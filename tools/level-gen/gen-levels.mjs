#!/usr/bin/env node
/**
 * level-gen — generates the full 60-level ladder into src/data/levels.json.
 *
 * Encodes the difficulty model from the plan:
 *  - 3 acts of 20; within each act, 5-level waves of ramp-ramp-ramp-peak-relief.
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
import { fileURLToPath } from "node:url";
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

/**
 * Returns the difficulty knobs for a level index (1-based).
 * Teaching phases are explicit for Act 1; Acts 2-3 use wave math.
 * NOTE: snips is NOT set here — buildLevels derives it from the minimum
 * number of cuts the geometry requires (see slackForLevel).
 */
function knobsForLevel(n) {
    const act = Math.ceil(n / 20);
    const pos = (n - 1) % 20; // 0..19 within act
    const wave = Math.floor(pos / 5); // 0..3 (wave 3 = peak, relief = pos%5===4)
    const wpos = pos % 5; // 0,1,2 ramp; 3 peak; 4 relief
    const relief = wpos === 4; // relief puzzles pull back a step
    const k = { spawns: 2, chokepoints: 1, share: true, delay: "burst", speed: 0.001 };

    if (act === 1) {
        // Teaching phases, one skill at a time. Gentle pace — reading the lines
        // comes before racing them.
        if (n <= 3) {
            // Swipe-to-cut. Single direct fuse, generous snips.
            Object.assign(k, { spawns: 1, chokepoints: 0, share: true, delay: "burst", speed: 0.0006 });
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
        // Planning depth. Speed stays moderate through the act; the cap is
        // ~0.0017 so the act-2 peak still leaves ~9.8s per wick to read.
        Object.assign(k, { spawns: 4, chokepoints: 2, share: false, delay: "close", speed: 0.0012 });
        k.spawns = 4 + wave + (relief ? 0 : wpos >= 2 ? 1 : 0);
        k.chokepoints = 2 + (wave >= 1 ? 1 : 0) - (relief ? 1 : 0);
        k.delay = wave >= 2 ? "overlap" : "close";
        k.speed = 0.0012 + wave * 0.00015; // 0.0012–0.00165
        // Level 21-24: speed variance focus.
        if (n <= 24) { k.spawns = 4 + (n % 2); k.chokepoints = 2; k.speed = 0.0012 + (n % 3) * 0.0001; }
        // 25-28: multi-chokepoint routing + the jump to two chains.
        if (n >= 25 && n <= 28) { k.spawns = 6; k.chokepoints = 3; k.delay = "close"; }
        // 29-33: overlapping timing pressure.
        if (n >= 29 && n <= 33) { k.spawns = 6; k.chokepoints = 2; k.delay = "overlap"; }
        // 34-37: partial coverage (some fuses direct).
        if (n >= 34 && n <= 37) { k.spawns = 6 + (n % 2); k.chokepoints = 2; k.partial = true; }
        // 38-40: peak — the fastest band in the whole game, still calm.
        if (n >= 38) { k.spawns = 6; k.chokepoints = 3; k.speed = 0.0017; k.delay = "overlap"; }
    } else {
        // Act 3 — mastery via COMPLEXITY, not speed. The most tangled mazes
        // (many wicks, two forks, up to ten sparks) burn the SLOWEST, and
        // sparks arrive in a long trickle (spread) instead of an overlap, so
        // the player reads the lines and plans cuts instead of reacting.
        Object.assign(k, { spawns: 6, chokepoints: 2, share: false, delay: "spread", speed: 0.0014 });
        if (n <= 44) {
            // Minimal snips: single shared chokepoint, still brisk.
            Object.assign(k, { spawns: 6, chokepoints: 1, share: true, delay: "spread", speed: 0.0014 });
        } else if (n <= 50) {
            // Full nets: many spawns funneled through a few chokepoints.
            Object.assign(k, {
                spawns: 6 + (n % 2), chokepoints: 3, share: false,
                delay: "spread", speed: 0.0013 + (n % 3) * 0.0001,
            });
        } else if (n <= 55) {
            // Wave peak escalation — but the maze is densest here, so the burn
            // SLOWS: 8 spawns + 2 forks ≈ 10 sparks to track.
            Object.assign(k, {
                spawns: 7 + (n % 2), chokepoints: 3, share: false,
                delay: "spread", speed: 0.0012,
            });
        } else if (n <= 58) {
            // Boss levels: every chokepoint must be cut, zero slack. Calmest
            // burn in the act — the puzzle is the placement, not the race.
            Object.assign(k, {
                spawns: 8, chokepoints: 4, share: false,
                delay: "spread", speed: 0.0011,
            });
        } else {
            // 59-60 finale + relief.
            Object.assign(k, {
                spawns: 6 - (n % 2), chokepoints: 2, share: false,
                delay: "stagger", speed: 0.0013,
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
    // L14, returns with act 3's relief puzzles. Stops every board from
    // converging through a visible middle.
    if (n >= 14 && n <= 24) k.partial = true;
    else if (n >= 34 && n <= 37) k.partial = true;
    else if (act === 3 && relief) k.partial = true;
    return k;
}

/**
 * Cut slack per level — how many mistakes the player can afford.
 * Snips = minimum cuts required by the geometry + slack.
 * Every level keeps >= 1 spare snip so the 3-star goal ("finish with a snip
 * left") is always achievable; teaching levels get 2.
 */
function slackForLevel(n) {
    return n <= 3 ? 2 : 1;
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
 *   routePattern  - nearest | braid | cross | fan  (how multi-chokepoint fuses
 *                  connect: straight to the nearest point, alternating braids,
 *                  diagonals that genuinely cross, or spread in sequence)
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
    const visualTeaching = n <= 3;
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
        curvePattern: visualTeaching ? "flat" : pick(rng, ["flat", "flat", "arc", "weave"]),
    };
}

/** Compact fingerprint of a look, used to guarantee adjacent levels differ. */
function lookSignature(look) {
    const bucket = Math.round(look.fanDeg / 40);
    return `${look.distPattern}|${look.radiusProfile}|${bucket}|${look.routePattern}|${look.delayPattern}|${look.speedPattern}|${look.curvePattern}`;
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
 *  hub    - classic sunburst: bomb dead-center, spawns fanned around it.
 *  offset - bomb pushed to one side, spawns fanned on the far side.
 *  train  - bomb on one edge, spawns lined up in a row opposite it.
 *  split  - bomb in the middle, two spawn clusters flanking it, chokepoints
 *           between the clusters -> fuses genuinely cross the middle.
 *  weave  - spawns on a band, chokepoints swung off-axis so the fuses arc
 *           and cross each other in different sections.
 */
const PLACEMENTS = {
    hub(n, k, rng, look) {
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const angles = spawnAngles(k.spawns, look, rng);
        const spawns = angles.map((deg, i) => {
            const a = (deg * Math.PI) / 180;
            const radius = spawnRadius(i, k.spawns, look, rng);
            return { id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) };
        });
        const intersections = chokepointsBetween(k, rng, Math.min(...angles), look.fanDeg, 200 * look.cpDist);
        return { payload, spawns, intersections };
    },

    offset(n, k, rng, look) {
        const angle = rng() * Math.PI * 2;
        const dist = 90 + rng() * 60;
        const payload = { id: PAYLOAD_ID, x: Math.round(Math.cos(angle) * dist), y: Math.round(Math.sin(angle) * dist) };
        const centerDeg = (angle * 180) / Math.PI + 180; // opposite side of the bomb
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
    },

    train(n, k, rng, look) {
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
            const spreadDeg = (52 + rng() * 26) * (look.distPattern === "uniform" ? 1 : 0.6 + rng() * 0.5);
            const a = axis + side * Math.PI + (idx / Math.max(1, count - 1) - 0.5) * ((spreadDeg * Math.PI) / 180);
            const radius = spawnRadius(i, k.spawns, look, rng);
            spawns.push({ id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) });
        }
        const intersections = [];
        for (let c = 0; c < k.chokepoints; c++) {
            const a = axis + Math.PI / 2 + c * (Math.PI / Math.max(1, k.chokepoints)) + (rng() - 0.5) * 0.3;
            const r = 130 + rng() * 60 * look.cpDist;
            intersections.push({ id: `cut${c + 1}`, x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
        }
        return { payload, spawns, intersections };
    },

    weave(n, k, rng, look) {
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const angles = spawnAngles(k.spawns, look, rng);
        const spawns = angles.map((deg, i) => {
            const a = (deg * Math.PI) / 180;
            const radius = spawnRadius(i, k.spawns, look, rng);
            return { id: `s${i + 1}`, x: Math.round(Math.cos(a) * radius), y: Math.round(Math.sin(a) * radius) };
        });
        // Chokepoints swung ~150° off the spawn band -> the forced-intersection
        // curves bow sideways and cross each other in different sections.
        const intersections = [];
        for (let c = 0; c < k.chokepoints; c++) {
            const a = ((angles[0] + 150 + (140 * c) / Math.max(1, k.chokepoints)) * Math.PI) / 180;
            const r = 190 + rng() * 60 * look.cpDist;
            intersections.push({ id: `cut${c + 1}`, x: Math.round(Math.cos(a) * r), y: Math.round(Math.sin(a) * r) });
        }
        return { payload, spawns, intersections };
    },

    rings(n, k, rng, look) {
        // Concentric tiers: spawns alternate between an outer and inner ring,
        // chokepoints sit on an intermediate ring. Reads as a mini-maze rather
        // than a sunburst — no two wicks look like they meet at the same point.
        const payload = { id: PAYLOAD_ID, x: 0, y: 0 };
        const angles = spawnAngles(k.spawns, look, rng);
        const spawns = angles.map((deg, i) => {
            const a = (deg * Math.PI) / 180;
            const ring = (i % 2 === 0 ? 1 : 0.72) * (300 + rng() * 55);
            return { id: `s${i + 1}`, x: Math.round(Math.cos(a) * ring), y: Math.round(Math.sin(a) * ring) };
        });
        const intersections = chokepointsBetween(k, rng, Math.min(...angles), look.fanDeg, 205 * look.cpDist);
        return { payload, spawns, intersections };
    },
};

// Chokepoints must stay clearly OUTSIDE the payload's VISIBLE art. The banana
// png is 800x436 with visible art ~266x393 (transparent margins), drawn at
// targetHeight 150 → visible ~91x135 world px (half-width ~46, half-height ~68).
// 150px keeps a clear run of wick between the bend and the banana.
const PAYLOAD_CLEARANCE = 150;

// Bomb-side anchors: every wick ends at its OWN point on a ring just outside
// the bomb's visible art (half-diagonal ~82), so wicks ENTER THE BOMB FROM
// DIFFERENT SIDES instead of all funneling into the center. The tail swings
// around the bomb to its anchor — a longer, readable detour that lets the
// player snipe each line near its own entry point instead of a tight bundle.
const ENTRY_RADIUS = 88;

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

/** Reposition chokepoints so every routed fuse is fold-free and clear of the payload. */
function deHairpin(level) {
    const iMap = {};
    level.intersections.forEach((c) => (iMap[c.id] = c));
    const sMap = {};
    level.spawns.forEach((s) => (sMap[s.id] = s));
    const bomb = level.payload;

    const routed = {}; // chokepoint id -> [{ start, end }]
    for (const f of level.fuses) {
        if (!f.routeThrough) continue;
        const start = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!start) continue;
        (routed[f.routeThrough] ??= []).push({ start, end: f.entry || bomb });
    }
    // Direct fuses' cut points: the midpoint of their start->entry segment.
    // Branch fuses have no spawn and no chokepoint (always direct) — their cut
    // points are validated after positionBranches pins the fork.
    const directMidpoints = [];
    for (const f of level.fuses) {
        if (f.routeThrough || f.branchOf) continue;
        const e = f.entry || bomb;
        directMidpoints.push({ x: (sMap[f.start].x + e.x) / 2, y: (sMap[f.start].y + e.y) / 2 });
    }

    // Outer loop: alternate hairpin relaxation and payload clearance until both hold.
    for (let pass = 0; pass < 8; pass++) {
        // 1) Payload clearance: push chokepoints out of the bomb's footprint.
        let clear = true;
        for (const cid of Object.keys(routed)) {
            const I = iMap[cid];
            const dx = I.x - bomb.x, dy = I.y - bomb.y;
            const d = Math.hypot(dx, dy);
            if (d < PAYLOAD_CLEARANCE && d > 0.001) {
                const k = PAYLOAD_CLEARANCE / d;
                I.x = bomb.x + dx * k;
                I.y = bomb.y + dy * k;
                clear = false;
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
        const u = projectionU(st, f.entry || bomb, I);
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

function validatePlacement({ payload, spawns, intersections, fuses }) {
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
        const u = projectionU(st, f.entry || payload, iMap[f.routeThrough]);
        if (u < FOLD_THRESHOLD || u > 1 - FOLD_THRESHOLD) return { ok: false, reason: `fold on ${f.start || f.id}` };
    }
    // Chokepoints must sit clear of the payload's visible art.
    for (const c of intersections) {
        if (Math.hypot(c.x - payload.x, c.y - payload.y) < PAYLOAD_CLEARANCE) return { ok: false, reason: "chokepoint under payload" };
        if (Math.hypot(c.x - payload.x, c.y - payload.y) > MAX_CP_DISTANCE) return { ok: false, reason: "chokepoint too far from payload" };
    }
    // Chokepoints must not sit on top of a spawn (the wick would be invisible
    // and the cut pointless) — especially with concentric "rings" layouts.
    for (const c of intersections) {
        for (const s of spawns) {
            if (Math.hypot(c.x - s.x, c.y - s.y) < 60) return { ok: false, reason: "chokepoint too close to a spawn" };
        }
    }
    // Every cut point (chokepoint or direct-fuse midpoint) must be separately
    // placeable. Branch fuses contribute their fork->entry midpoint.
    const pts = intersections.slice();
    for (const f of fuses) {
        if (f.routeThrough) continue;
        const st = f.branchOf ? f.branchPoint : sMap[f.start];
        if (!st) return { ok: false, reason: `fuse ${f.id} has no start` };
        const e = f.entry || payload;
        pts.push({ x: (st.x + e.x) / 2, y: (st.y + e.y) / 2 });
    }
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < CUT_SEPARATION) return { ok: false, reason: "cut points too close" };
        }
    }

    // The fork is the puzzle: a cut placed at a chokepoint — or at the parent's
    // own cut target — snuffs ANY spark within its ~15px radius, so a branch
    // wick threading within that radius would be killed by the parent's normal
    // cut and the fork would be decorative. Keep the branch's whole path clear
    // of every OTHER chokepoint and of a direct parent's cut target. (Its own
    // cross-section is the exception — the branch passes through that one.)
    for (const f of fuses) {
        if (!f.branchOf || !f.branchPoint) continue;
        const st = f.branchPoint;
        const cpI = f.routeThrough ? iMap[f.routeThrough] : { x: (st.x + payload.x) / 2, y: (st.y + payload.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(st, payload, cpI, f.bulge || 0);
        const samples = [];
        for (let u = 0; u <= 1; u += 0.04) samples.push(getBezierXY(u, st, cp1, cp2, payload));
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
            const parentCut = { x: (sMap[parent.start].x + payload.x) / 2, y: (sMap[parent.start].y + payload.y) / 2 };
            for (const s of samples) {
                if (Math.hypot(s.x - parentCut.x, s.y - parentCut.y) < BRANCH_CUT_CLEARANCE) {
                    return { ok: false, reason: `branch ${f.id} passes near its parent's cut` };
                }
            }
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
    const act = Math.ceil(n / 20);
    // Single-fuse practice (L2-L3) and single-shared-chokepoint levels keep the
    // one-sided pools (spawns must sit on one side of the bomb); everything else
    // draws from the full archetype set.
    const simple = n <= 3;
    const sharedSingle = k.share && k.chokepoints === 1;
    const pool = simple || sharedSingle
        ? ["hub", "offset", "train"]
        : act >= 2
            ? ["hub", "offset", "train", "split", "weave", "rings"]
            : ["hub", "offset", "train", "split"];
    const rng = makeRng(2000 + n * 911);
    let idx = Math.floor(rng() * pool.length);
    // Never repeat the previous level's style.
    const prev = styleForLevel(n - 1, k);
    if (pool[idx] === prev && pool.length > 1) idx = (idx + 1) % pool.length;
    return pool[idx];
}

/** Route a spawn through the chokepoint that sits "in its path" (nearest to the
 *  spawn). This keeps bends between the spawn and the bomb — avoiding folds —
 *  while still grouping spawns across multiple chokepoints for planning depth. */
function nearestChokepoint(spawn, intersections) {
    let best = null, bestD = Infinity;
    for (const c of intersections) {
        const d = Math.hypot(spawn.x - c.x, spawn.y - c.y);
        if (d < bestD) { bestD = d; best = c.id; }
    }
    return best;
}

/** Route a spawn through a chokepoint per the routing topology pattern. */
function routeFor(i, spawn, k, look, intersections, rng) {
    if (k.chokepoints === 0) return undefined; // direct fuse (tutorial)
    if (k.share) return "cut1";
    if (k.partial && i % 3 === 2) return undefined; // some fuses direct (partial coverage)
    const cps = intersections;
    switch (look.routePattern) {
        case "nearest":
            return nearestChokepoint(spawn, cps);
        case "braid":
            return cps[i % cps.length].id; // alternating = braided wicks
        case "fan": {
            const idx = Math.min(cps.length - 1, Math.floor((i / Math.max(1, k.spawns)) * cps.length));
            return cps[idx].id; // spread in sequence = wicks fan outward
        }
        case "cross": {
            // Route to the chokepoint OPPOSITE the spawn so the wicks genuinely
            // cross each other through the middle.
            const a = Math.atan2(spawn.y, spawn.x);
            let best = null, bestScore = -Infinity;
            for (const c of cps) {
                const ca = Math.atan2(c.y, c.x);
                const dot = Math.cos(a) * Math.cos(ca) + Math.sin(a) * Math.sin(ca);
                const score = -dot + rng() * 0.35; // tiebreak jitter
                if (score > bestScore) { bestScore = score; best = c.id; }
            }
            return best;
        }
        default:
            return nearestChokepoint(spawn, cps);
    }
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
        const ps = sMap[parent.start];
        const pEnd = parent.entry || payload;
        const pCp = iMap[parent.routeThrough] || { x: (ps.x + pEnd.x) / 2, y: (ps.y + pEnd.y) / 2 };
        const [cp1, cp2] = forcedFuseCPs(ps, pEnd, pCp, parent.bulge || 0);

        // A fork too close to the payload leaves a stubby, half-hidden branch
        // wick. Push the fork earlier along the parent until the branch has a
        // real span (the parent's cut is still at t=0.5, so the fork always
        // fires before a normal cut can stop it). If even the earliest `at`
        // can't clear the bomb art, the parent's wick never leaves the bomb's
        // footprint — drop the branch rather than emit a hidden stub.
        const bend = f.entry || payload;
        let at = f.at;
        let P = getBezierXY(at, ps, cp1, cp2, pEnd);
        let L = Math.hypot(bend.x - P.x, bend.y - P.y);
        for (let guard = 0; guard < 8 && L < FORK_MIN_LENGTH; guard++) {
            at = Math.max(0.14, at - 0.025);
            P = getBezierXY(at, ps, cp1, cp2, pEnd);
            L = Math.hypot(bend.x - P.x, bend.y - P.y);
        }
        if (L < 160) {
            toRemove.push(f);
            continue;
        }
        f.at = Math.round(at * 1000) / 1000;
        f.branchPoint = { x: Math.round(P.x), y: Math.round(P.y) };

        // Long wicks get the branch a real cross-section: ~55% along the
        // fork->entry chord, offset to the side away from the parent's
        // mid-curve (flipped if that side crowds another cut point), then
        // pushed out of the payload clearance ring. Short-wick forks can't
        // host a chokepoint inside the clearance ring — those stay direct
        // (their midpoint is the cut target) with a bulge so the fork still
        // reads as a Y.
        const wx = bend.x - P.x, wy = bend.y - P.y;
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
            const r = Math.hypot(cx, cy);
            if (r < MIN_R && r > 0.001) {
                const k = MIN_R / r;
                cx *= k;
                cy *= k;
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
        const r = Math.hypot(cp.x - payload.x, cp.y - payload.y);
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
                const pEnd = parent.entry || payload;
                const pCp = iMap[parent.routeThrough] || { x: (ps.x + pEnd.x) / 2, y: (ps.y + pEnd.y) / 2 };
                const [cp1, cp2] = forcedFuseCPs(ps, pEnd, pCp, parent.bulge || 0);
                const P = f.branchPoint || getBezierXY(f.at, ps, cp1, cp2, pEnd);
                const bend = f.entry || payload;
                const wx = bend.x - P.x, wy = bend.y - P.y;
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

/** BOMB-SIDE ANCHORS: each wick gets its own end point on a ring just outside
 *  the bomb art, spread around the full circle and ordered by each fuse's
 *  chokepoint/start angle — so adjacent wicks peel to adjacent sides and the
 *  tails swing around the bomb instead of funneling into one spot. A branch
 *  wick anchors on the far side of its parent's entry (the tree still reads
 *  as one split, but the two tips enter the bomb from different sides).
 *  Returns the entry node list for the level JSON. */
function assignEntryAnchors(level, rng) {
    const { payload, fuses } = level;
    const sMap = {};
    level.spawns.forEach((s) => (sMap[s.id] = s));
    const iMap = {};
    level.intersections.forEach((c) => (iMap[c.id] = c));
    const byId = new Map(fuses.map((f) => [f.id, f]));

    // Ordering angle per fuse: its chokepoint (routed), its start (direct), or
    // its parent's anchor (branch — set below, parents precede branches).
    const keyed = fuses.map((f) => {
        let ref = null;
        if (f.routeThrough) ref = iMap[f.routeThrough];
        else if (!f.branchOf) ref = sMap[f.start];
        else {
            const p = byId.get(f.branchOf);
            ref = p && p.entry ? p.entry : payload;
        }
        const ang = Math.atan2((ref ? ref.y : payload.y) - payload.y, (ref ? ref.x : payload.x) - payload.x);
        return { f, ang };
    });
    keyed.sort((a, b) => a.ang - b.ang);

    const n = keyed.length;
    const sep = (Math.PI * 2) / Math.max(1, n);
    const base = rng() * sep * 0.6;
    const entries = [];
    const tups = []; // { f, a } — angle then refined by de-bundling
    keyed.forEach((k, idx) => {
        let a = base + idx * sep + (rng() - 0.5) * sep * 0.45;
        if (k.f.branchOf) {
            // Peels the branch ~60° around the bomb from its parent's tip.
            const p = byId.get(k.f.branchOf);
            if (p && p.entry) {
                const pa = Math.atan2(p.entry.y - payload.y, p.entry.x - payload.x);
                a = pa + 1.05 + (rng() - 0.5) * 0.4;
            }
        }
        const id = `e${idx}`;
        k.f.end = id;
        k.f.entry = {
            x: Math.round(payload.x + Math.cos(a) * ENTRY_RADIUS),
            y: Math.round(payload.y + Math.sin(a) * ENTRY_RADIUS),
        };
        entries.push({ id, x: k.f.entry.x, y: k.f.entry.y });
        tups.push({ f: k.f, a });
    });

    // De-bundle: nudge anchors that landed within ~24° of a neighbor apart, so
    // every wick enters the bomb from a visibly distinct side (the jittered
    // slot ordering + branch offsets can otherwise bunch two tips together).
    const MIN_ENTRY_GAP = 0.42;
    tups.sort((p, q) => p.a - q.a);
    for (let iter = 0; iter < 10; iter++) {
        let moved = false;
        for (let i = 0; i < tups.length; i++) {
            const cur = tups[i];
            const next = tups[(i + 1) % tups.length];
            let gap = next.a - cur.a;
            if (i === tups.length - 1) gap += Math.PI * 2;
            if (gap < MIN_ENTRY_GAP) {
                const fix = (MIN_ENTRY_GAP - gap) / 2;
                cur.a -= fix;
                next.a += fix;
                moved = true;
            }
        }
        if (!moved) break;
    }
    for (let i = 0; i < tups.length; i++) {
        const { f, a } = tups[i];
        f.entry = {
            x: Math.round(payload.x + Math.cos(a) * ENTRY_RADIUS),
            y: Math.round(payload.y + Math.sin(a) * ENTRY_RADIUS),
        };
        const en = entries.find((e) => e.id === f.end);
        if (en) {
            en.x = f.entry.x;
            en.y = f.entry.y;
        }
    }
    return entries;
}

function placeLevel(n, k, seedOffset = 0, salt = 0) {
    const rng = makeRng(1000 + n * 137 + seedOffset * 7919);
    const look = lookForLevel(n, k, seedOffset, salt);
    const style = styleForLevel(n, k);
    const { payload, spawns, intersections } = PLACEMENTS[style](n, k, rng, look);

    // Fuses: route spawns through chokepoints (shared vs grouped vs partial).
    const fuses = spawns.map((s, i) => {
        const routeThrough = routeFor(i, s, k, look, intersections, rng);
        const f = {
            id: `f${i}`,
            start: s.id,
            ...(routeThrough ? { routeThrough } : {}),
            end: PAYLOAD_ID,
            speed: speedFor(k, i, look, rng),
            delayFrames: delayFor(k, i, k.spawns, look, rng),
        };
        // Curve shape variety: split control points bow the arc without moving
        // the chokepoint pass-through (see createForcedIntersectionFuse).
        const curve = look.curvePattern || "flat";
        f.bulge = curve === "flat" ? 0 : curve === "arc" ? Math.round((0.06 + rng() * 0.05) * 1000) / 1000 : i % 2 === 0 ? 0.1 : -0.1;
        return f;
    });

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
            .sort((a, b) => a.f.delayFrames - b.f.delayFrames || a.i - b.i);
        for (let c = 0; c < nChains; c++) {
            const parent = ordered[c];
            const at = Math.round((0.26 + rng() * 0.12) * 1000) / 1000; // 0.26–0.38, before t=0.5
            fuses.push({
                id: `f${fuses.length}`,
                branchOf: parent.f.id,
                at,
                end: PAYLOAD_ID,
                speed: Math.round(Math.max(0.0007, Math.min(0.0045, parent.f.speed * (branchSpeedFactor(n) + rng() * 0.12))) * 10000) / 10000,
                delayFrames: 99999, // no timer — lit when the parent's burn reaches `at`
            });
        }
    }

    // Bomb-side anchors: every wick (spawn-rooted AND branch) ends at its own
    // point on a ring around the bomb art, so wicks enter from different sides.
    const entries = assignEntryAnchors({ payload, spawns, intersections, fuses }, rng);

    if (process.env.GEN_DELAY_DEBUG && (n === 48 || n === 51 || n === 55 || n === 45)) {
        console.log(`[delaydebug] L${n} delayPattern=${look.delayPattern} k.delay=${k.delay} spawns=${k.spawns} chainDelaySpan=${delaySpan(k, k.spawns, rng)}`);
        for (const f of fuses) console.log(`[delaydebug]   ${f.id} delay=${f.delayFrames}${f.branchOf ? " branchOf=" + f.branchOf : ""}`);
    }
    return { n, payload, spawns, intersections, fuses, entries, k, style, look };
}

/** PAR time: the clear time if every fuse is cut at its ideal point (its
 *  chokepoint or direct-fuse midpoint, both at t=0.5) the moment the level
 *  starts. Sparks routed through a shared chokepoint die when they reach the
 *  gap, so the level clears when the LAST spark crosses its cut. Beating par
 *  means cutting sparks close-in (fast play), which spends extra snips — the
 *  speed-vs-economy trade-off that keeps both strategies meaningful.
 *  Branch sparks have no timer: they light when their parent crosses the fork,
 *  then burn to their own cut. */
function parSeconds(fuses) {
    let par = 0;
    const byId = new Map(fuses.map((f) => [f.id, f]));
    for (const f of fuses) {
        let ign = f.delayFrames >= 99999 ? 0 : f.delayFrames;
        if (f.branchOf) {
            const parent = byId.get(f.branchOf);
            if (parent) {
                const pDelay = parent.delayFrames >= 99999 ? 0 : parent.delayFrames;
                ign = pDelay + (f.at / parent.speed);
            }
        }
        par = Math.max(par, ign + 0.5 / f.speed);
    }
    return Math.max(2, Math.round((par / 60) * 10) / 10);
}

/** PAR floors for the pure-teaching levels: the demo hand + reading eats the
 *  whole budget, so a low par there reads as "you missed" on a tutorial. */
const PAR_FLOOR = { 1: 30, 2: 24, 3: 20 };

// ---- assemble ---------------------------------------------------------------

function buildLevels() {
    const levels = [];
    let prevSig = "";
    for (let n = 1; n <= 60; n++) {
        const k = knobsForLevel(n);

        // Placement retry: the geometry constraints (no folds, clearance, cut-point
        // separation) are structural, and the look must differ from the previous
        // level — so try several geometry seeds AND look salts before giving up.
        let placed = null;
        let validation = { ok: false, reason: "none attempted" };
        const reasonCounts = {};
        for (let salt = 0; salt < 8 && !placed; salt++) {
            for (let seed = 0; seed < 12; seed++) {
                const p = placeLevel(n, k, seed, salt);
                // Remove folds/overlaps so no wick doubles back on itself and no
                // chokepoint hides under the payload. Runs before snips are computed
                // (a fuse may be un-routed by the safety net, changing min cuts).
                deHairpin({ payload: p.payload, spawns: p.spawns, intersections: p.intersections, fuses: p.fuses });
                // Pin the fork points + branch cross-sections (uses the relaxed
                // geometry, so the fork lands on the wick the player sees).
                positionBranches(p);
                // Relax the fresh branch cross-sections against the final fork
                // geometry (fold-free + payload clearance + cut separation).
                deHairpin({ payload: p.payload, spawns: p.spawns, intersections: p.intersections, fuses: p.fuses });
                // Downgrade routed branches whose cross-sections couldn't hold
                // a clean spot after relaxation (dense levels). Runs before
                // validation so the retry loop sees the real geometry.
                settleBranches(p);
                const v = validatePlacement(p);
                validation = v;
                if (!v.ok) {
                    reasonCounts[v.reason] = (reasonCounts[v.reason] || 0) + 1;
                    continue;
                }
                if (lookSignature(p.look) === prevSig) continue; // visually identical to last level → new look
                placed = p;
                validation = v;
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
            deHairpin({ payload: placed.payload, spawns: placed.spawns, intersections: placed.intersections, fuses: placed.fuses });
            positionBranches(placed);
            deHairpin({ payload: placed.payload, spawns: placed.spawns, intersections: placed.intersections, fuses: placed.fuses });
            settleBranches(placed);
        }
        const { payload, spawns, intersections, fuses, entries, style, look } = placed;
        prevSig = lookSignature(look);

        // Snips = minimum cuts the geometry requires + slack.
        // Every fuse routed through a chokepoint needs one cut at that chokepoint;
        // every direct fuse needs its own cut.
        const chokepointsUsed = new Set(fuses.filter((f) => f.routeThrough).map((f) => f.routeThrough)).size;
        const directCount = fuses.filter((f) => !f.routeThrough).length;
        const minCuts = chokepointsUsed + directCount;
        const snips = minCuts + slackForLevel(n);

        const level = {
            level_id: n,
            layout: style, // layout archetype (hub/offset/train/split/weave)
            snipsAllowed: snips,
            par: Math.max(parSeconds(fuses), PAR_FLOOR[n] || 0),
            payload,
            spawns,
            intersections,
            entries,
            fuses,
        };
        // One-skill-at-a-time tutorial (CHI PLAY learning curve).
        if (n === 1) {
            level.tutorial = {
                text: "Swipe across a fuse to snip it! You have a limited number of snips, so make each cut count.",
                focus: "swipe",
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
        } else if (n === 25) {
            level.tutorial = {
                text: "TWO wicks fork now. Cut a parent EARLY to stop both — or be ready to snip every new wick it lights.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 8) {
            level.tutorial = {
                text: "See that fork in the wick? When the fire reaches it, a NEW wick lights from that point! Snip the first fuse EARLY to stop it — or be ready to cut the new wick.",
                focus: "spawn",
                highlight: "s1",
            };
        } else if (n === 14) {
            level.tutorial = {
                text: "Some fuses run straight to the bomb — no crossroads to find. Track every wick, not just the crossings.",
                focus: "spawn",
                highlight: "s1",
            };
        }
        levels.push(level);
    }
    return levels;
}

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
const summary = { 1: {}, 2: {}, 3: {} };
for (const lvl of levels) {
    const act = Math.ceil(lvl.level_id / 20);
    summary[act][lvl.level_id] = {
        spawns: lvl.spawns.length,
        chokepoints: lvl.intersections.length,
        snips: lvl.snipsAllowed,
        speeds: [...new Set(lvl.fuses.map((f) => f.speed))].length,
        layout: lvl.layout || "hub",
        look: lookTag(lvl),
    };
}

function lookTag(lvl) {
    const f = lvl.fuses;
    const routes = new Set(f.map((x) => x.routeThrough || "D")).size;
    const delays = [...new Set(f.map((x) => x.delayFrames))].length;
    return `${routes}r/${delays}d`;
}

console.log(`\nWrote ${levels.length} levels → ${path.relative(ROOT, OUT)} (${warnings} validation warnings)`);
for (const act of [1, 2, 3]) {
    const rows = Object.entries(summary[act])
        .map(([id, v]) => `L${id.padStart(2, "0")}:${v.spawns}s/${v.chokepoints}c/s${v.snips}/${v.layout}/${v.look}`)
        .join("  ");
    console.log(`Act ${act}: ${rows}`);
}
if (warnings > 0) process.exit(1);
