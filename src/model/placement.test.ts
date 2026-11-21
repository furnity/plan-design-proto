import { describe, expect, it } from 'vitest';
import { computeDoorways } from './doorways';
import { v } from './geometry';
import { resolveRoomMove } from './placement';
import { createInitialPlan, createRectRoom, moveRoom } from './plan';
import type { Plan, Vec2 } from './types';

/** Room 1 is 500 × 400 at the origin. */
function planWith(...rooms: [number, number, number, number][]): Plan {
  const plan = createInitialPlan();
  rooms.forEach(([x, y, w, h], i) => plan.rooms.push(createRectRoom(x, y, w, h, `R${i + 2}`)));
  return plan;
}

const expectDelta = (d: Vec2 | null, x: number, y: number) => {
  expect(d).not.toBeNull();
  expect(d!.x).toBeCloseTo(x);
  expect(d!.y).toBeCloseTo(y);
};

describe('resolveRoomMove', () => {
  it('goes straight to a free target', () => {
    const plan = planWith([-300, 0, 300, 300]);
    expectDelta(resolveRoomMove(plan, plan.rooms[1].id, v(-50, 20), v(0, 0)), -50, 20);
  });

  it('stops flush against a neighbour when overshooting into it', () => {
    const plan = planWith([-400, 0, 300, 300]); // 100 cm gap to Room 1
    const id = plan.rooms[1].id;
    // A fast drag lands 150 cm into Room 1: the room should end up touching it.
    const d = resolveRoomMove(plan, id, v(250, 0), v(0, 0));
    expectDelta(d, 100, 0);
    expect(computeDoorways(moveRoom(plan, id, d!)!)).toHaveLength(1);
  });

  it('slides along the wall while the cursor is inside the neighbour', () => {
    const plan = planWith([-300, 0, 300, 300]); // flush on Room 1's west side
    const id = plan.rooms[1].id;
    // Cursor dragged right and down into Room 1: the room slides down the west wall.
    expectDelta(resolveRoomMove(plan, id, v(80, 60), v(0, 0)), 0, 60);
  });

  it('moves from the west side to the south side in one drag', () => {
    const plan = planWith([-300, 0, 300, 300]);
    const id = plan.rooms[1].id;
    // Aiming at x 0..300 below Room 1 but still overlapping it by 100 cm:
    // nearest free spot is flush under Room 1, not stuck on the west side.
    const d = resolveRoomMove(plan, id, v(300, 300), v(0, 0));
    expectDelta(d, 300, 400);
    const doors = computeDoorways(moveRoom(plan, id, d!)!);
    expect(doors).toHaveLength(1);
  });

  it('settles into the corner between two neighbours', () => {
    // Room 1 (0..500 × 0..400) and a room to its south-east forming an inside corner at (500, 400).
    const plan = planWith([500, 400, 300, 300], [600, -300, 200, 200]);
    const id = plan.rooms[2].id; // 200 × 200 starting at (600, -300)
    // Aim at x 450..650, y 350..550: overlaps both Room 1 and the south-east room.
    const d = resolveRoomMove(plan, id, v(-150, 650), v(0, 0));
    // Nearest free spot is the inside corner: against Room 1's east wall (x = 500)
    // and on top of the south-east room (y = 400), with a doorway to each.
    expectDelta(d, -100, 500);
    expect(computeDoorways(moveRoom(plan, id, d!)!)).toHaveLength(2);
  });

  it('works with non-rectangular rooms', () => {
    const plan = createInitialPlan();
    const tri = createRectRoom(-300, 0, 300, 300, 'tri');
    tri.points = [v(-300, 0), v(-100, 150), v(-300, 300)];
    tri.walls = tri.walls.slice(0, 3);
    plan.rooms.push(tri);
    const d = resolveRoomMove(plan, tri.id, v(250, 0), v(0, 0));
    expect(d).not.toBeNull();
    expect(moveRoom(plan, tri.id, d!)).not.toBeNull();
    // Tip of the triangle ends up on Room 1's west wall.
    expect(-100 + d!.x).toBeCloseTo(0);
  });
});
