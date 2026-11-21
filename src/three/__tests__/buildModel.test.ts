import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { computeDoorways } from '../../model/doorways';
import { createInitialPlan, createRectRoom, setDoorway } from '../../model/plan';
import type { Plan } from '../../model/types';
import { buildPlanModel } from '../buildModel';

/** Room 1 (500 × 400 at the origin) with Room 2 adjoining its east wall. */
const twoRooms = (): Plan => {
  const plan = createInitialPlan();
  plan.rooms.push(createRectRoom(500, 0, 400, 300, 'Room 2'));
  return plan;
};

describe('buildPlanModel', () => {
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

  it('leaves the wall in one piece when the doorway is disabled', () => {
    let plan = twoRooms();
    plan = setDoorway(plan, computeDoorways(plan)[0].key, { disabled: true });
    expect(buildPlanModel(plan).children[0].getObjectByName('wall-1')!.children).toHaveLength(1);
  });
});
