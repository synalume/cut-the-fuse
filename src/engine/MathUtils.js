// MathUtils.js — pure math extracted from the prototype HTML.
// Bezier sampling, forced-intersection control points, and segment distance.

/** Sample a cubic Bezier at parameter t (0..1). Exact prototype formula. */
export function getBezierXY(t, p0, cp1, cp2, p3) {
    const cx = 3 * (cp1.x - p0.x);
    const bx = 3 * (cp2.x - cp1.x) - cx;
    const ax = p3.x - p0.x - cx - bx;
    const cy = 3 * (cp1.y - p0.y);
    const by = 3 * (cp2.y - cp1.y) - cy;
    const ay = p3.y - p0.y - cy - by;

    const x = (ax * Math.pow(t, 3)) + (bx * Math.pow(t, 2)) + (cx * t) + p0.x;
    const y = (ay * Math.pow(t, 3)) + (by * Math.pow(t, 2)) + (cy * t) + p0.y;
    return { x, y };
}

/** Distance from point p to the line segment (v, w). Used for swipe detection. */
export function distToSegment(p, v, w) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}

/** Unit tangent (derivative direction) of a cubic Bezier at parameter t. */
export function getBezierTangent(t, p0, cp1, cp2, p3) {
    const cx = 3 * (cp1.x - p0.x);
    const bx = 3 * (cp2.x - cp1.x) - cx;
    const ax = p3.x - p0.x - cx - bx;
    const cy = 3 * (cp1.y - p0.y);
    const by = 3 * (cp2.y - cp1.y) - cy;
    const ay = p3.y - p0.y - cy - by;
    const tx = 3 * ax * t * t + 2 * bx * t + cx;
    const ty = 3 * ay * t * t + 2 * by * t + cy;
    const len = Math.hypot(tx, ty) || 1;
    return { x: tx / len, y: ty / len };
}

/**
 * Closest point on a cubic Bezier to a target position, by sampling.
 * Returns { dist, point }.
 */
export function getClosestPointOnBezier(target, p0, cp1, cp2, p3, samples = 50) {
    let minDist = Infinity;
    let closestPt = null;
    for (let i = 0; i <= samples; i++) {
        const pt = getBezierXY(i / samples, p0, cp1, cp2, p3);
        const dist = Math.hypot(pt.x - target.x, pt.y - target.y);
        if (dist < minDist) {
            minDist = dist;
            closestPt = pt;
        }
    }
    return { dist: minDist, point: closestPt };
}

/**
 * Build a fuse whose cubic Bezier passes EXACTLY through intersectionPt.
 * Derived from the prototype: a single shared control point, scaled so the
 * curve lands on the chokepoint at t=0.5.
 *   B(0.5) = (p0 + 3*cp + 3*cp + p3) / 8 = (p0 + p3 + 6*cp) / 8
 *   => cp = (intersection - (p0 + p3) * 0.125) / 0.75
 *
 * `bulge` (default 0) splits the control points perpendicular to the chord
 * (cp1 = M + perp·d, cp2 = M - perp·d) so the curve still passes exactly
 * through the intersection at t=0.5 — B(0.5) depends only on (cp1+cp2)/2 = M —
 * but the arc's SHAPE changes (one-sided bow / alternating weave). Perpendicular
 * offsets keep both control points on the same fold-free slab as M.
 */
export function createForcedIntersectionFuse(id, startNode, endNode, intersectionPt, bulge = 0) {
    const p0 = startNode;
    const p3 = endNode;
    const mX = (intersectionPt.x - 0.125 * (p0.x + p3.x)) / 0.75;
    const mY = (intersectionPt.y - 0.125 * (p0.y + p3.y)) / 0.75;

    if (!bulge) {
        return {
            id,
            start: startNode.id,
            end: endNode.id,
            cp1: { x: mX, y: mY },
            cp2: { x: mX, y: mY },
            burntProgress: 0,
            intersectionPt: { x: intersectionPt.x, y: intersectionPt.y },
        };
    }

    const wx = p3.x - p0.x, wy = p3.y - p0.y;
    const L = Math.hypot(wx, wy) || 1;
    const d = bulge * L;
    // Unit perpendicular to the chord.
    const perpX = -wy / L, perpY = wx / L;
    return {
        id,
        start: startNode.id,
        end: endNode.id,
        cp1: { x: mX + perpX * d, y: mY + perpY * d },
        cp2: { x: mX - perpX * d, y: mY - perpY * d },
        burntProgress: 0,
        intersectionPt: { x: intersectionPt.x, y: intersectionPt.y },
    };
}

