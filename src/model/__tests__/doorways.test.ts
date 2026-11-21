import { describe, expect, it } from 'vitest';
import { computeDoorways } from '../doorways';
import { createInitialPlan, createRectRoom, setDoorway } from '../plan';
import type { Plan } from '../types';

/** Room 1 (500 × 400 at the origin) with Room 2 adjoining its east wall. */
const twoRooms = (): Plan => {
  const plan = createInitialPlan();
  plan.rooms.push(createRectRoom(500, 0, 400, 300, 'Room 2'));
  return plan;
};

describe('computeDoorways', () => {
  it('creates one doorway on the shared wall stretch', () => {
    const plan = twoRooms();
    const doors = computeDoorways(plan);
    expect(doors).toHaveLength(1);
    expect(doors[0].center.x).toBeCloseTo(500);
    expect(doors[0].center.y).toBeCloseTo(150); // middle of the 0..300 overlap
    const [a, b] = plan.rooms;
    const wallOf = (id: string) => doors[0].walls[doors[0].rooms.indexOf(id)];
    expect(wallOf(a.id)).toBe(1);
    expect(wallOf(b.id)).toBe(3);
  });

  it('can be moved along the shared wall, clamped to it', () => {
    let plan = twoRooms();
    const [door] = computeDoorways(plan);
    // Shared stretch is y 0..300; clearance 15 at each end leaves 270 for a 90 wide door → ±90.
    expect(door.maxOffset).toBeCloseTo(90);
    plan = setDoorway(plan, door.key, { offset: 50 });
    const moved = computeDoorways(plan)[0];
    expect(moved.offset).toBe(50);
    expect(moved.center.y).toBeCloseTo(150 + 50 * door.axis.y);
    plan = setDoorway(plan, door.key, { offset: 1000 });
    expect(computeDoorways(plan)[0].offset).toBeCloseTo(90);
  });

  it('keeps disabled doorways, flagged', () => {
    let plan = twoRooms();
    const [door] = computeDoorways(plan);
    plan = setDoorway(plan, door.key, { disabled: true });
    const doors = computeDoorways(plan);
    expect(doors).toHaveLength(1);
    expect(doors[0].disabled).toBe(true);
  });

  it('no doorway when rooms are apart or only touch at a corner', () => {
    const plan = createInitialPlan();
    plan.rooms.push(createRectRoom(510, 0, 400, 300, 'gap'));
    plan.rooms.push(createRectRoom(500, 400, 100, 100, 'corner'));
    expect(computeDoorways(plan)).toHaveLength(0);
  });
});
