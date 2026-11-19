import { add, dist, dot, normalize, perp, scale, sub } from './geometry';
import { edgeOf, pairKey } from './plan';
import type { Doorway, Plan, Room } from './types';

/** Max distance (cm) between two wall lines for them to count as adjoining. */
const COLLINEAR_TOLERANCE = 1;
/** Doorways narrower than this are not created. */
const MIN_DOOR_WIDTH = 50;

interface SharedEdge {
  edgeA: number;
  edgeB: number;
  /** Interval along edge A's direction, measured from its start vertex. */
  lo: number;
  hi: number;
}

/** Longest stretch of wall shared by two rooms, if any. */
export function sharedEdge(a: Room, b: Room): SharedEdge | null {
  let best: SharedEdge | null = null;
  for (let i = 0; i < a.points.length; i++) {
    const [a0, a1] = edgeOf(a, i);
    const L = dist(a0, a1);
    if (L < 1e-6) continue;
    const d = normalize(sub(a1, a0));
    const n = perp(d);
    for (let j = 0; j < b.points.length; j++) {
      const [b0, b1] = edgeOf(b, j);
      if (Math.abs(dot(sub(b0, a0), n)) > COLLINEAR_TOLERANCE) continue;
      if (Math.abs(dot(sub(b1, a0), n)) > COLLINEAR_TOLERANCE) continue;
      const s0 = dot(sub(b0, a0), d);
      const s1 = dot(sub(b1, a0), d);
      const lo = Math.max(0, Math.min(s0, s1));
      const hi = Math.min(L, Math.max(s0, s1));
      if (hi - lo <= 0) continue;
      if (!best || hi - lo > best.hi - best.lo) best = { edgeA: i, edgeB: j, lo, hi };
    }
  }
  return best;
}

/**
 * Doorways are derived from geometry: whenever two rooms share a stretch of
 * wall that is wide enough, a doorway is placed on it. By default it sits in
 * the middle; `plan.doorwaySettings` can shift it along the stretch or disable
 * it. Disabled doorways are still returned (flagged) so the UI can re-enable them.
 */
export function computeDoorways(plan: Plan): Doorway[] {
  const result: Doorway[] = [];
  const { rooms, settings } = plan;
  for (let i = 0; i < rooms.length; i++) {
    for (let j = i + 1; j < rooms.length; j++) {
      // Order the pair by id so offsets keep their direction if rooms are reordered.
      const [a, b] = rooms[i].id < rooms[j].id ? [rooms[i], rooms[j]] : [rooms[j], rooms[i]];
      const shared = sharedEdge(a, b);
      if (!shared) continue;
      // Keep clear of the perpendicular walls at either end of the shared stretch.
      const clearance =
        Math.max(...a.walls.map((w) => w.thickness), ...b.walls.map((w) => w.thickness)) + 5;
      const available = shared.hi - shared.lo - 2 * clearance;
      const width = Math.min(settings.doorWidth, available);
      if (width < MIN_DOOR_WIDTH) continue;
      const [a0, a1] = edgeOf(a, shared.edgeA);
      const d = normalize(sub(a1, a0));
      const stretchCenter = add(a0, scale(d, (shared.lo + shared.hi) / 2));
      const key = pairKey(a.id, b.id);
      const setting = plan.doorwaySettings?.[key] ?? {};
      const maxOffset = Math.max(0, (available - width) / 2);
      const offset = Math.min(maxOffset, Math.max(-maxOffset, setting.offset ?? 0));
      const height = Math.min(settings.doorHeight, a.ceilingHeight - 10, b.ceilingHeight - 10);
      result.push({
        id: `door_${a.id}_${b.id}`,
        key,
        rooms: [a.id, b.id],
        walls: [shared.edgeA, shared.edgeB],
        center: add(stretchCenter, scale(d, offset)),
        width,
        height,
        disabled: !!setting.disabled,
        offset,
        maxOffset,
        stretchCenter,
        axis: d,
      });
    }
  }
  return result;
}