export function clamp(v, min, max) {
    return Math.max(min, Math.min(max, v));
}

/** Approximate arc length of a Bezier by sampling. Used by the generator/validator. */
export function bezierLength(p0, cp1, cp2, p3, steps = 24) {
    let len = 0;
    let prev = p0;
    for (let i = 1; i <= steps; i++) {
        const pt = getBezierXY(i / steps, p0, cp1, cp2, p3);
        len += Math.hypot(pt.x - prev.x, pt.y - prev.y);
        prev = pt;
    }
    return len;
}

// ---- Multi-bend wick paths -------------------------------------------------
//
// A fuse is normally a single forced-intersection cubic. The multi-bend
// shapes ("s", "wave") replace it with 2-3 connected cubics that stay C1-smooth
// and still pass EXACTLY through the routed intersection (the crossing the
// player cuts), so cutting rules are unchanged — only the silhouette bends.
// Every segment keeps its endpoints as explicit junction points so spark
// position, cut distance, and rendering sample one identical path.

/** Unit bisector of two leg directions (falls back to the chord when the legs
 *  point at each other, which deHairpin already prevents in practice). */
function _bisector(ax, ay, bx, by) {
    let tx = ax + bx, ty = ay + by;
    let tl = Math.hypot(tx, ty);
    if (tl < 1e-3) { tx = ax - by; ty = ay + bx; tl = Math.hypot(tx, ty) || 1; }
    return { x: tx / tl, y: ty / tl };
}

/**
 * Deterministic multi-segment shape for a fuse. Returns the stored-path form
 * `[{ cp1, cp2, end }, ...]` (first segment starts at `start`, each next at the
 * previous `end`, final `end` == `end`) or null to keep the classic single
 * forced-intersection cubic. Both the generator and the runtime call this with
 * the same inputs, so the emitted geometry and the drawn wire always agree.
 *
 * "s"    — two cubics joined at the routed intersection, bowed on opposite
 *          legs for a smooth S that still crosses the chokepoint exactly.
 * "wave" — three cubics: an extra mid-junction on the first leg adds a second
 *          wiggle before the S tail.
 */
