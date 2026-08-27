// LevelManager.js — parses a levels.json config into the runtime node graph.
// Everything is data-driven: nodes, forced-intersection fuses, sparks, camera.
import { createForcedIntersectionFuse } from "./MathUtils.js";

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
 *  Priority: explicit JSON assets > auto-derived lvl{N}_* > placeholder set.
 *
 *  Sync form (editor/tests): auto-derived names are always chosen when present,
 *  so it assumes the level's art exists. */
export function resolveAssetsSync(config) {
    const n = config.level_id;
    const payload = config.payload?.assets || {};
    const spawn = config.spawnAssets || {};

    const pick = (explicit, auto) => explicit || auto || null;

    const payloadAssets = {
        playing: pick(payload.playing, `lvl${n}_bomb_panic.png`) || PLACEHOLDER_PAYLOAD.playing,
        win: pick(payload.win, `lvl${n}_bomb_win.png`) || PLACEHOLDER_PAYLOAD.win,
        lose: pick(payload.lose, `lvl${n}_bomb_fail.png`) || PLACEHOLDER_PAYLOAD.lose,
    };
    const spawnAssets = {
        idle: pick(spawn.idle, `lvl${n}_matchstick_idle.png`) || PLACEHOLDER_SPAWN.idle,
        ignition: pick(spawn.ignition, `lvl${n}_matchstick_ignition.png`) || PLACEHOLDER_SPAWN.ignition,
        dud: pick(spawn.dud, `lvl${n}_matchstick_dud.png`) || PLACEHOLDER_SPAWN.dud,
    };
    return { payloadAssets, spawnAssets };
}

/** Live resolution for the running game. `hasFile(name) => Promise<boolean>`
 *  probes whether the level's own art file exists on disk; when it does not,
 *  the placeholder set is used. This keeps placeholder-first development working
 *  (banana bomb + matchstick on every level) until per-level art is generated. */
export async function resolveAssets(config, hasFile) {
    if (!hasFile) return resolveAssetsSync(config);
    const n = config.level_id;
    const payload = config.payload?.assets || {};
    const spawn = config.spawnAssets || {};

    const pick = async (explicit, auto, placeholder) => {
        if (explicit) return explicit;
        if (await hasFile(auto)) return auto;
        return placeholder;
    };

    return {
        payloadAssets: {
            playing: await pick(payload.playing, `lvl${n}_bomb_panic.png`, PLACEHOLDER_PAYLOAD.playing),
            win: await pick(payload.win, `lvl${n}_bomb_win.png`, PLACEHOLDER_PAYLOAD.win),
            lose: await pick(payload.lose, `lvl${n}_bomb_fail.png`, PLACEHOLDER_PAYLOAD.lose),
        },
        spawnAssets: {
            idle: await pick(spawn.idle, `lvl${n}_matchstick_idle.png`, PLACEHOLDER_SPAWN.idle),
            ignition: await pick(spawn.ignition, `lvl${n}_matchstick_ignition.png`, PLACEHOLDER_SPAWN.ignition),
            dud: await pick(spawn.dud, `lvl${n}_matchstick_dud.png`, PLACEHOLDER_SPAWN.dud),
        },
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

    // Payload node.
    const payloadNode = {
        id: config.payload.id || "bomb",
        type: "payload",
        x: cx + (config.payload.x ?? 0),
        y: cy + (config.payload.y ?? 0),
        assets: config.payload.assets || {},
    };
    nodes.push(payloadNode);
    nodeMap[payloadNode.id] = payloadNode;

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
    const fuses = [];
    const sparks = [];
    (config.fuses || []).forEach((f, i) => {
        const start = nodeMap[f.start];
        const end = nodeMap[f.end];
        const intersection = intersectionMap[f.routeThrough] || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };

        const fuse = createForcedIntersectionFuse(`f${i}`, start, end, intersection);
        fuse.routeThrough = f.routeThrough || null;
        fuse.speed = f.speed ?? 0.001;
        fuse.delayFrames = f.delayFrames ?? 0;
        fuse.startNode = start;
        fuse.endNode = end;
        fuses.push(fuse);

        sparks.push({
            fuseIndex: i,
            progress: 0,
            speed: fuse.speed,
            active: true,
            delay: fuse.delayFrames,
            ignitedAt: null,
            diedAt: null,
        });
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
        snipsAllowed: config.snipsAllowed ?? 2,
        payloadAssets: resolved.payloadAssets,
        spawnAssets: resolved.spawnAssets,
        tutorial: config.tutorial || null,
        dda: config.dda || { failThreshold: 3, tierSteps: ["snip", "slow", "hint"] },
        camera: config.camera ? { ...config.camera } : null,
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
    if (config.payload?.id) allIds.add(config.payload.id);

    for (const f of config.fuses || []) {
        if (!allIds.has(f.start)) warnings.push(`level ${config.level_id}: fuse start '${f.start}' unknown`);
        if (!allIds.has(f.end)) warnings.push(`level ${config.level_id}: fuse end '${f.end}' unknown`);
        if (f.routeThrough && !ids.has(f.routeThrough)) {
            warnings.push(`level ${config.level_id}: fuse routeThrough '${f.routeThrough}' unknown`);
        }
        if (f.end !== config.payload?.id) {
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
    // (looks like the wick ends early / turns around).
    const nodeMap = {};
    [...(config.spawns || []), config.payload, ...(config.intersections || [])].forEach((n) => n && (nodeMap[n.id] = n));
    for (const f of config.fuses || []) {
        const start = nodeMap[f.start];
        if (!start) continue;
        const I = nodeMap[f.routeThrough] || { x: (start.x + config.payload.x) / 2, y: (start.y + config.payload.y) / 2 };
        const wx = config.payload.x - start.x, wy = config.payload.y - start.y;
        const L2 = wx * wx + wy * wy;
        const cp = { x: (I.x - 0.125 * (start.x + config.payload.x)) / 0.75, y: (I.y - 0.125 * (start.y + config.payload.y)) / 0.75 };
        const u = ((cp.x - start.x) * wx + (cp.y - start.y) * wy) / L2;
        if (u < 0.02 || u > 0.98) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start}' folds (chokepoint projection u=${u.toFixed(2)} outside [0,1]) — wick will overlap itself and the spark will turn back`
            );
        }
    }

    // Timing guard: a spark must reach the payload slowly enough to be cut.
    for (const f of config.fuses || []) {
        const framesToPayload = (f.delayFrames ?? 0) + 1 / f.speed;
        if (framesToPayload < 90) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start}' reaches payload in ~${Math.round(framesToPayload)} frames (< 90) — may be un-cuttable`
            );
        }
    }

    return warnings;
}
