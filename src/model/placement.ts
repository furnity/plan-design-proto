import { add, dist, dot, normalize, perp, polygonsOverlap, scale, sub } from './geometry';
import { findRoom, moveRoom } from './plan';
import type { Plan, Vec2 } from './types';

/**
 * Where should a dragged room go when the spot under the cursor is taken?
 *
 * Instead of refusing the move (which makes a room stick as soon as a fast
 * drag overshoots into a neighbour), we look for the free position nearest
 * the cursor target. Candidates come from pushing the room out of each room
 * it overlaps, along each edge normal of either polygon (the separating-axis
 * minimum translations). The candidates are pushed out again, so a room can
 * settle into a corner between two neighbours. Every candidate is checked
 * with the real plan validation, so the result is always a legal placement.
 * The result touches the obstacle exactly, so adjoining rooms get a doorway.
 */

/** How many levels of "push out, then push out again" to explore. */
const MAX_DEPTH = 3;
/** Invalid candidates kept for the next level (closest to the target first). */
const FRONTIER = 8;
/**
 * Small preference for staying near the previous position. It stops the
 * room flickering between two sides of a neighbour when the cursor is near
 * the point where both are equally close.
 */
const STICKINESS = 0.15;

const key = (p: Vec2) => `${Math.round(p.x * 1000)},${Math.round(p.y * 1000)}`;

function edgeNormals(pts: Vec2[]): Vec2[] {
  return pts.map((p, i) => normalize(perp(sub(pts[(i + 1) % pts.length], p))));
}

function project(pts: Vec2[], n: Vec2): [number, number] {
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const s = dot(p, n);
    lo = Math.min(lo, s);
    hi = Math.max(hi, s);
  }
  return [lo, hi];
}

/** Translations that push `moving` (already offset by `t`) clear of `obstacle` along each axis. */
function pushOuts(moving: Vec2[], obstacle: Vec2[], t: Vec2): Vec2[] {
  const out: Vec2[] = [];
  const seen = new Set<string>();
  for (const n of [...edgeNormals(moving), ...edgeNormals(obstacle)]) {
    // n and -n give the same pair of pushes; skip duplicates.
    const k = key(n.x < 0 || (n.x === 0 && n.y < 0) ? scale(n, -1) : n);
    if (seen.has(k)) continue;
    seen.add(k);
    const [mLo, mHi] = project(moving, n);
    const [oLo, oHi] = project(obstacle, n);
    if (oHi - mLo > 0) out.push(add(t, scale(n, oHi - mLo)));
    if (mHi - oLo > 0) out.push(add(t, scale(n, -(mHi - oLo))));
  }
  return out;
}

/**
 * Best legal translation (relative to the room's position in `plan`) for a
 * drag aiming at `target`. `previous` is the translation currently shown.
 * Returns null only if no legal position was found (then keep `previous`).
 */
export function resolveRoomMove(plan: Plan, roomId: string, target: Vec2, previous: Vec2): Vec2 | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  if (moveRoom(plan, roomId, target)) return target;

  const others = plan.rooms.filter((r) => r.id !== roomId);
  const score = (c: Vec2) => dist(c, target) + STICKINESS * dist(c, previous);
  const seen = new Set<string>([key(target)]);
  let best: Vec2 | null = null;
  let bestScore = Infinity;
  let frontier: Vec2[] = [target];

  for (let depth = 0; depth < MAX_DEPTH && frontier.length; depth++) {
    const invalid: Vec2[] = [];
    for (const t of frontier) {
      const moved = room.points.map((p) => add(p, t));
      for (const other of others) {
        if (!polygonsOverlap(moved, other.points)) continue;
        for (const c of pushOuts(moved, other.points, t)) {
          const k = key(c);
          if (seen.has(k)) continue;
          seen.add(k);
          // Anything further away than the best legal spot so far can't win.
          if (dist(c, target) >= bestScore) continue;
          if (moveRoom(plan, roomId, c)) {
            const s = score(c);
            if (s < bestScore) [best, bestScore] = [c, s];
          } else {
            invalid.push(c);
          }
        }
      }
    }
    frontier = invalid.sort((a, b) => dist(a, target) - dist(b, target)).slice(0, FRONTIER);
  }

  // Fallback: the furthest point along the straight path from the current position.
  if (!best) best = furthestAlong(plan, roomId, previous, target);
  return best;
}

/** Bisect along previous → target for the last legal translation. */
function furthestAlong(plan: Plan, roomId: string, from: Vec2, to: Vec2): Vec2 | null {
  if (!moveRoom(plan, roomId, from)) return null;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 16; i++) {
    const mid = (lo + hi) / 2;
    if (moveRoom(plan, roomId, add(from, scale(sub(to, from), mid)))) lo = mid;
    else hi = mid;
  }
  return lo > 0 ? add(from, scale(sub(to, from), lo)) : null;
}