export function buildShapedPath(start, end, intersection, bulge, shape) {
    if (shape !== "s" && shape !== "wave") return null;
    const p0 = start, p3 = end;
    const I = intersection || { x: (p0.x + p3.x) / 2, y: (p0.y + p3.y) / 2 };
    const v1 = { x: I.x - p0.x, y: I.y - p0.y };
    const v2 = { x: p3.x - I.x, y: p3.y - I.y };
    const L1 = Math.hypot(v1.x, v1.y);
    const L2 = Math.hypot(v2.x, v2.y);
    if (L1 < 1 || L2 < 1) return null; // degenerate leg — keep the classic arc

    const d1 = { x: v1.x / L1, y: v1.y / L1 };
    const d2 = { x: v2.x / L2, y: v2.y / L2 };
    const tJ = _bisector(d1.x, d1.y, d2.x, d2.y); // junction tangent at the intersection
    const perp = { x: -tJ.y, y: tJ.x };

    // Twist sign from a pure-geometry hash so generator + runtime agree with no
    // shared RNG: twice the signed area of the p0-I-p3 triangle.
    const sgn = (I.x - p0.x) * (p3.y - p0.y) - (I.y - p0.y) * (p3.x - p0.x) >= 0 ? 1 : -1;
    const b = clamp(Math.abs(bulge || 0) * 1.5, 0.05, 0.13) * sgn;

    const bend = (mag) => ({ x: perp.x * mag, y: perp.y * mag });

    if (shape === "s") {
        const o1 = bend(b * L1), o2 = bend(b * L2);
        return [
            { cp1: { x: p0.x + tJ.x * (L1 / 3) + o1.x, y: p0.y + tJ.y * (L1 / 3) + o1.y },
              cp2: { x: I.x - tJ.x * (L1 / 3), y: I.y - tJ.y * (L1 / 3) },
              end: { x: I.x, y: I.y } },
            { cp1: { x: I.x + tJ.x * (L2 / 3), y: I.y + tJ.y * (L2 / 3) },
              cp2: { x: p3.x - tJ.x * (L2 / 3) - o2.x, y: p3.y - tJ.y * (L2 / 3) - o2.y },
              end: { x: p3.x, y: p3.y } },
        ];
    }

    // "wave": add a mid-junction on the first leg for a second wiggle.
    const w = 0.36; // junction sits 36% along p0→I
    const J1x = p0.x + v1.x * w, J1y = p0.y + v1.y * w;
    const vw1 = { x: J1x - p0.x, y: J1y - p0.y };
    const vw2 = { x: I.x - J1x, y: I.y - J1y };
    const Lw1 = Math.hypot(vw1.x, vw1.y) || 1;
    const Lw2 = Math.hypot(vw2.x, vw2.y) || 1;
    const tW = _bisector(vw1.x / Lw1, vw1.y / Lw1, vw2.x / Lw2, vw2.y / Lw2);
    const bw = clamp(Math.abs(bulge || 0) * 1.1, 0.04, 0.11) * sgn;
    const oW = bend(bw * Lw1), oW2 = bend(bw * Lw2);
    return [
        { cp1: { x: p0.x + tW.x * (Lw1 / 3) + oW.x, y: p0.y + tW.y * (Lw1 / 3) + oW.y },
          cp2: { x: J1x - tW.x * (Lw1 / 3), y: J1y - tW.y * (Lw1 / 3) },
          end: { x: J1x, y: J1y } },
        { cp1: { x: J1x + tW.x * (Lw2 / 3), y: J1y + tW.y * (Lw2 / 3) },
          cp2: { x: I.x - tJ.x * (Lw2 / 3) + oW2.x, y: I.y - tJ.y * (Lw2 / 3) + oW2.y },
          end: { x: I.x, y: I.y } },
        { cp1: { x: I.x + tJ.x * (L2 / 3), y: I.y + tJ.y * (L2 / 3) },
          cp2: { x: p3.x - tJ.x * (L2 / 3) - bend(b * L2).x, y: p3.y - tJ.y * (L2 / 3) - bend(b * L2).y },
          end: { x: p3.x, y: p3.y } },
    ];
}

/** The cubic segments of a fuse in drawing order: `[{ p0, cp1, cp2, p3 }]`.
 *  Uses the runtime cache (`fuse._segs`) when present, else a stored
 *  multi-segment `fuse.path`, else the classic single forced-intersection
 *  cubic. */
export function fusePathSegments(fuse) {
    if (fuse._segs && fuse._segs.length) return fuse._segs;
    const p0 = fuse.startNode, p3 = fuse.endNode;
    if (Array.isArray(fuse.path) && fuse.path.length) {
        const segs = [];
        let prev = p0;
        for (const s of fuse.path) {
            segs.push({ p0: prev, cp1: s.cp1, cp2: s.cp2, p3: s.end });
            prev = s.end;
        }
        return segs;
    }
    return [{ p0, cp1: fuse.cp1, cp2: fuse.cp2, p3 }];
}

function _fuseCache(fuse) {
    if (fuse._segs && fuse._lens) return [fuse._segs, fuse._lens];
    const segs = fusePathSegments(fuse);
    const lens = segs.map((s) => bezierLength(s.p0, s.cp1, s.cp2, s.p3));
    if (!fuse._segs) fuse._segs = segs;
    if (!fuse._lens) fuse._lens = lens;
    return [segs, lens];
}

/** Total arc length of a fuse's path. */
export function fuseLength(fuse) {
    const [, lens] = _fuseCache(fuse);
    return lens.reduce((a, b) => a + b, 0);
}

