// LevelManager.js — parses a levels.json config into the runtime node graph.
// Everything is data-driven: nodes, forced-intersection fuses, sparks, camera.
import { createForcedIntersectionFuse, getBezierXY } from "./MathUtils.js";
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

    return {
        payloadAssets: {
            playing: await pick(payload.playing, payloadSkin.assets.playing, PLACEHOLDER_PAYLOAD.playing),
            win: await pick(payload.win, payloadSkin.assets.win, PLACEHOLDER_PAYLOAD.win),
            lose: await pick(payload.lose, payloadSkin.assets.lose, PLACEHOLDER_PAYLOAD.lose),
        },
        spawnAssets: {
            idle: await pick(spawn.idle, igniter.assets.idle, PLACEHOLDER_SPAWN.idle),
            ignition: await pick(spawn.ignition, igniter.assets.ignition, PLACEHOLDER_SPAWN.ignition),
            dud: await pick(spawn.dud, igniter.assets.dud, PLACEHOLDER_SPAWN.dud),
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

    // Entry anchors (bomb-side landing points). Each wick ends at its OWN
    // anchor on a ring around the bomb art, so wicks enter from different
    // sides instead of funneling into the center. Type "entry": reaching one
    // triggers the explosion (GameLoop), but nothing is DRAWN here — the bomb
    // art lives at the real payload node only.
    for (const e of config.entries || []) {
        const node = {
            id: e.id,
            type: "entry",
            x: cx + (e.x ?? 0),
            y: cy + (e.y ?? 0),
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

    const resolveStart = (f, i) => {
        if (!f.branchOf) return { start: nodeMap[f.start], chain: null };
        const parentIdx = fuseIndexById.get(f.branchOf);
        const parentFuse = parentIdx != null ? fuses[parentIdx] : null;
        if (!parentFuse) return { start: null, chain: null };
        const at = f.at ?? 0.5;
        const P = getBezierXY(at, parentFuse.startNode, parentFuse.cp1, parentFuse.cp2, parentFuse.endNode);
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
        fuse.routeThrough = f.routeThrough || null;
        fuse.speed = f.speed ?? 0.001;
        fuse.delayFrames = f.delayFrames ?? 0;
        fuse.startNode = start;
        fuse.endNode = end;
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
        fuse.routeThrough = f.routeThrough || null;
        fuse.speed = f.speed ?? 0.001;
        fuse.delayFrames = f.delayFrames ?? 0;
        fuse.startNode = start;
        fuse.endNode = end;
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
    for (const e of config.entries || []) {
        if (!e.id) warnings.push(`level ${config.level_id}: entry missing id`);
        else if (ids.has(e.id)) warnings.push(`level ${config.level_id}: duplicate entry id '${e.id}'`);
        else {
            allIds.add(e.id);
            ids.add(e.id);
        }
    }
    const fuseIds = new Set((config.fuses || []).map((f, i) => f.id || `f${i}`));

    for (const f of config.fuses || []) {
        if (f.branchOf) {
            // Branch fuse: starts at the fork point ON its parent's wick.
            if (!fuseIds.has(f.branchOf)) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' branchOf '${f.branchOf}' unknown`);
            }
            if (typeof f.at !== "number" || f.at <= 0 || f.at >= 1) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' branch at must be in (0,1) (got ${f.at})`);
            }
            if (!allIds.has(f.end)) {
                warnings.push(`level ${config.level_id}: fuse '${f.id}' end '${f.end}' unknown`);
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
    [...(config.spawns || []), config.payload, ...(config.intersections || []), ...(config.entries || [])].forEach((n) => n && (nodeMap[n.id] = n));
    for (const f of config.fuses || []) {
        const start = nodeMap[f.start];
        if (!start) continue;
        const end = nodeMap[f.end] || config.payload;
        const I = nodeMap[f.routeThrough] || { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
        const wx = end.x - start.x, wy = end.y - start.y;
        const L2 = wx * wx + wy * wy;
        const cp = { x: (I.x - 0.125 * (start.x + end.x)) / 0.75, y: (I.y - 0.125 * (start.y + end.y)) / 0.75 };
        const u = ((cp.x - start.x) * wx + (cp.y - start.y) * wy) / L2;
        if (u < 0.02 || u > 0.98) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start}' folds (chokepoint projection u=${u.toFixed(2)} outside [0,1]) — wick will overlap itself and the spark will turn back`
            );
        }
    }

    // Timing guard: a spark must reach the payload slowly enough to be cut.
    // (Branch sparks have no timer — their delay is the parent's burn time.)
    for (const f of config.fuses || []) {
        const framesToPayload = (f.branchOf ? 0 : (f.delayFrames ?? 0)) + 1 / f.speed;
        if (framesToPayload < 90) {
            warnings.push(
                `level ${config.level_id}: fuse '${f.start || f.id}' reaches payload in ~${Math.round(framesToPayload)} frames (< 90) — may be un-cuttable`
            );
        }
    }

    return warnings;
}
