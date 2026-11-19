import polygonClipping, { type Polygon as PcPolygon } from 'polygon-clipping';
import type { Vec2 } from './types';

export const v = (x: number, y: number): Vec2 => ({ x, y });
export const add = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: Vec2, s: number): Vec2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: Vec2, b: Vec2) => a.x * b.x + a.y * b.y;
export const cross = (a: Vec2, b: Vec2) => a.x * b.y - a.y * b.x;
export const length = (a: Vec2) => Math.hypot(a.x, a.y);
export const dist = (a: Vec2, b: Vec2) => Math.hypot(a.x - b.x, a.y - b.y);
export const normalize = (a: Vec2): Vec2 => {
  const l = length(a);
  return l === 0 ? { x: 0, y: 0 } : { x: a.x / l, y: a.y / l };
};
/** Left-hand perpendicular (in a y-up frame). */
export const perp = (a: Vec2): Vec2 => ({ x: -a.y, y: a.x });

export const snap = (value: number, step: number) => (step > 0 ? Math.round(value / step) * step : value);

export function signedArea(pts: Vec2[]): number {
  let s = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    s += a.x * b.y - b.x * a.y;
  }
  return s / 2;
}

export const polygonArea = (pts: Vec2[]) => Math.abs(signedArea(pts));

export function centroid(pts: Vec2[]): Vec2 {
  const a = signedArea(pts);
  if (Math.abs(a) < 1e-9) {
    const s = pts.reduce((acc, p) => add(acc, p), v(0, 0));
    return scale(s, 1 / pts.length);
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const q = pts[(i + 1) % pts.length];
    const f = p.x * q.y - q.x * p.y;
    cx += (p.x + q.x) * f;
    cy += (p.y + q.y) * f;
  }
  return v(cx / (6 * a), cy / (6 * a));
}

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function bounds(pts: Vec2[]): Bounds {
  const b = { minX: Infinity, minY: Infinity, maxX: -Infinity, maxY: -Infinity };
  for (const p of pts) {
    b.minX = Math.min(b.minX, p.x);
    b.minY = Math.min(b.minY, p.y);
    b.maxX = Math.max(b.maxX, p.x);
    b.maxY = Math.max(b.maxY, p.y);
  }
  return b;
}

const EPS = 1e-7;

function orient(a: Vec2, b: Vec2, c: Vec2) {
  return cross(sub(b, a), sub(c, a));
}

function onSegment(a: Vec2, b: Vec2, p: Vec2) {
  return (
    p.x <= Math.max(a.x, b.x) + EPS &&
    p.x >= Math.min(a.x, b.x) - EPS &&
    p.y <= Math.max(a.y, b.y) + EPS &&
    p.y >= Math.min(a.y, b.y) - EPS
  );
}

/** True if segments p1p2 and p3p4 intersect or touch. */
export function segmentsIntersect(p1: Vec2, p2: Vec2, p3: Vec2, p4: Vec2): boolean {
  const d1 = orient(p3, p4, p1);
  const d2 = orient(p3, p4, p2);
  const d3 = orient(p1, p2, p3);
  const d4 = orient(p1, p2, p4);
  if (((d1 > EPS && d2 < -EPS) || (d1 < -EPS && d2 > EPS)) && ((d3 > EPS && d4 < -EPS) || (d3 < -EPS && d4 > EPS))) {
    return true;
  }
  if (Math.abs(d1) <= EPS && onSegment(p3, p4, p1)) return true;
  if (Math.abs(d2) <= EPS && onSegment(p3, p4, p2)) return true;
  if (Math.abs(d3) <= EPS && onSegment(p1, p2, p3)) return true;
  if (Math.abs(d4) <= EPS && onSegment(p1, p2, p4)) return true;
  return false;
}

/** A polygon is simple if no edges cross, touch (except neighbours at their shared vertex) or fold back. */
export function isSimplePolygon(pts: Vec2[], minEdge = 1): boolean {
  const n = pts.length;
  if (n < 3) return false;
  for (let i = 0; i < n; i++) {
    if (dist(pts[i], pts[(i + 1) % n]) < minEdge) return false;
  }
  for (let i = 0; i < n; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % n];
    for (let j = i + 1; j < n; j++) {
      const c = pts[j];
      const d = pts[(j + 1) % n];
      const adjacent = j === i + 1 || (i === 0 && j === n - 1);
      if (adjacent) {
        // Shared vertex; reject if the two edges fold back onto each other.
        const [e1, e2] = j === i + 1 ? [sub(b, a), sub(d, c)] : [sub(a, c), sub(b, a)];
        if (Math.abs(cross(normalize(e1), normalize(e2))) < 1e-9 && dot(e1, e2) < 0) return false;
        continue;
      }
      if (segmentsIntersect(a, b, c, d)) return false;
    }
  }
  return Math.abs(signedArea(pts)) > 1;
}

export function pointInPolygon(p: Vec2, pts: Vec2[]): boolean {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i];
    const b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

const toPc = (pts: Vec2[]): PcPolygon => [pts.map((p) => [p.x, p.y] as [number, number])];

function ringArea(ring: [number, number][]) {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const [ax, ay] = ring[i];
    const [bx, by] = ring[(i + 1) % ring.length];
    s += ax * by - bx * ay;
  }
  return Math.abs(s / 2);
}

/**
 * True when the interiors of two simple polygons overlap by more than
 * `tolerance` square units. Polygons that merely share edges or corners do
 * not overlap.
 */
export function polygonsOverlap(a: Vec2[], b: Vec2[], tolerance = 1): boolean {
  const ba = bounds(a);
  const bb = bounds(b);
  if (ba.maxX <= bb.minX || bb.maxX <= ba.minX || ba.maxY <= bb.minY || bb.maxY <= ba.minY) return false;
  try {
    const result = polygonClipping.intersection(toPc(a), toPc(b));
    let area = 0;
    for (const poly of result) {
      poly.forEach((ring, i) => {
        area += (i === 0 ? 1 : -1) * ringArea(ring);
      });
    }
    return area > tolerance;
  } catch {
    // Degenerate input; err on the side of caution.
    return true;
  }
}

export interface Projection {
  /** Parameter along the segment, 0..1 (clamped). */
  t: number;
  point: Vec2;
  distance: number;
}

export function projectOnSegment(p: Vec2, a: Vec2, b: Vec2): Projection {
  const ab = sub(b, a);
  const l2 = dot(ab, ab);
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, dot(sub(p, a), ab) / l2));
  const point = add(a, scale(ab, t));
  return { t, point, distance: dist(p, point) };
}

/** Intersection of infinite lines p + s*d and q + t*e; null when (nearly) parallel. */
export function lineIntersection(p: Vec2, d: Vec2, q: Vec2, e: Vec2): Vec2 | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const s = cross(sub(q, p), e) / den;
  return add(p, scale(d, s));
}