/** Point on a fuse at global parameter t∈[0,1]. t maps across segments by arc
 *  length, so the spark keeps a near-constant ground speed on bended wicks. */
export function fusePoint(fuse, t) {
    t = Math.max(0, Math.min(1, t));
    const [segs, lens] = _fuseCache(fuse);
    let total = 0;
    for (const L of lens) total += L;
    if (total <= 0) return getBezierXY(0, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
    let target = t * total;
    for (let i = 0; i < segs.length; i++) {
        const L = lens[i];
        if (target <= L || i === segs.length - 1) {
            const u = L > 0 ? Math.min(1, Math.max(0, target / L)) : (segs.length === 1 ? t : 0);
            return getBezierXY(u, segs[i].p0, segs[i].cp1, segs[i].cp2, segs[i].p3);
        }
        target -= L;
    }
    const last = segs[segs.length - 1];
    return getBezierXY(1, last.p0, last.cp1, last.cp2, last.p3);
}

/** Unit tangent of a fuse's path at global parameter t. */
export function fuseTangent(fuse, t) {
    t = Math.max(0, Math.min(1, t));
    const [segs, lens] = _fuseCache(fuse);
    let total = 0;
    for (const L of lens) total += L;
    if (total <= 0) return getBezierTangent(0, fuse.startNode, fuse.cp1, fuse.cp2, fuse.endNode);
    let target = t * total;
    for (let i = 0; i < segs.length; i++) {
        const L = lens[i];
        if (target <= L || i === segs.length - 1) {
            const u = L > 0 ? Math.min(1, Math.max(0, target / L)) : (segs.length === 1 ? t : 0);
            return getBezierTangent(u, segs[i].p0, segs[i].cp1, segs[i].cp2, segs[i].p3);
        }
        target -= L;
    }
    const last = segs[segs.length - 1];
    return getBezierTangent(1, last.p0, last.cp1, last.cp2, last.p3);
}

/** Nearest { t, dist } on a fuse's path to a point, by sampling. The default
 *  matches the classic 0.02-parameter sweep (~51 steps) so a near-end cut on a
 *  curvy wick is never missed; multi-segment wicks are sampled per segment. */
export function fuseClosest(fuse, x, y, samples = 50) {
    const [segs, lens] = _fuseCache(fuse);
    let total = 0;
    for (const L of lens) total += L;
    let bestT = 0, bestD = Infinity;
    let acc = 0;
    for (let i = 0; i < segs.length; i++) {
        const s = segs[i], L = lens[i];
        for (let k = 0; k <= samples; k++) {
            const u = k / samples;
            const pt = getBezierXY(u, s.p0, s.cp1, s.cp2, s.p3);
            const d = Math.hypot(pt.x - x, pt.y - y);
            if (d < bestD) {
                bestD = d;
                bestT = total > 0 ? (acc + u * L) / total : u;
            }
        }
        acc += L;
    }
    return { t: bestT, dist: bestD };
}

/** Cheap self-intersection probe for a shaped path (sampled chords far apart
 *  in t that come within a whisker of each other). Returns the closest pair
 *  distance — the generator caps bend magnitude so this stays clear. */
export function shapedPathMinSelfDistance(start, end, intersection, bulge, shape) {
    const path = buildShapedPath(start, end, intersection, bulge, shape);
    if (!path) return Infinity;
    const segs = [];
    let prev = start;
    for (const s of path) {
        segs.push({ p0: prev, cp1: s.cp1, cp2: s.cp2, p3: s.end });
        prev = s.end;
    }
    const pts = [];
    for (const s of segs) {
        for (let u = 0; u <= 24; u += 1) pts.push(getBezierXY(u / 24, s.p0, s.cp1, s.cp2, s.p3));
    }
    let minD = Infinity;
    for (let i = 0; i < pts.length; i++) {
        for (let j = i + 6; j < pts.length; j++) { // skip adjacent samples
            const d = Math.hypot(pts[i].x - pts[j].x, pts[i].y - pts[j].y);
            if (d < minD) minD = d;
        }
    }
    return minD;
}
