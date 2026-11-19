import { add, dist, dot, lineIntersection, normalize, perp, scale, signedArea, sub } from './geometry';
import type { Doorway, Room, Vec2 } from './types';

/**
 * Shared wall layout used by both the 2D plan and the 3D model.
 *
 * Walls are built inwards from the room outline, so two adjoining rooms get
 * back-to-back walls and never overlap. Each wall is described in a local
 * frame: `s` runs along the wall from its start vertex, the inner face sits
 * `thickness` away along the inward normal. Corners are mitred.
 */

export interface Opening {
  kind: 'window' | 'door';
  id: string;
  start: number;
  end: number;
  bottom: number;
  top: number;
}

export interface WallLayout {
  index: number;
  p0: Vec2;
  p1: Vec2;
  dir: Vec2;
  /** Unit normal pointing into the room. */
  normal: Vec2;
  length: number;
  thickness: number;
  height: number;
  /** Where the inner face starts/ends, in `s` (mitre with neighbouring walls). */
  innerStart: number;
  innerEnd: number;
  openings: Opening[];
}

export interface WallSlice {
  a: number;
  b: number;
  /** Vertical solid ranges [bottom, top] in this slice. */
  solids: [number, number][];
  openings: Opening[];
}

function innerCorner(prev: { p: Vec2; d: Vec2; n: Vec2; t: number }, cur: { p: Vec2; d: Vec2; n: Vec2; t: number }, vertex: Vec2) {
  const hit = lineIntersection(add(prev.p, scale(prev.n, prev.t)), prev.d, add(cur.p, scale(cur.n, cur.t)), cur.d);
  const fallback = add(vertex, scale(cur.n, cur.t));
  // Very sharp corners produce long mitre spikes; cap them.
  if (!hit || dist(hit, vertex) > 4 * Math.max(prev.t, cur.t)) return fallback;
  return hit;
}

export function roomWallLayouts(room: Room, doorways: Doorway[] = []): WallLayout[] {
  const pts = room.points;
  const n = pts.length;
  const orientation = signedArea(pts) >= 0 ? 1 : -1;
  const frames = pts.map((p, i) => {
    const q = pts[(i + 1) % n];
    const d = normalize(sub(q, p));
    return { p, q, d, n: scale(perp(d), orientation), t: room.walls[i].thickness, L: dist(p, q) };
  });

  return frames.map((f, i) => {
    const prev = frames[(i - 1 + n) % n];
    const next = frames[(i + 1) % n];
    const startCorner = innerCorner(prev, f, f.p);
    const endCorner = innerCorner(f, next, f.q);
    const innerStart = dot(sub(startCorner, f.p), f.d);
    const innerEnd = dot(sub(endCorner, f.p), f.d);
    const lo = Math.max(0, innerStart) + 1;
    const hi = Math.min(f.L, innerEnd) - 1;

    const openings: Opening[] = [];
    for (const w of room.walls[i].windows) {
      openings.push({
        kind: 'window',
        id: w.id,
        start: w.offset - w.width / 2,
        end: w.offset + w.width / 2,
        bottom: w.sill,
        top: Math.min(w.sill + w.height, room.ceilingHeight - 1),
      });
    }
    doorways.forEach((door) => {
      const k = door.rooms.indexOf(room.id);
      if (door.disabled || k < 0 || door.walls[k] !== i) return;
      const s = dot(sub(door.center, f.p), f.d);
      openings.push({
        kind: 'door',
        id: door.id,
        start: s - door.width / 2,
        end: s + door.width / 2,
        bottom: 0,
        top: Math.min(door.height, room.ceilingHeight - 1),
      });
    });
    const clamped = openings
      .map((o) => ({ ...o, start: Math.max(o.start, lo), end: Math.min(o.end, hi) }))
      .filter((o) => o.end - o.start > 1 && o.top > o.bottom);

    return {
      index: i,
      p0: f.p,
      p1: f.q,
      dir: f.d,
      normal: f.n,
      length: f.L,
      thickness: f.t,
      height: room.ceilingHeight,
      innerStart,
      innerEnd,
      openings: clamped,
    };
  });
}

/** Point on the wall's outer (side = 0) or inner (side = 1) face at position s. */
export function wallPoint(w: WallLayout, s: number, side: number): Vec2 {
  return add(add(w.p0, scale(w.dir, s)), scale(w.normal, w.thickness * side));
}

/** Plan footprint of the wall between positions a and b (mitred at the wall ends). */
export function wallFootprint(w: WallLayout, a: number, b: number): Vec2[] {
  const eps = 1e-6;
  const outerA = a <= eps ? 0 : a;
  const innerA = a <= eps ? w.innerStart : a;
  const outerB = b >= w.length - eps ? w.length : b;
  const innerB = b >= w.length - eps ? w.innerEnd : b;
  return [wallPoint(w, outerA, 0), wallPoint(w, outerB, 0), wallPoint(w, innerB, 1), wallPoint(w, innerA, 1)];
}

function subtractRanges(range: [number, number], holes: [number, number][]): [number, number][] {
  let parts: [number, number][] = [range];
  for (const [h0, h1] of holes) {
    const next: [number, number][] = [];
    for (const [p0, p1] of parts) {
      if (h1 <= p0 || h0 >= p1) {
        next.push([p0, p1]);
        continue;
      }
      if (h0 > p0) next.push([p0, h0]);
      if (h1 < p1) next.push([h1, p1]);
    }
    parts = next;
  }
  return parts.filter(([a, b]) => b - a > 0.5);
}

/**
 * Split a wall along its length at every opening boundary. Each slice knows
 * which vertical ranges are solid; neighbouring slices with identical solids
 * are merged.
 */
export function sliceWall(w: WallLayout): WallSlice[] {
  const breaks = new Set<number>([0, w.length]);
  for (const o of w.openings) {
    breaks.add(o.start);
    breaks.add(o.end);
  }
  const sorted = [...breaks].sort((x, y) => x - y);
  const slices: WallSlice[] = [];
  for (let i = 0; i < sorted.length - 1; i++) {
    const a = sorted[i];
    const b = sorted[i + 1];
    if (b - a < 0.01) continue;
    const mid = (a + b) / 2;
    const openings = w.openings.filter((o) => o.start <= mid && o.end >= mid);
    const solids = subtractRanges(
      [0, w.height],
      openings.map((o) => [o.bottom, o.top]),
    );
    const last = slices[slices.length - 1];
    const sameAsLast =
      last &&
      last.openings.length === 0 &&
      openings.length === 0;
    if (sameAsLast) last.b = b;
    else slices.push({ a, b, solids, openings });
  }
  return slices;
}
