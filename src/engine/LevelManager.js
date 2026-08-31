// LevelManager.js — parses a levels.json config into the runtime node graph.
// Everything is data-driven: nodes, forced-intersection fuses, sparks, camera.
import { createForcedIntersectionFuse, buildShapedPath, fusePoint, shapedPathMinSelfDistance, bezierLength as bezierLen } from "./MathUtils.js";
import { findPayloadSkin, findIgniterType } from "../data/skins.js";

const PLACEHOLDER_PAYLOAD = {
    playing: "lvl1_banana_panic.png",
    win: "lvl1_banana_win.png",
    lose: "lvl1_banana_fail.png",
};
const PLACEHOLDER_SPAWN = {
    idle: "lvl1_matchstick_idle.png",
    ignition: "lvl1_matchstick_ignition.png",
    dud: "lvl1_matchstick_dud.png",
};

/** Resolve which asset files a level should draw, with placeholder fallback.
 *
 *  Live form (async, probing): priority is explicit level-pinned JSON assets >
 *  the player's loadout skin art (probed with hasFile) > placeholder set. The
 *  loadout lets players switch characters/igniters without per-level art.
 *
 *  Sync form (editor/tests, no probing): explicit JSON assets > placeholder. */
export function resolveAssetsSync(config, loadout = null) {
    const payloadSkin = findPayloadSkin(loadout?.payloadSkin);
    const igniter = findIgniterType(loadout?.igniter);
    const payload = config.payload?.assets || {};
    const spawn = config.spawnAssets || {};

    // Sync path can't probe disk, so loadout art is only used if a file name is
    // known-good (defaults always are). Non-default skins resolve to their art
    // in the editor; runtime uses the async probing path.
    const pick = (explicit, fallback) => explicit || fallback;

    const payloadAssets = {
        playing: pick(payload.playing, payloadSkin.assets.playing) || PLACEHOLDER_PAYLOAD.playing,
        win: pick(payload.win, payloadSkin.assets.win) || PLACEHOLDER_PAYLOAD.win,
        lose: pick(payload.lose, payloadSkin.assets.lose) || PLACEHOLDER_PAYLOAD.lose,
    };
    const spawnAssets = {
        idle: pick(spawn.idle, igniter.assets.idle) || PLACEHOLDER_SPAWN.idle,
        ignition: pick(spawn.ignition, igniter.assets.ignition) || PLACEHOLDER_SPAWN.ignition,
        dud: pick(spawn.dud, igniter.assets.dud) || PLACEHOLDER_SPAWN.dud,
    };
    return { payloadAssets, spawnAssets };
}

/** Live resolution for the running game. `hasFile(name) => Promise<boolean>`
 *  probes whether an art file exists on disk; missing files fall back to the
 *  placeholder set. Priority: explicit level-pinned JSON assets > the player's
 *  loadout (payload skin + igniter) art > placeholder. */
export async function resolveAssets(config, hasFile, loadout = {}) {
    if (!hasFile) return resolveAssetsSync(config, loadout);
    const payloadSkin = findPayloadSkin(loadout.payloadSkin);
    const igniter = findIgniterType(loadout.igniter);
    const payload = config.payload?.assets || {};
    const spawn = config.spawnAssets || {};

    const pick = async (explicit, skinFile, placeholder) => {
        if (explicit) return explicit;
        if (await hasFile(skinFile)) return skinFile;
        return placeholder;
    };

    // Probe in parallel — the first level of a session pays one round-trip for
    // all six art files instead of six sequential downloads (which can stall
    // first-load for seconds on slow connections).
    const [playing, win, lose, idle, ignition, dud] = await Promise.all([
        pick(payload.playing, payloadSkin.assets.playing, PLACEHOLDER_PAYLOAD.playing),
        pick(payload.win, payloadSkin.assets.win, PLACEHOLDER_PAYLOAD.win),
        pick(payload.lose, payloadSkin.assets.lose, PLACEHOLDER_PAYLOAD.lose),
        pick(spawn.idle, igniter.assets.idle, PLACEHOLDER_SPAWN.idle),
        pick(spawn.ignition, igniter.assets.ignition, PLACEHOLDER_SPAWN.ignition),
        pick(spawn.dud, igniter.assets.dud, PLACEHOLDER_SPAWN.dud),
    ]);

    return {
        payloadAssets: { playing, win, lose },
        spawnAssets: { idle, ignition, dud },
    };
}

