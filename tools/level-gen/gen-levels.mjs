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
        // Teaching phases, one skill at a time.
        if (n <= 3) {
            // Swipe-to-cut. Single direct fuse, generous snips.
            Object.assign(k, { spawns: 1, chokepoints: 0, share: true, delay: "burst", speed: 0.0008 });
        } else if (n <= 6) {
            // Staggered delays.
            Object.assign(k, {
                spawns: 2 + (n % 2), chokepoints: 1, share: true,
                delay: "stagger", speed: 0.0009,
            });
        } else if (n <= 10) {
            // Shared chokepoint: one cut kills many.
            Object.assign(k, {
                spawns: 3 + (n % 3), chokepoints: 1, share: true,
                delay: "close", speed: 0.0009 + (n % 3) * 0.0001,
            });
        } else if (n <= 15) {
            // Snip economy: split across 2 chokepoints.
            Object.assign(k, {
                spawns: 3 + (n % 2), chokepoints: 2, share: false,
                delay: "stagger", speed: 0.001,
            });
        } else {
            // Combine everything. Peak 19-20, relief 18.
            Object.assign(k, {
                spawns: 4 + (relief ? 0 : (n % 2)), chokepoints: 2, share: false,
                delay: "close", speed: relief ? 0.0009 : 0.001 + wave * 0.0001,
            });
        }
    } else if (act === 2) {
        // Planning depth. Wave math drives it.
        Object.assign(k, { spawns: 4, chokepoints: 2, share: false, delay: "close", speed: 0.0012 });
        k.spawns = 4 + wave + (relief ? 0 : wpos >= 2 ? 1 : 0);
        k.chokepoints = 2 + (wave >= 1 ? 1 : 0) - (relief ? 1 : 0);
        k.delay = wave >= 2 ? "close" : "stagger";
        k.speed = 0.0012 + wave * 0.00015;
        // Level 21-24: speed variance focus.
        if (n <= 24) { k.spawns = 4 + (n % 2); k.chokepoints = 2; k.speed = 0.0012 + (n % 3) * 0.0001; }
        // 25-28: multi-chokepoint routing.
        if (n >= 25 && n <= 28) { k.spawns = 5; k.chokepoints = 3; k.delay = "stagger"; }
        // 29-33: overlapping timing pressure.
        if (n >= 29 && n <= 33) { k.spawns = 5; k.chokepoints = 2; k.delay = "overlap"; }
        // 34-37: partial coverage (some fuses direct).
        if (n >= 34 && n <= 37) { k.spawns = 5 + (n % 2); k.chokepoints = 2; k.partial = true; }
        // 38-40: peak.
        if (n >= 38) { k.spawns = 6; k.chokepoints = 3; k.speed = 0.0016; }
    } else {
        // Act 3 — mastery. Snips derive from the geometry (min cuts, no slack).
        const base = { spawns: 6, chokepoints: 2, share: false, delay: "close", speed: 0.0016 };
        Object.assign(k, base);
        if (n <= 44) {
            // Minimal snips: single shared chokepoint, faster.
            Object.assign(k, { spawns: 6, chokepoints: 1, share: true, delay: "overlap", speed: 0.0018 });
        } else if (n <= 50) {
            // Full nets: many spawns funneled through a few chokepoints.
            Object.assign(k, {
                spawns: 6 + (n % 2), chokepoints: 3, share: false,
                delay: "overlap", speed: 0.0018 + (n % 3) * 0.0001,
            });
        } else if (n <= 55) {
            // Wave peak escalation.
            Object.assign(k, {
                spawns: 7 + (n % 2), chokepoints: 3, share: false,
                delay: "overlap", speed: 0.002,
            });
        } else if (n <= 58) {
            // Boss levels: every chokepoint must be cut, zero slack (plateau, no climb).
            Object.assign(k, {
                spawns: 8, chokepoints: 4, share: false,
                delay: "overlap", speed: 0.002,
            });
        } else {
            // 59-60 finale + relief.
            Object.assign(k, {
                spawns: 6 - (n % 2), chokepoints: 2, share: false,
                delay: "stagger", speed: 0.0014,
            });
        }
    }
    return k;
}

/**
 * Cut slack per level — how many mistakes the player can afford.
 * Snips = minimum cuts required by the geometry + slack.
 * Slack falls across the ladder: teach (2) -> ramp (1) -> mastery (0).
 */
function slackForLevel(n) {
    if (n <= 3) return 2;
    if (n <= 15) return 1;
    if (n <= 24) return 1;
    return 0;
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
    const teaching = n <= 10; // keep early levels pedagogically simple
    const sharedSingle = k.share && k.chokepoints === 1;
    // Narrow fan for single-shared-chokepoint levels (spawns must stay on one
    // side of the bomb for the shared cut to stay fold-free); wide otherwise.
    const fanDeg = sharedSingle
        ? Math.round(80 + rng() * 90) // 80-170°
        : Math.round(170 + rng() * 140); // 170-310°
    return {
        fanDeg,
        distPattern: teaching ? "uniform" : pick(rng, LOOK_DIST),
        radiusProfile: teaching ? "even" : pick(rng, LOOK_RADIUS),
        cpDist: 0.72 + rng() * 0.45,
        routePattern: k.chokepoints >= 2 && !k.share ? pick(rng, LOOK_ROUTE) : "nearest",
        delayPattern: teaching || k.delay === "burst" ? "stagger" : pick(rng, LOOK_DELAY),
        speedPattern: teaching ? "even" : pick(rng, LOOK_SPEED),
    };
}

