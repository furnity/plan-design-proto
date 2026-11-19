import * as THREE from 'three';
import { computeDoorways } from '../model/doorways';
import { add, scale } from '../model/geometry';
import type { Plan, Room, Vec2 } from '../model/types';
import { roomWallLayouts, sliceWall, wallFootprint, type WallLayout } from '../model/walls';
import { FLOOR_COLORS, floorTexture } from './textures';

/**
 * Build a Three.js scene graph from a plan (or plan JSON).
 *
 * Units: plan centimetres become metres. Plan (x, y) maps to world (x, z),
 * heights map to world y. The result is a plain THREE.Group, so it can be
 * added to any scene, serialised with `group.toJSON()` (THREE.ObjectLoader
 * format) or exported with GLTFExporter.
 */

export interface BuildOptions {
  ceilings?: boolean;
}

const CM = 0.01;

const wallMaterial = new THREE.MeshStandardMaterial({ color: 0xf2efe9, roughness: 0.9, name: 'wall' });
const glassMaterial = new THREE.MeshPhysicalMaterial({
  color: 0x9fc9e6,
  transparent: true,
  opacity: 0.35,
  roughness: 0.05,
  metalness: 0,
  side: THREE.DoubleSide,
  depthWrite: false,
  name: 'glass',
});
const frameMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.6, name: 'window-frame' });
const ceilingMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, side: THREE.DoubleSide, name: 'ceiling' });

/** Plan polygon → THREE.Shape in metres, with y negated so that rotateX(-90°) lands plan y on world +z. */
function toShape(pts: Vec2[]) {
  return new THREE.Shape(pts.map((p) => new THREE.Vector2(p.x * CM, -p.y * CM)));
}

/** Vertical prism over a plan footprint, from z0 to z1 (cm). */
function prism(footprint: Vec2[], z0: number, z1: number) {
  const geom = new THREE.ExtrudeGeometry(toShape(footprint), { depth: (z1 - z0) * CM, bevelEnabled: false });
  geom.rotateX(-Math.PI / 2);
  geom.translate(0, z0 * CM, 0);
  return geom;
}

function floorMaterial(room: Room) {
  return new THREE.MeshStandardMaterial({
    color: floorTexture(room.floorType) ? 0xffffff : FLOOR_COLORS[room.floorType],
    map: floorTexture(room.floorType),
    roughness: room.floorType === 'marble' || room.floorType === 'tile' ? 0.35 : 0.85,
    name: `floor-${room.floorType}`,
  });
}

function buildWall(layout: WallLayout, room: Room): THREE.Group {
  const group = new THREE.Group();
  group.name = `wall-${layout.index}`;
  group.userData = { kind: 'wall', roomId: room.id, wallIndex: layout.index, wallId: room.walls[layout.index].id };

  for (const slice of sliceWall(layout)) {
    const footprint = wallFootprint(layout, slice.a, slice.b);
    for (const [z0, z1] of slice.solids) {
      const mesh = new THREE.Mesh(prism(footprint, z0, z1), wallMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
  }

  for (const o of layout.openings) {
    if (o.kind !== 'window') continue;
    const width = (o.end - o.start) * CM;
    const height = (o.top - o.bottom) * CM;
    const mid = (o.start + o.end) / 2;
    const c = add(add(layout.p0, scale(layout.dir, mid)), scale(layout.normal, layout.thickness / 2));
    const angle = Math.atan2(-layout.dir.y, layout.dir.x);

    const win = new THREE.Group();
    win.name = `window-${o.id}`;
    win.userData = { kind: 'window', roomId: room.id, wallIndex: layout.index, windowId: o.id };
    win.position.set(c.x * CM, ((o.bottom + o.top) / 2) * CM, c.y * CM);
    win.rotation.y = angle;

    const glass = new THREE.Mesh(new THREE.PlaneGeometry(width, height), glassMaterial);
    glass.renderOrder = 1;
    win.add(glass);

    const f = 0.04;
    const depth = Math.min(layout.thickness * CM, 0.08);
    const bars: [number, number, number, number][] = [
      [0, height / 2 - f / 2, width, f],
      [0, -height / 2 + f / 2, width, f],
      [-width / 2 + f / 2, 0, f, height],
      [width / 2 - f / 2, 0, f, height],
    ];
    for (const [x, y, w, h] of bars) {
      const bar = new THREE.Mesh(new THREE.BoxGeometry(w, h, depth), frameMaterial);
      bar.position.set(x, y, 0);
      bar.castShadow = true;
      win.add(bar);
    }
    group.add(win);
  }
  return group;
}

export function buildPlanModel(plan: Plan, options: BuildOptions = {}): THREE.Group {
  const doorways = computeDoorways(plan);
  const root = new THREE.Group();
  root.name = 'floor-plan';
  root.userData = { kind: 'plan', doorways };

  for (const room of plan.rooms) {
    const group = new THREE.Group();
    group.name = room.name;
    group.userData = {
      kind: 'room',
      roomId: room.id,
      ceilingHeight: room.ceilingHeight,
      floorType: room.floorType,
    };

    const floorGeom = new THREE.ShapeGeometry(toShape(room.points));
    floorGeom.rotateX(-Math.PI / 2);
    const floor = new THREE.Mesh(floorGeom, floorMaterial(room));
    floor.name = 'floor';
    floor.userData = { kind: 'floor', roomId: room.id };
    floor.receiveShadow = true;
    group.add(floor);

    for (const layout of roomWallLayouts(room, doorways)) {
      group.add(buildWall(layout, room));
    }

    if (options.ceilings) {
      const ceilGeom = new THREE.ShapeGeometry(toShape(room.points));
      ceilGeom.rotateX(-Math.PI / 2);
      ceilGeom.translate(0, room.ceilingHeight * CM, 0);
      const ceiling = new THREE.Mesh(ceilGeom, ceilingMaterial);
      ceiling.name = 'ceiling';
      ceiling.userData = { kind: 'ceiling', roomId: room.id };
      group.add(ceiling);
    }

    root.add(group);
  }
  return root;
}

/** Dispose geometries created by buildPlanModel (shared materials/textures are kept). */
export function disposeModel(root: THREE.Object3D) {
  root.traverse((obj) => {
    if (obj instanceof THREE.Mesh) {
      obj.geometry.dispose();
      if (obj.material instanceof THREE.Material && obj.material.name.startsWith('floor-')) obj.material.dispose();
    }
  });
}
