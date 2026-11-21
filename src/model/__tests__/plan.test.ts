import { describe, expect, it } from 'vitest';
import { computeDoorways } from '../doorways';
import { v } from '../geometry';
import { serializePlan } from '../io';
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
  removeRoom,
  removeVertex,
  setDoorway,
} from '../plan';
import type { Plan } from '../types';

/** Room 1 (500 × 400 at the origin) with Room 2 adjoining its east wall. */
const twoRooms = (): Plan => {
  const plan = createInitialPlan();
  plan.rooms.push(createRectRoom(500, 0, 400, 300, 'Room 2'));
  return plan;
};

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

describe('doorway settings', () => {
  it('survive JSON and are dropped with their room', () => {
    let plan = twoRooms();
    const key = computeDoorways(plan)[0].key;
    plan = setDoorway(plan, key, { offset: -30, disabled: true });
    expect(parsePlan(serializePlan(plan)).doorwaySettings[key]).toEqual({ offset: -30, disabled: true });
    expect(removeRoom(plan, plan.rooms[1].id).doorwaySettings).toEqual({});
  });
});

describe('parsePlan', () => {
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
});
