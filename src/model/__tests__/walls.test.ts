import { describe, expect, it } from 'vitest';
import { computeDoorways } from '../doorways';
import { addWindow, createInitialPlan, createRectRoom, setDoorway } from '../plan';
import type { Plan } from '../types';
import { roomWallLayouts, sliceWall, wallFootprint } from '../walls';

/** Room 1 (500 × 400 at the origin) with Room 2 adjoining its east wall. */
const twoRooms = (): Plan => {
  const plan = createInitialPlan();
  plan.rooms.push(createRectRoom(500, 0, 400, 300, 'Room 2'));
  return plan;
};

describe('roomWallLayouts', () => {
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

  it('opens the shared wall for a doorway, but not for a disabled one', () => {
    let plan = twoRooms();
    const a = plan.rooms[0];
    const [door] = computeDoorways(plan);
    expect(roomWallLayouts(a, computeDoorways(plan))[1].openings).toHaveLength(1);
    plan = setDoorway(plan, door.key, { disabled: true });
    expect(roomWallLayouts(a, computeDoorways(plan))[1].openings).toHaveLength(0);
  });
});
