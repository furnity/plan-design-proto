import {
  add,
  bounds,
  dist,
  dot,
  isSimplePolygon,
  normalize,
  perp,
  polygonsOverlap,
  scale,
  snap,
  sub,
  v,
} from './geometry';
import { FLOOR_TYPES, type FloorType, type Plan, type Room, type Vec2, type Wall, type WindowSpec } from './types';

export const DEFAULT_WALL_THICKNESS = 10;
export const DEFAULT_CEILING_HEIGHT = 250;
export const MIN_EDGE_LENGTH = 30;

export const newId = (prefix: string) => `${prefix}_${Math.random().toString(36).slice(2, 9)}`;

export function createWall(thickness = DEFAULT_WALL_THICKNESS): Wall {
  return { id: newId('wall'), thickness, windows: [] };
}

export function createRectRoom(x: number, y: number, w: number, h: number, name: string): Room {
  const points = [v(x, y), v(x + w, y), v(x + w, y + h), v(x, y + h)];
  return {
    id: newId('room'),
    name,
    points,
    walls: points.map(() => createWall()),
    ceilingHeight: DEFAULT_CEILING_HEIGHT,
    floorType: 'wood',
  };
}

export function createInitialPlan(): Plan {
  return {
    version: 1,
    units: 'cm',
    settings: { doorWidth: 90, doorHeight: 210 },
    rooms: [createRectRoom(0, 0, 500, 400, 'Room 1')],
  };
}

export const edgeOf = (room: Room, i: number): [Vec2, Vec2] => [
  room.points[i],
  room.points[(i + 1) % room.points.length],
];

export const wallLength = (room: Room, i: number) => {
  const [a, b] = edgeOf(room, i);
  return dist(a, b);
};

export const findRoom = (plan: Plan, id: string | undefined) => plan.rooms.find((r) => r.id === id);

function replaceRoom(plan: Plan, room: Room): Plan {
  return { ...plan, rooms: plan.rooms.map((r) => (r.id === room.id ? room : r)) };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/** Geometry rules for a single room in the context of the plan. */
export function roomProblem(plan: Plan, room: Room): string | null {
  if (room.points.length < 3) return 'A room needs at least 3 corners';
  if (room.walls.length !== room.points.length) return 'Wall count does not match corner count';
  for (let i = 0; i < room.points.length; i++) {
    if (wallLength(room, i) < MIN_EDGE_LENGTH) return `Walls must be at least ${MIN_EDGE_LENGTH} cm long`;
  }
  if (!isSimplePolygon(room.points)) return 'Room outline may not intersect itself';
  for (const other of plan.rooms) {
    if (other.id === room.id) continue;
    if (polygonsOverlap(room.points, other.points)) return `Overlaps "${other.name}"`;
  }
  return null;
}

export function planProblem(plan: Plan): string | null {
  for (const room of plan.rooms) {
    const p = roomProblem(plan, room);
    if (p) return `${room.name}: ${p}`;
  }
  return null;
}

/**
 * Commit an updated room only if the plan stays valid.
 * Returns the new plan or null when the change is rejected.
 */
export function tryUpdateRoom(plan: Plan, room: Room): Plan | null {
  const normalized = normalizeRoom(room);
  const next = replaceRoom(plan, normalized);
  return roomProblem(next, normalized) ? null : next;
}

/** Clamp window dimensions so they fit their wall and the ceiling. */
export function normalizeRoom(room: Room): Room {
  const walls = room.walls.map((wall, i) => {
    const L = wallLength(room, i);
    const margin = wall.thickness + 5;
    const windows = wall.windows.map((w) => clampWindow(w, L, margin, room.ceilingHeight));
    return { ...wall, windows };
  });
  return { ...room, walls };
}

function clampWindow(w: WindowSpec, wallLen: number, margin: number, ceiling: number): WindowSpec {
  const maxWidth = Math.max(10, wallLen - 2 * margin);
  const width = Math.min(Math.max(10, w.width), maxWidth);
  const lo = Math.min(margin + width / 2, wallLen / 2);
  const hi = Math.max(wallLen - margin - width / 2, wallLen / 2);
  const offset = Math.min(Math.max(w.offset, lo), hi);
  const sill = Math.min(Math.max(0, w.sill), Math.max(0, ceiling - 20));
  const height = Math.min(Math.max(10, w.height), Math.max(10, ceiling - 5 - sill));
  return { ...w, width, offset, sill, height };
}

// ---------------------------------------------------------------------------
// Editing operations (return null when the result would be invalid)
// ---------------------------------------------------------------------------

export function moveVertex(plan: Plan, roomId: string, index: number, pos: Vec2): Plan | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  const points = room.points.map((p, i) => (i === index ? pos : p));
  return tryUpdateRoom(plan, { ...room, points });
}

