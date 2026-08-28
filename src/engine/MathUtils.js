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