/** Compact fingerprint of a look, used to guarantee adjacent levels differ. */
function lookSignature(look) {
    const bucket = Math.round(look.fanDeg / 40);
    return `${look.distPattern}|${look.radiusProfile}|${bucket}|${look.routePattern}|${look.delayPattern}|${look.speedPattern}`;
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
};

// Chokepoints must stay clearly OUTSIDE the payload's VISIBLE art. The banana
// png is 800x436 with visible art ~266x393 (transparent margins), drawn at
// targetHeight 150 → visible ~91x135 world px (half-width ~46, half-height ~68).
// 150px keeps a clear run of wick between the bend and the banana.
const PAYLOAD_CLEARANCE = 150;

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
        (routed[f.routeThrough] ??= []).push({ start: sMap[f.start], end: bomb });
    }
    // Direct fuses' cut points: the midpoint of their spawn->bomb segment.
    const directMidpoints = [];
    for (const f of level.fuses) {
        if (f.routeThrough) continue;
        directMidpoints.push({ x: (sMap[f.start].x + bomb.x) / 2, y: (sMap[f.start].y + bomb.y) / 2 });
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
        const u = projectionU(sMap[f.start], bomb, I);
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

    // No wick may fold (spark reversal).
    for (const f of fuses) {
        if (!f.routeThrough) continue;
        const u = projectionU(sMap[f.start], payload, iMap[f.routeThrough]);
        if (u < FOLD_THRESHOLD || u > 1 - FOLD_THRESHOLD) return { ok: false, reason: `fold on ${f.start}` };
    }
    // Chokepoints must sit clear of the payload's visible art.
    for (const c of intersections) {
        if (Math.hypot(c.x - payload.x, c.y - payload.y) < PAYLOAD_CLEARANCE) return { ok: false, reason: "chokepoint under payload" };
    }
    // Every cut point (chokepoint or direct-fuse midpoint) must be separately placeable.
    const pts = intersections.slice();
    for (const f of fuses) {
        if (f.routeThrough) continue;
        pts.push({ x: (sMap[f.start].x + payload.x) / 2, y: (sMap[f.start].y + payload.y) / 2 });
    }
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 1; j < pts.length; j++) {
            if (Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y) < CUT_SEPARATION) return { ok: false, reason: "cut points too close" };
        }
    }
    return { ok: true };
}

/** Assign a layout archetype deterministically, varying it across the ladder.
 *  Single-shared-chokepoint levels need the spawns on ONE side of the bomb
 *  (hub/offset/train) — in split/weave the spawns flank the bomb, so no single
 *  point can sit fold-free between every spawn and the bomb. */
function styleForLevel(n, k) {
    if (n <= 3) return "hub"; // teach swipe-to-cut on the familiar sunburst
    const act = Math.ceil(n / 20);
    const sharedSingle = k.share && k.chokepoints === 1;
    const pool = sharedSingle
        ? ["hub", "offset", "train"]
        : act >= 2
            ? ["hub", "offset", "train", "split", "weave"]
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

function placeLevel(n, k, seedOffset = 0, salt = 0) {
    const rng = makeRng(1000 + n * 137 + seedOffset * 7919);
    const look = lookForLevel(n, k, seedOffset, salt);
    const style = styleForLevel(n, k);
    const { payload, spawns, intersections } = PLACEMENTS[style](n, k, rng, look);

    // Fuses: route spawns through chokepoints (shared vs grouped vs partial).
    const fuses = spawns.map((s, i) => {
        const routeThrough = routeFor(i, s, k, look, intersections, rng);
        return {
            start: s.id,
            ...(routeThrough ? { routeThrough } : {}),
            end: PAYLOAD_ID,
            speed: speedFor(k, i, look, rng),
            delayFrames: delayFor(k, i, k.spawns, look, rng),
        };
    });

    return { payload, spawns, intersections, fuses, k, style, look };
}

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
        let validation = { ok: false };
        for (let salt = 0; salt < 8 && !placed; salt++) {
            for (let seed = 0; seed < 12; seed++) {
                const p = placeLevel(n, k, seed, salt);
                // Remove folds/overlaps so no wick doubles back on itself and no
                // chokepoint hides under the payload. Runs before snips are computed
                // (a fuse may be un-routed by the safety net, changing min cuts).
                deHairpin({ payload: p.payload, spawns: p.spawns, intersections: p.intersections, fuses: p.fuses });
                const v = validatePlacement(p);
                if (!v.ok) continue;
                if (lookSignature(p.look) === prevSig) continue; // visually identical to last level → new look
                placed = p;
                validation = v;
                break;
            }
        }
        if (!placed) {
            console.error(`  ! L${n}: no clean distinct placement found (last: ${validation.reason})`);
            placed = placeLevel(n, k, 0, 0);
            deHairpin({ payload: placed.payload, spawns: placed.spawns, intersections: placed.intersections, fuses: placed.fuses });
        }
        const { payload, spawns, intersections, fuses, style, look } = placed;
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
            payload,
            spawns,
            intersections,
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
