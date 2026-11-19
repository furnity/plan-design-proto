import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeDoorways } from './doorways';
import { isSimplePolygon, polygonsOverlap, v } from './geometry';
import { serializePlan } from './io';
import {
  addRoom,
  addWindow,
  createInitialPlan,
  createRectRoom,
  insertVertex,
  moveEdge,
  moveRoom,
  moveVertex,
  parsePlan,
  removeVertex,
} from './plan';
import type { Plan } from './types';
import { roomWallLayouts, sliceWall, wallFootprint } from './walls';
import { buildPlanModel } from '../three/buildModel';

const twoRooms = (): Plan => {
  const plan = createInitialPlan();
  plan.rooms.push(createRectRoom(500, 0, 400, 300, 'Room 2'));
  return plan;
};

describe('geometry', () => {
  const sq = (x: number, y: number, s = 100) => [v(x, y), v(x + s, y), v(x + s, y + s), v(x, y + s)];

  it('detects overlap but allows touching', () => {
    expect(polygonsOverlap(sq(0, 0), sq(50, 50))).toBe(true);
    expect(polygonsOverlap(sq(0, 0), sq(100, 0))).toBe(false);
    expect(polygonsOverlap(sq(0, 0), sq(100, 100))).toBe(false);
    expect(polygonsOverlap(sq(0, 0), sq(0, 0))).toBe(true);
    expect(polygonsOverlap(sq(0, 0, 300), sq(100, 100))).toBe(true); // containment
  });

  it('rejects self-intersecting outlines', () => {
    expect(isSimplePolygon(sq(0, 0))).toBe(true);
    expect(isSimplePolygon([v(0, 0), v(100, 100), v(100, 0), v(0, 100)])).toBe(false);
  });
});

describe('editing', () => {
  it('refuses moves that overlap another room', () => {
    const plan = twoRooms();
    const [a, b] = plan.rooms;
    expect(moveRoom(plan, b.id, v(-50, 0))).toBeNull();
    expect(moveRoom(plan, b.id, v(50, 0))).not.toBeNull();
    // Right wall of room 1 is wall index 1; pushing it right overlaps room 2.
    expect(moveEdge(plan, a.id, 1, v(20, 0))).toBeNull();
    expect(moveEdge(plan, a.id, 1, v(-20, 0))).not.toBeNull();
    expect(moveVertex(plan, a.id, 2, v(560, 400))).toBeNull();
  });

  it('inserts and removes corners, carrying windows along', () => {
    let plan = createInitialPlan();
    const room = plan.rooms[0];
    plan = addWindow(plan, room.id, 0)!.plan; // centred at 250 on a 500 wall
    plan = insertVertex(plan, room.id, 0, v(100, 0))!;
    expect(plan.rooms[0].points).toHaveLength(5);
    expect(plan.rooms[0].walls[0].windows).toHaveLength(0);
    expect(plan.rooms[0].walls[1].windows[0].offset).toBeCloseTo(150);
    plan = removeVertex(plan, room.id, 1)!;
    expect(plan.rooms[0].points).toHaveLength(4);
    expect(plan.rooms[0].walls[0].windows[0].offset).toBeCloseTo(250);
  });

  it('places new rooms adjoining the selected one', () => {
    const plan = createInitialPlan();
    const { plan: next } = addRoom(plan, plan.rooms[0].id);
    expect(next.rooms).toHaveLength(2);
    expect(computeDoorways(next)).toHaveLength(1);
  });
});

describe('doorways', () => {
  it('creates one doorway on the shared wall stretch', () => {
    const doors = computeDoorways(twoRooms());
    expect(doors).toHaveLength(1);
    expect(doors[0].center.x).toBeCloseTo(500);
    expect(doors[0].center.y).toBeCloseTo(150); // middle of the 0..300 overlap
    expect(doors[0].walls).toEqual([1, 3]);
  });

  it('no doorway when rooms are apart or only touch at a corner', () => {
    const plan = createInitialPlan();
    plan.rooms.push(createRectRoom(510, 0, 400, 300, 'gap'));
    plan.rooms.push(createRectRoom(500, 400, 100, 100, 'corner'));
    expect(computeDoorways(plan)).toHaveLength(0);
  });
});

describe('walls', () => {
  it('builds walls inward with mitred corners', () => {
    const room = createInitialPlan().rooms[0];
    const [top] = roomWallLayouts(room);
    expect(top.innerStart).toBeCloseTo(10);
    expect(top.innerEnd).toBeCloseTo(490);
    const fp = wallFootprint(top, 0, top.length);
    expect(fp[3]).toEqual({ x: 10, y: 10 });
  });

  it('cuts window openings into vertical solids', () => {
    let plan = createInitialPlan();
    plan = addWindow(plan, plan.rooms[0].id, 0)!.plan;
    const [top] = roomWallLayouts(plan.rooms[0]);
    const slices = sliceWall(top);
    expect(slices).toHaveLength(3);
    expect(slices[1].solids).toEqual([
      [0, 90],
      [210, 250],
    ]);
  });
});

describe('json + 3d', () => {
  it('round-trips through JSON', () => {
    const plan = twoRooms();
    const parsed = parsePlan(serializePlan(plan));
    expect(parsed.rooms).toEqual(plan.rooms);
  });

  it('rejects overlapping rooms in JSON', () => {
    const plan = createInitialPlan();
    plan.rooms.push(createRectRoom(100, 100, 100, 100, 'inside'));
    expect(() => parsePlan(JSON.stringify(plan))).toThrow(/Overlaps/);
  });

  it('builds a Three.js model with door openings', () => {
    const model = buildPlanModel(twoRooms());
    expect(model.children).toHaveLength(2);
    const box = new THREE.Box3().setFromObject(model);
    expect(box.max.y).toBeCloseTo(2.5);
    expect(box.max.x).toBeCloseTo(9);
    // The shared walls are split around the doorway (3 slices; the door slice has a lintel only).
    const wall = model.children[0].getObjectByName('wall-1')!;
    expect(wall.children).toHaveLength(3);
    // Serialisable in THREE.ObjectLoader format.
    expect(model.toJSON().metadata?.type).toBe('Object');
  });
});