/** Build the runtime level from a JSON config. Coordinates are center-offsets,
 *  exactly like the prototype's initLevel() (cx + x, cy + y). */
export function buildLevel(config, viewport, assets = null) {
    const cx = viewport.width / 2;
    const cy = viewport.height / 2;

    const nodes = [];
    const nodeMap = {};
    const intersectionMap = {};

    // Payload node(s). Twin-bomb levels carry a `payloads` array (each fuse
    // ends at one of them); every other level keeps the single `payload`.
    const payloadNodes = [];
    if (Array.isArray(config.payloads) && config.payloads.length) {
        for (const p of config.payloads) {
            payloadNodes.push({
                id: p.id || "bomb",
                type: "payload",
                x: cx + (p.x ?? 0),
                y: cy + (p.y ?? 0),
                assets: config.payload?.assets || p.assets || {},
            });
        }
    } else {
        payloadNodes.push({
            id: config.payload.id || "bomb",
            type: "payload",
            x: cx + (config.payload.x ?? 0),
            y: cy + (config.payload.y ?? 0),
            assets: config.payload.assets || {},
        });
    }
    for (const payloadNode of payloadNodes) {
        nodes.push(payloadNode);
        nodeMap[payloadNode.id] = payloadNode;
    }

    // Spawn nodes.
    for (const s of config.spawns || []) {
        const node = {
            id: s.id,
            type: "spawn",
            x: cx + (s.x ?? 0),
            y: cy + (s.y ?? 0),
        };
        nodes.push(node);
        nodeMap[node.id] = node;
    }

    // Intersections (chokepoints the fuses route through).
    for (const it of config.intersections || []) {
        intersectionMap[it.id] = { id: it.id, x: cx + (it.x ?? 0), y: cy + (it.y ?? 0) };
    }

    // Fuses + sparks.
    // Branch fuses (chain ignition) start AT a fork point ON their parent's
    // wick, so they're resolved in two passes: spawn-rooted fuses first, then
    // branches once every parent's geometry exists. The generator emits parents
    // before branches; this ordering also keeps hand-authored JSON safe.
    const fuses = [];
    const sparks = [];
    const fuseIndexById = new Map((config.fuses || []).map((f, i) => [f.id || `f${i}`, i]));

    /** Attach a multi-bend shape to a runtime fuse when the config asks for one
     *  (generator emits `shape` for the wiggled wicks). The path is built from
     *  the same inputs the generator used, so the drawn wire and every sampled
     *  cut/distance/position agree byte-for-byte. */
    const finalizeFuseShape = (fuse, cf, start, end, intersection) => {
        if (cf.shape) {
            fuse.shape = cf.shape;
            fuse.path = buildShapedPath(start, end, intersection, cf.bulge ?? 0, cf.shape);
            if (fuse.path) {
                fuse._segs = [];
                let prev = start;
                for (const s of fuse.path) {
                    fuse._segs.push({ p0: prev, cp1: s.cp1, cp2: s.cp2, p3: s.end });
                    prev = s.end;
                }
                fuse._lens = fuse._segs.map((s) =>
                    bezierLen(s.p0, s.cp1, s.cp2, s.p3));
                // Keep cp1/cp2 = first segment's controls so any legacy sampler
                // still points at the wire's start bow rather than the air.
                fuse.cp1 = fuse.path[0].cp1;
                fuse.cp2 = fuse.path[0].cp2;
            }
        }
    };

    const resolveStart = (f, i) => {
        if (!f.branchOf) return { start: nodeMap[f.start], chain: null };
        const parentIdx = fuseIndexById.get(f.branchOf);
        const parentFuse = parentIdx != null ? fuses[parentIdx] : null;
        if (!parentFuse) return { start: null, chain: null };
        const at = f.at ?? 0.5;
        const P = fusePoint(parentFuse, at);
        // A synthetic "branch" node — the fork. It is NOT a spawn, so no
        // matchstick is drawn there and the new spark appears at the fork.
        const node = {
            id: `${f.id || `f${i}`}-start`,
            type: "branch",
            x: P.x,
            y: P.y,
            parentFuseIndex: parentIdx,
            at,
        };
        nodes.push(node);
        return { start: node, chain: { fromFuseIndex: parentIdx, at } };
    };

    // Pass 1: spawn-rooted fuses.
    (config.fuses || []).forEach((f, i) => {
        if (f.branchOf) return;
        const { start } = resolveStart(f, i);
        if (!start) return;
        const end = nodeMap[f.end];
        const intersection = intersectionMap[f.routeThrough] || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

        const fuse = createForcedIntersectionFuse(f.id || `f${i}`, start, end, intersection, f.bulge ?? 0);
        finalizeFuseShape(fuse, f, start, end, intersection);
        fuse.routeThrough = f.routeThrough || null;
        fuse.speed = f.speed ?? 0.001;
        fuse.delayFrames = f.delayFrames ?? 0;
        fuse.startNode = start;
        fuse.endNode = end;
        fuse.color = f.color || null;
        fuse.neverLights = !!f.neverLights;
        fuse.hits = 0;
        fuses[i] = fuse;
    });

    // Pass 2: branch fuses — a new wick that splits off the parent's wick.
    (config.fuses || []).forEach((f, i) => {
        if (!f.branchOf) return;
        const { start, chain } = resolveStart(f, i);
        if (!start) return;
        const end = nodeMap[f.end];
        const intersection = intersectionMap[f.routeThrough] || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

        const fuse = createForcedIntersectionFuse(f.id || `f${i}`, start, end, intersection, f.bulge ?? 0);
        finalizeFuseShape(fuse, f, start, end, intersection);
        fuse.routeThrough = f.routeThrough || null;
        fuse.speed = f.speed ?? 0.001;
        fuse.delayFrames = f.delayFrames ?? 0;
        fuse.startNode = start;
        fuse.endNode = end;
        fuse.color = f.color || null;
        fuse.neverLights = !!f.neverLights;
        fuse.hits = 0;
        fuses[i] = fuse;
    });

    (config.fuses || []).forEach((f, i) => {
        const fuse = fuses[i];
        const chain = f.branchOf
            ? fuseIndexById.has(f.branchOf)
                ? { fromFuseIndex: fuseIndexById.get(f.branchOf), at: f.at ?? 0.5 }
                : null
            : null;
        sparks.push({
            fuseIndex: i,
            progress: 0,
            speed: fuse.speed,
            active: true,
            delay: chain ? 99999 : fuse.delayFrames,
            ignitedAt: null,
            diedAt: null,
            chain,
            triggered: false,
            // Forbidden decoy wires never light — their spark stays dark forever
            // (drawn colored, never burning). Skipped by the sim and the win check.
            decoy: !!fuse.neverLights,
            doused: false,
        });
    });

    // Sticky wicks: a fuse that crosses a cross-section (routed chokepoint or
    // fork) can't be cut before that junction — cutting the sticky zone snaps
    // back (denied, snip refunded) so the spark always reaches the maze.
    // Poisoned crossroads are exempt: a chokepoint shared with a forbidden
    // wire can only be severed upstream on each safe leg, so sticky would make
    // those levels unwinnable.
    {
        const wr = config.wireRule || null;
        const isForb = (f) => !!(wr && f.color && wr.legend[f.color] === "no");
        const poisoned = new Set();
        if (wr) {
            const byCp = new Map();
            for (const f of config.fuses || []) {
                if (!f.routeThrough) continue;
                if (!byCp.has(f.routeThrough)) byCp.set(f.routeThrough, []);
                byCp.get(f.routeThrough).push(f);
            }
            for (const grp of byCp.values()) {
                if (grp.some(isForb)) for (const f of grp) poisoned.add(f.id);
            }
        }
        // Global parameter where a fuse passes closest to its routed chokepoint.
        const tAtPoint = (fuse, x, y) => {
            let best = 1;
            let bestD = Infinity;
            for (let t = 0.005; t <= 1.0; t += 0.01) {
                const p = fusePoint(fuse, t);
                const d = (p.x - x) ** 2 + (p.y - y) ** 2;
                if (d < bestD) { bestD = d; best = t; }
            }
            return best;
        };
        (config.fuses || []).forEach((f) => {
            const fuse = fuses[fuseIndexById.get(f.id)];
            if (!fuse || fuse.neverLights || poisoned.has(f.id)) return;
            let stickyT = 1;
            const I = intersectionMap[f.routeThrough];
            if (I) stickyT = Math.min(stickyT, tAtPoint(fuse, I.x, I.y));
            fuse.stickyT = stickyT < 1 ? stickyT : null;
        });
        // Fork parents are sticky from the fork point — earlier than their own
        // routed chokepoint — so the branch can't be starved by an early cut.
        for (const spark of sparks) {
            if (!spark.chain) continue;
            const parent = fuses[spark.chain.fromFuseIndex];
            if (!parent || parent.stickyT == null) continue;
            parent.stickyT = Math.min(parent.stickyT, spark.chain.at);
        }
    }

    // Pickups (gold bonus-snip stars) and douse points (water drops) resolve to
    // world positions on their fuse once all geometry exists.
    const pickups = (config.pickups || []).map((p, i) => {
        const fuseIndex = fuseIndexById.get(p.fuse);
        const fuse = fuseIndex != null ? fuses[fuseIndex] : null;
        const at = p.at ?? 0.5;
        const pos = fuse ? fusePoint(fuse, at) : { x: 0, y: 0 };
        return {
            id: p.id || `pickup${i}`,
            fuseId: p.fuse,
            fuseIndex,
            at,
            x: pos.x,
            y: pos.y,
            collected: false,
        };
    });
    const douse = (config.douse || []).map((d, i) => {
        const fuseIndex = fuseIndexById.get(d.fuse);
        return {
            id: d.id || `douse${i}`,
            fuseId: d.fuse,
            fuseIndex,
            at: d.at ?? 0.5,
        };
    });

    const resolved = assets ?? resolveAssetsSync(config);

    return {
        config,
        level_id: config.level_id,
        nodes,
        nodeMap,
        intersectionMap,
        fuses,
        sparks,
        payloads: payloadNodes,
        snipsAllowed: config.snipsAllowed ?? 2,
        payloadAssets: resolved.payloadAssets,
        spawnAssets: resolved.spawnAssets,
        tutorial: config.tutorial || null,
        dda: config.dda || { failThreshold: 3, tierSteps: ["snip", "slow", "hint"] },
        camera: config.camera ? { ...config.camera } : null,
        // New mechanics (all optional, data-driven):
        wireRule: config.wireRule || null,      // { legend: { red: "no", blue: "cut", ... } }
        pickups,                                 // [{ id, fuseId, fuseIndex, at, x, y, collected }]
        douse,                                   // [{ id, fuseId, fuseIndex, at }]
    };
}

