/**
 * Floor plan data model. All lengths are in centimetres.
 *
 * Plan coordinates: x grows to the right ("east"), y grows downwards
 * ("south"), matching SVG. In the 3D model, plan (x, y) maps to world (x, z)
 * and heights map to world y (up).
 */

export interface Vec2 {
  x: number;
  y: number;
}

export const FLOOR_TYPES = ['wood', 'stone', 'tile', 'carpet', 'concrete', 'marble'] as const;
export type FloorType = (typeof FLOOR_TYPES)[number];

export interface WindowSpec {
  id: string;
  /** Distance along the wall from its start vertex to the window centre. */
  offset: number;
  width: number;
  height: number;
  /** Distance from the floor to the bottom of the window. */
  sill: number;
}

/** Wall `i` runs from `points[i]` to `points[(i + 1) % n]` of its room. */
export interface Wall {
  id: string;
  thickness: number;
  windows: WindowSpec[];
}

export interface Room {
  id: string;
  name: string;
  /** Outer outline of the room. Walls are built inwards from this outline. */
  points: Vec2[];
  /** One entry per edge, parallel to `points`. */
  walls: Wall[];
  ceilingHeight: number;
  floorType: FloorType;
}

export interface PlanSettings {
  doorWidth: number;
  doorHeight: number;
}

export interface Plan {
  version: 1;
  units: 'cm';
  settings: PlanSettings;
  rooms: Room[];
}

/** Derived from room geometry: one doorway per pair of adjoining rooms. */
export interface Doorway {
  id: string;
  rooms: [string, string];
  /** Wall index in each of the two rooms. */
  walls: [number, number];
  center: Vec2;
  width: number;
  height: number;
}