/** Move edge `index` along its normal by the given (signed) distance. */
export function moveEdge(plan: Plan, roomId: string, index: number, delta: Vec2): Plan | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  const n = room.points.length;
  const j = (index + 1) % n;
  const points = room.points.map((p, i) => (i === index || i === j ? add(p, delta) : p));
  return tryUpdateRoom(plan, { ...room, points });
}

export function edgeNormal(room: Room, index: number): Vec2 {
  const [a, b] = edgeOf(room, index);
  return normalize(perp(sub(b, a)));
}

export function moveRoom(plan: Plan, roomId: string, delta: Vec2): Plan | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  return tryUpdateRoom(plan, { ...room, points: room.points.map((p) => add(p, delta)) });
}

/** Split wall `index` at `pos` (projected onto the wall), keeping windows on their half. */
export function insertVertex(plan: Plan, roomId: string, index: number, pos: Vec2): Plan | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  const [a, b] = edgeOf(room, index);
  const dir = normalize(sub(b, a));
  const s = dot(sub(pos, a), dir);
  const L = dist(a, b);
  if (s < MIN_EDGE_LENGTH || L - s < MIN_EDGE_LENGTH) return null;
  const point = add(a, scale(dir, s));
  const wall = room.walls[index];
  const first: Wall = { ...wall, windows: wall.windows.filter((w) => w.offset < s) };
  const second: Wall = {
    ...createWall(wall.thickness),
    windows: wall.windows.filter((w) => w.offset >= s).map((w) => ({ ...w, offset: w.offset - s })),
  };
  const points = [...room.points.slice(0, index + 1), point, ...room.points.slice(index + 1)];
  const walls = [...room.walls.slice(0, index), first, second, ...room.walls.slice(index + 1)];
  return tryUpdateRoom(plan, { ...room, points, walls });
}

/** Remove a corner, merging its two walls (the earlier wall's settings win). */
export function removeVertex(plan: Plan, roomId: string, index: number): Plan | null {
  const room = findRoom(plan, roomId);
  if (!room || room.points.length <= 3) return null;
  const n = room.points.length;
  const prev = (index - 1 + n) % n;
  const prevLen = wallLength(room, prev);
  const merged: Wall = {
    ...room.walls[prev],
    windows: [
      ...room.walls[prev].windows,
      ...room.walls[index].windows.map((w) => ({ ...w, offset: w.offset + prevLen })),
    ],
  };
  const points = room.points.filter((_, i) => i !== index);
  const walls = room.walls.map((w, i) => (i === prev ? merged : w)).filter((_, i) => i !== index);
  return tryUpdateRoom(plan, { ...room, points, walls });
}

export function updateRoom(plan: Plan, roomId: string, patch: Partial<Pick<Room, 'name' | 'ceilingHeight' | 'floorType'>>) {
  const room = findRoom(plan, roomId);
  if (!room) return plan;
  return replaceRoom(plan, normalizeRoom({ ...room, ...patch }));
}

export function updateWall(plan: Plan, roomId: string, index: number, patch: Partial<Pick<Wall, 'thickness'>>) {
  const room = findRoom(plan, roomId);
  if (!room) return plan;
  const walls = room.walls.map((w, i) => (i === index ? { ...w, ...patch } : w));
  return replaceRoom(plan, normalizeRoom({ ...room, walls }));
}

export function addWindow(plan: Plan, roomId: string, index: number): { plan: Plan; windowId: string } | null {
  const room = findRoom(plan, roomId);
  if (!room) return null;
  const L = wallLength(room, index);
  const win: WindowSpec = { id: newId('win'), offset: L / 2, width: Math.min(120, L - 40), height: 120, sill: 90 };
  const walls = room.walls.map((w, i) => (i === index ? { ...w, windows: [...w.windows, win] } : w));
  return { plan: replaceRoom(plan, normalizeRoom({ ...room, walls })), windowId: win.id };
}

export function updateWindow(plan: Plan, roomId: string, index: number, windowId: string, patch: Partial<WindowSpec>) {
  const room = findRoom(plan, roomId);
  if (!room) return plan;
  const walls = room.walls.map((w, i) =>
    i === index ? { ...w, windows: w.windows.map((win) => (win.id === windowId ? { ...win, ...patch } : win)) } : w,
  );
  return replaceRoom(plan, normalizeRoom({ ...room, walls }));
}

export function removeWindow(plan: Plan, roomId: string, index: number, windowId: string) {
  const room = findRoom(plan, roomId);
  if (!room) return plan;
  const walls = room.walls.map((w, i) => (i === index ? { ...w, windows: w.windows.filter((x) => x.id !== windowId) } : w));
  return replaceRoom(plan, { ...room, walls });
}