/** Fit all nodes + intersections into the viewport. Returns a camera that
 *  keeps the whole level on screen (responsive requirement, no black bars).
 *
 *  Convention (prototype): the screen center maps to world (w/2 - camX, h/2 - camY),
 *  so to put the level center C at screen center we need camX = w/2 - C.x. */
export function computeFitCamera(level, viewport, padding = 160) {
    if (level.camera) return { x: level.camera.x ?? 0, y: level.camera.y ?? 0, zoom: level.camera.zoom ?? 1 };

    const pts = [];
    for (const n of level.nodes) pts.push({ x: n.x, y: n.y });
    for (const k in level.intersectionMap) {
        const it = level.intersectionMap[k];
        pts.push({ x: it.x, y: it.y });
    }

    const minX = Math.min(...pts.map((p) => p.x));
    const maxX = Math.max(...pts.map((p) => p.x));
    const minY = Math.min(...pts.map((p) => p.y));
    const maxY = Math.max(...pts.map((p) => p.y));

    const spanX = Math.max(1, maxX - minX + padding * 2);
    const spanY = Math.max(1, maxY - minY + padding * 2);

    const zoomX = viewport.width / spanX;
    const zoomY = viewport.height / spanY;
    let zoom = Math.min(zoomX, zoomY);
    zoom = Math.max(0.3, Math.min(2.5, zoom)); // clamp into the zoom range

    const centerX = (minX + maxX) / 2;
    const centerY = (minY + maxY) / 2;

    return {
        x: viewport.width / 2 - centerX,
        y: viewport.height / 2 - centerY,
        zoom,
    };
}