export function removeRoom(plan: Plan, roomId: string): Plan {
  return { ...plan, rooms: plan.rooms.filter((r) => r.id !== roomId) };
}

/**
 * Add a new rectangular room, preferably adjoining `nearRoomId` (so a doorway
 * is created), otherwise to the right of everything.
 */
export function addRoom(plan: Plan, nearRoomId?: string, grid = 10): { plan: Plan; roomId: string } {
  const w = 400;
  const h = 300;
  const name = nextRoomName(plan);
  const ref = findRoom(plan, nearRoomId) ?? plan.rooms[plan.rooms.length - 1];
  const candidates: Vec2[] = [];
  if (ref) {
    const b = bounds(ref.points);
    candidates.push(v(b.maxX, b.minY), v(b.minX, b.maxY), v(b.minX - w, b.minY), v(b.minX, b.minY - h));
    candidates.push(v(b.maxX, b.maxY - h), v(b.maxX - w, b.maxY), v(b.minX - w, b.maxY - h), v(b.maxX - w, b.minY - h));
  }
  for (const c of candidates) {
    const room = createRectRoom(snap(c.x, grid), snap(c.y, grid), w, h, name);
    const next = { ...plan, rooms: [...plan.rooms, room] };
    if (!roomProblem(next, room)) return { plan: next, roomId: room.id };
  }
  const all = plan.rooms.flatMap((r) => r.points);
  const b = all.length ? bounds(all) : { maxX: -100, minY: 0 };
  const room = createRectRoom(snap(b.maxX + 100, grid), snap(b.minY, grid), w, h, name);
  return { plan: { ...plan, rooms: [...plan.rooms, room] }, roomId: room.id };
}

function nextRoomName(plan: Plan) {
  let i = plan.rooms.length + 1;
  const names = new Set(plan.rooms.map((r) => r.name));
  while (names.has(`Room ${i}`)) i++;
  return `Room ${i}`;
}

// ---------------------------------------------------------------------------
// JSON
// ---------------------------------------------------------------------------

const num = (x: unknown, fallback: number) => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

/** Parse and validate plan JSON, filling in defaults. Throws with a readable message. */
export function parsePlan(input: string | unknown): Plan {
  const data = typeof input === 'string' ? JSON.parse(input) : input;
  if (!data || typeof data !== 'object') throw new Error('Plan must be a JSON object');
  const d = data as Record<string, unknown>;
  if (!Array.isArray(d.rooms)) throw new Error('Plan needs a "rooms" array');
  const s = (d.settings ?? {}) as Record<string, unknown>;
  const ids = new Set<string>();
  const rooms: Room[] = d.rooms.map((r: Record<string, unknown>, ri: number) => {
    if (!Array.isArray(r.points) || r.points.length < 3) throw new Error(`Room ${ri + 1}: needs at least 3 points`);
    const points = r.points.map((p: Record<string, unknown>, pi: number) => {
      if (typeof p?.x !== 'number' || typeof p?.y !== 'number') throw new Error(`Room ${ri + 1}: point ${pi + 1} is invalid`);
      return v(p.x, p.y);
    });
    const rawWalls = Array.isArray(r.walls) ? r.walls : [];
    const walls: Wall[] = points.map((_, wi) => {
      const w = (rawWalls[wi] ?? {}) as Record<string, unknown>;
      const windows = Array.isArray(w.windows) ? w.windows : [];
      return {
        id: typeof w.id === 'string' ? w.id : newId('wall'),
        thickness: num(w.thickness, DEFAULT_WALL_THICKNESS),
        windows: windows.map((x: Record<string, unknown>) => ({
          id: typeof x.id === 'string' ? x.id : newId('win'),
          offset: num(x.offset, 0),
          width: num(x.width, 100),
          height: num(x.height, 120),
          sill: num(x.sill, 90),
        })),
      };
    });
    let id = typeof r.id === 'string' ? r.id : newId('room');
    if (ids.has(id)) id = newId('room');
    ids.add(id);
    const floorType = FLOOR_TYPES.includes(r.floorType as FloorType) ? (r.floorType as FloorType) : 'wood';
    return normalizeRoom({
      id,
      name: typeof r.name === 'string' ? r.name : `Room ${ri + 1}`,
      points,
      walls,
      ceilingHeight: num(r.ceilingHeight, DEFAULT_CEILING_HEIGHT),
      floorType,
    });
  });
  const plan: Plan = {
    version: 1,
    units: 'cm',
    settings: { doorWidth: num(s.doorWidth, 90), doorHeight: num(s.doorHeight, 210) },
    rooms,
  };
  const problem = planProblem(plan);
  if (problem) throw new Error(problem);
  return plan;
}