/** Structural validation. Returns an array of warning strings (empty = clean). */
export function validateLevel(config) {
    const warnings = [];
    const ids = new Set();

    if (!config.level_id) warnings.push(`level missing level_id`);
    if (!config.payload?.id) warnings.push(`level ${config.level_id}: payload missing id`);
    if (!Array.isArray(config.spawns) || config.spawns.length === 0) {
        warnings.push(`level ${config.level_id}: no spawns`);
    }
    if (!Array.isArray(config.fuses) || config.fuses.length === 0) {
        warnings.push(`level ${config.level_id}: no fuses`);
    }

    for (const n of config.spawns || []) {
        if (!n.id) warnings.push(`level ${config.level_id}: spawn missing id`);
        else if (ids.has(n.id)) warnings.push(`level ${config.level_id}: duplicate spawn id '${n.id}'`);
        else ids.add(n.id);
    }
    for (const it of config.intersections || []) {
        if (!it.id) warnings.push(`level ${config.level_id}: intersection missing id`);
        else if (ids.has(it.id)) warnings.push(`level ${config.level_id}: duplicate intersection id '${it.id}'`);
        else ids.add(it.id);
    }

    const allIds = new Set(ids);
    const payloadIds = new Set();
    if (config.payload?.id) { allIds.add(config.payload.id); payloadIds.add(config.payload.id); }
    for (const p of config.payloads || []) {
        if (!p.id) warnings.push(`level ${config.level_id}: payload missing id`);
        else { allIds.add(p.id); payloadIds.add(p.id); }
    }
    const fuseIds = new Set((config.fuses || []).map((f, i) => f.id || `f${i}`));

    // Color-coded wire rule: the legend must discriminate cut vs no, and every
    // colored fuse must appear in it. A forbidden fuse must be survivable
    // without cutting (never-lights decoy or a douse point on it) — otherwise
    // the level is unwinnable.
    const wireRule = config.wireRule || null;
    if (wireRule) {
        const legend = wireRule.legend || {};
        const colors = Object.keys(legend);
        if (!colors.length) warnings.push(`level ${config.level_id}: wireRule has an empty legend`);
        const forbiddenColors = colors.filter((c) => legend[c] === "no");
        if (!forbiddenColors.length) warnings.push(`level ${config.level_id}: wireRule legend has no forbidden color`);
        const safeColors = colors.filter((c) => legend[c] === "cut");
        if (!safeColors.length) warnings.push(`level ${config.level_id}: wireRule legend has no safe color`);
        const legendOk = (c) => c == null || legend[c] === "cut" || legend[c] === "no";
        const fuseWithColor = (config.fuses || []).filter((f) => f.color != null);
        if (fuseWithColor.length === 0) warnings.push(`level ${config.level_id}: wireRule present but no fuse has a color`);
        if (fuseWithColor.every((f) => legend[f.color] !== "no")) warnings.push(`level ${config.level_id}: wireRule present but no forbidden fuse`);
        for (const f of fuseWithColor) {
            if (!legendOk(f.color)) warnings.push(`level ${config.level_id}: fuse '${f.id}' color '${f.color}' not in legend`);
        }
    }
    const douseFuseIds = new Set((config.douse || []).map((d) => d.fuse));
    for (const f of config.fuses || []) {
        if (wireRule && wireRule.legend[f.color] === "no" && !f.neverLights && !douseFuseIds.has(f.id)) {
            warnings.push(`level ${config.level_id}: forbidden fuse '${f.id}' is neither a never-lights decoy nor doused (unwinnable)`);
        }
    }

    for (const p of config.pickups || []) {
        if (!fuseIds.has(p.fuse)) warnings.push(`level ${config.level_id}: pickup '${p.id}' fuse '${p.fuse}' unknown`);
        if (typeof p.at !== "number" || p.at <= 0 || p.at >= 1) warnings.push(`level ${config.level_id}: pickup '${p.id}' at must be in (0,1)`);
    }
    for (const d of config.douse || []) {
        if (!fuseIds.has(d.fuse)) warnings.push(`level ${config.level_id}: douse '${d.id}' fuse '${d.fuse}' unknown`);
        if (typeof d.at !== "number" || d.at <= 0 || d.at >= 1) warnings.push(`level ${config.level_id}: douse '${d.id}' at must be in (0,1)`);
    }

    for (const f of config.fuses || []) {
        if (f.branchOf) {
            // Branch fuse: starts at the fork point ON its parent's wick.
            if (!fuseIds.has(f.branchOf)) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' branchOf '${f.branchOf}' unknown`);
            }
            if (typeof f.at !== "number" || f.at <= 0 || f.at >= 1) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' branch at must be in (0,1) (got ${f.at})`);
            }
            if (!payloadIds.has(f.end)) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' does not end at the payload`);
            }
            if (typeof f.speed !== "number" || f.speed <= 0) {
                warnings.push(`level ${config.level_id}: fuse speed must be > 0 (got ${f.speed})`);
            }
            if (f.routeThrough && !ids.has(f.routeThrough)) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' branch routeThrough '${f.routeThrough}' unknown`);
            }
            continue;
        }
        if (!allIds.has(f.start)) warnings.push(`level ${config.level_id}: fuse start '${f.start}' unknown`);
        if (!allIds.has(f.end)) warnings.push(`level ${config.level_id}: fuse end '${f.end}' unknown`);
        if (f.routeThrough && !ids.has(f.routeThrough)) {
            warnings.push(`level ${config.level_id}: fuse routeThrough '${f.routeThrough}' unknown`);
        }
        if (!payloadIds.has(f.end)) {
            warnings.push(`level ${config.level_id}: fuse '${f.start}->${f.end}' does not end at the payload`);
        }
        if (typeof f.speed !== "number" || f.speed <= 0) {
            warnings.push(`level ${config.level_id}: fuse speed must be > 0 (got ${f.speed})`);
        }
    }

    if (typeof config.snipsAllowed !== "number" || config.snipsAllowed < 1) {
        warnings.push(`level ${config.level_id}: snipsAllowed must be >= 1`);
    }

    // Wick fold guard: with the single-control-point forced-intersection curve,
    // when a chokepoint's projection onto the spawn->payload chord leaves the
    // segment, the wick folds back on itself and the spark reverses mid-path
    // (looks like the wick ends early / turns around). Multi-bend wicks skip
    // that projection rule — their C1 junctions can't fold — but are probed
    // for self-intersection instead (generator caps bend magnitude so the
    // sampled self-distance stays well clear).
    const nodeMap = {};
    [...(config.spawns || []), config.payload, ...(config.payloads || []), ...(config.intersections || [])].forEach((n) => n && (nodeMap[n.id] = n));
    const payloadOf = (end) => (end === config.payload?.id || !config.payloads?.length ? config.payload : nodeMap[end]);
    for (const f of config.fuses || []) {
        const start = nodeMap[f.start];
        if (!start) continue;
        const endP = payloadOf(f.end) || config.payload;
        const I = nodeMap[f.routeThrough] || { x: (start.x + endP.x) / 2, y: (start.y + endP.y) / 2 };
        if (f.shape === "s" || f.shape === "wave") {
            const minSelf = shapedPathMinSelfDistance(start, endP, I, f.bulge ?? 0, f.shape);
            if (minSelf < 6) {
                warnings.push(
                    `level ${config.level_id}: fuse '${f.start}' shape '${f.shape}' nearly self-intersects (min self-distance ${minSelf.toFixed(1)}px)`
                );
            }
            continue;
        }
        const wx = endP.x - start.x, wy = endP.y - start.y;
        const L2 = wx * wx + wy * wy;
        const cp = { x: (I.x - 0.125 * (start.x + endP.x)) / 0.75, y: (I.y - 0.125 * (start.y + endP.y)) / 0.75 };
        const u = ((cp.x - start.x) * wx + (cp.y - start.y) * wy) / L2;
        if (u < 0.02 || u > 0.98) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start}' folds (chokepoint projection u=${u.toFixed(2)} outside [0,1]) — wick will overlap itself and the spark will turn back`
            );
        }
    }

    // Timing guard: a spark must reach the payload slowly enough to be cut.
    // (Branch sparks have no timer — their delay is the parent's burn time.
    // Never-lights decoys don't burn at all and are skipped.)
    for (const f of config.fuses || []) {
        if (f.neverLights) continue;
        const framesToPayload = (f.branchOf ? 0 : (f.delayFrames ?? 0)) + 1 / f.speed;
        if (framesToPayload < 90) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start || f.id}' reaches payload in ~${Math.round(framesToPayload)} frames (< 90) — may be un-cuttable`
            );
        }
    }

    return warnings;
}
