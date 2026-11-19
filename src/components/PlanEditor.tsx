import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  add,
  bounds,
  centroid,
  cross,
  dist,
  dot,
  polygonArea,
  projectOnSegment,
  scale,
  snap,
  sub,
  v,
} from '../model/geometry';
import {
  edgeNormal,
  edgeOf,
  findRoom,
  insertVertex,
  MIN_EDGE_LENGTH,
  moveEdge,
  moveRoom,
  moveVertex,
  setDoorway,
  updateWindow,
} from '../model/plan';
import { FLOOR_TYPES, type Doorway, type Plan, type Room, type Vec2 } from '../model/types';
import { roomWallLayouts, sliceWall, wallFootprint, wallPoint, type WallLayout } from '../model/walls';
import { FLOOR_COLORS, floorTextureDataUrl, floorTextureSizeCm } from '../three/textures';

export interface Selection {
  roomId?: string;
  wall?: number;
  vertex?: number;
  windowId?: string;
  /** Selected doorway (`Doorway.key`); used without `roomId`. */
  doorwayKey?: string;
}

interface Props {
  plan: Plan;
  doorways: Doorway[];
  selection: Selection;
  grid: number;
  /** Change to re-fit the view to the plan. */
  fitKey: number;
  onSelect: (s: Selection) => void;
  /** Live update during a drag (no undo entry). */
  onPreview: (plan: Plan) => void;
  /** Drag finished: record `origin` as the undo point. */
  onCommit: (origin: Plan) => void;
  /** Discrete change with its own undo entry. */
  onApply: (plan: Plan) => void;
}

interface View {
  x: number;
  y: number;
  /** Pixels per centimetre. */
  zoom: number;
}

type Drag =
  | { kind: 'pan'; startClient: Vec2; startView: View; moved: boolean }
  | { kind: 'room'; roomId: string; start: Vec2; origin: Plan; moved: boolean }
  /** `undoTo`: plan to restore on undo when it differs from `origin` (a corner inserted at drag start). */
  /** `grab`: offset from the pointer to the corner, when the drag didn't start on the corner itself. */
  | { kind: 'vertex'; roomId: string; index: number; origin: Plan; moved: boolean; undoTo?: Plan; grab?: Vec2 }
  | { kind: 'edge'; roomId: string; index: number; start: Vec2; origin: Plan; moved: boolean }
  | { kind: 'window'; roomId: string; wall: number; windowId: string; origin: Plan; moved: boolean }
  | { kind: 'doorway'; door: Doorway; grab: number; origin: Plan; moved: boolean };

const SNAP_PX = 10;

const pointsAttr = (pts: Vec2[]) => pts.map((p) => `${p.x},${p.y}`).join(' ');

/** Snap a point to other rooms' corners, then their walls, then the grid. */
function snapPoint(p: Vec2, plan: Plan, roomId: string, thr: number, grid: number): Vec2 {
  let best: Vec2 | null = null;
  let bestD = thr;
  const others = plan.rooms.filter((r) => r.id !== roomId);
  for (const r of others)
    for (const q of r.points) {
      const d = dist(p, q);
      if (d < bestD) [best, bestD] = [q, d];
    }
  if (best) return best;
  for (const r of others)
    for (let i = 0; i < r.points.length; i++) {
      const [a, b] = edgeOf(r, i);
      const proj = projectOnSegment(p, a, b);
      if (proj.distance < bestD) [best, bestD] = [proj.point, proj.distance];
    }
  return best ?? v(snap(p.x, grid), snap(p.y, grid));
}

/** Snap a room translation so corners meet other rooms' corners or align on x/y, else to the grid. */
function snapRoomDelta(room: Room, raw: Vec2, plan: Plan, thr: number, grid: number): Vec2 {
  const others = plan.rooms.filter((r) => r.id !== room.id).flatMap((r) => r.points);
  let best: Vec2 | null = null;
  let bestD = thr;
  for (const p of room.points)
    for (const q of others) {
      const d = dist(add(p, raw), q);
      if (d < bestD) [best, bestD] = [sub(q, p), d];
    }
  if (best) return best;
  let dx = snap(raw.x, grid);
  let dy = snap(raw.y, grid);
  let bx = thr;
  let by = thr;
  for (const p of room.points)
    for (const q of others) {
      const ex = Math.abs(p.x + raw.x - q.x);
      const ey = Math.abs(p.y + raw.y - q.y);
      if (ex < bx) [bx, dx] = [ex, q.x - p.x];
      if (ey < by) [by, dy] = [ey, q.y - p.y];
    }
  return v(dx, dy);
}

/** Offset of an edge drag along its normal, snapped to other rooms' corners or the grid. */
function snapEdgeDelta(room: Room, index: number, raw: Vec2, plan: Plan, thr: number, grid: number, free: boolean): Vec2 {
  if (free) return v(snap(raw.x, grid), snap(raw.y, grid));
  const nrm = edgeNormal(room, index);
  const [a] = edgeOf(room, index);
  const base = dot(a, nrm);
  let c = base + dot(raw, nrm);
  let target: number | null = null;
  let best = thr;
  for (const r of plan.rooms) {
    if (r.id === room.id) continue;
    for (const q of r.points) {
      const e = Math.abs(dot(q, nrm) - c);
      if (e < best) [best, target] = [e, dot(q, nrm)];
    }
  }
  const axisAligned = Math.abs(nrm.x) > 0.9999 || Math.abs(nrm.y) > 0.9999;
  if (target !== null) c = target;
  else c = axisAligned ? snap(c, grid) : base + snap(c - base, grid);
  return scale(nrm, c - base);
}

function edgeCursor(w: WallLayout) {
  const horizontal = Math.abs(w.dir.x) > Math.abs(w.dir.y);
  return horizontal ? 'ns-resize' : 'ew-resize';
}

export function PlanEditor({ plan, doorways, selection, grid, fitKey, onSelect, onPreview, onCommit, onApply }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [view, setView] = useState<View>({ x: -100, y: -100, zoom: 1 });
  const [blocked, setBlocked] = useState(false);
  const drag = useRef<Drag | null>(null);
  const fitted = useRef(false);

  const layouts = useMemo(
    () => new Map(plan.rooms.map((r) => [r.id, roomWallLayouts(r, doorways)])),
    [plan, doorways],
  );

  const fit = () => {
    const pts = plan.rooms.flatMap((r) => r.points);
    if (!pts.length) return;
    const b = bounds(pts);
    const pad = 80;
    const zoom = Math.min(size.w / (b.maxX - b.minX + 2 * pad), size.h / (b.maxY - b.minY + 2 * pad));
    setView({
      zoom,
      x: (b.minX + b.maxX) / 2 - size.w / zoom / 2,
      y: (b.minY + b.maxY) / 2 - size.h / zoom / 2,
    });
  };

  useLayoutEffect(() => {
    const svg = svgRef.current!;
    const ro = new ResizeObserver(() => {
      const r = svg.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    });
    ro.observe(svg);
    return () => ro.disconnect();
  }, []);

  // Fit once the SVG has been measured, and again whenever the parent bumps `fitKey`.
  useEffect(() => {
    fitted.current = false;
  }, [fitKey]);
  useEffect(() => {
    if (!fitted.current && size.w > 1) {
      fit();
      fitted.current = true;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [size, fitKey, plan]);

  // Wheel zoom around the cursor (non-passive so the page doesn't scroll).
  useEffect(() => {
    const svg = svgRef.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = svg.getBoundingClientRect();
      const sx = e.clientX - rect.left;
      const sy = e.clientY - rect.top;
      setView((vw) => {
        const zoom = Math.min(20, Math.max(0.05, vw.zoom * Math.exp(-e.deltaY * 0.0015)));
        const wx = vw.x + sx / vw.zoom;
        const wy = vw.y + sy / vw.zoom;
        return { zoom, x: wx - sx / zoom, y: wy - sy / zoom };
      });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  const toWorld = (e: { clientX: number; clientY: number }): Vec2 => {
    const rect = svgRef.current!.getBoundingClientRect();
    return v(view.x + (e.clientX - rect.left) / view.zoom, view.y + (e.clientY - rect.top) / view.zoom);
  };

  const begin = (e: React.PointerEvent, d: Drag) => {
    if (e.button !== 0 && d.kind !== 'pan') return;
    e.stopPropagation();
    drag.current = d;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    // Capture lazily: capturing on pointerdown would retarget click/dblclick to the SVG.
    const svg = svgRef.current!;
    if (!svg.hasPointerCapture(e.pointerId)) svg.setPointerCapture(e.pointerId);
    const thr = SNAP_PX / view.zoom;
    const p = toWorld(e);
    if (d.kind === 'pan') {
      const dx = e.clientX - d.startClient.x;
      const dy = e.clientY - d.startClient.y;
      if (Math.hypot(dx, dy) > 3) d.moved = true;
      setView({ ...d.startView, x: d.startView.x - dx / view.zoom, y: d.startView.y - dy / view.zoom });
      return;
    }
    if (d.kind === 'doorway') {
      // Slide along the shared wall stretch, keeping the grab point under the cursor.
      const { door } = d;
      const along = dot(sub(p, door.stretchCenter), door.axis) - d.grab;
      const offset = Math.min(door.maxOffset, Math.max(-door.maxOffset, snap(along, 5)));
      d.moved = true;
      onPreview(setDoorway(d.origin, door.key, { offset }));
      return;
    }
    const room = findRoom(d.origin, d.roomId);
    if (!room) return;
    let next: Plan | null = null;
    switch (d.kind) {
      case 'room': {
        const delta = snapRoomDelta(room, sub(p, d.start), d.origin, thr, grid);
        next = moveRoom(d.origin, d.roomId, delta);
        break;
      }
      case 'vertex':
        next = moveVertex(d.origin, d.roomId, d.index, snapPoint(d.grab ? add(p, d.grab) : p, d.origin, d.roomId, thr, grid));
        break;
      case 'edge': {
        const delta = snapEdgeDelta(room, d.index, sub(p, d.start), d.origin, thr, grid, e.shiftKey);
        next = moveEdge(d.origin, d.roomId, d.index, delta);
        break;
      }
      case 'window': {
        const [a, b] = edgeOf(room, d.wall);
        const dir = scale(sub(b, a), 1 / dist(a, b));
        const s = snap(dot(sub(p, a), dir), 5);
        next = updateWindow(d.origin, d.roomId, d.wall, d.windowId, { offset: s });
        break;
      }
    }
    d.moved = true;
    if (next) onPreview(next);
    setBlocked(!next);
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    setBlocked(false);
    if (!d) return;
    if (d.kind === 'pan') {
      if (!d.moved) onSelect({});
    } else if (d.moved) {
      onCommit(d.kind === 'vertex' && d.undoTo ? d.undoTo : d.origin);
    }
  };

  const startPan = (e: React.PointerEvent) =>
    begin(e, { kind: 'pan', startClient: v(e.clientX, e.clientY), startView: view, moved: false });

  const onDoubleClickWall = (e: React.MouseEvent, room: Room, index: number) => {
    e.stopPropagation();
    const p = toWorld(e);
    const [a, b] = edgeOf(room, index);
    const proj = projectOnSegment(p, a, b);
    const next = insertVertex(plan, room.id, index, proj.point);
    if (next) {
      onApply(next);
      onSelect({ roomId: room.id, vertex: index + 1 });
    }
  };

  const px = 1 / view.zoom;
  const selRoom = findRoom(plan, selection.roomId);
  const viewW = size.w / view.zoom;
  const viewH = size.h / view.zoom;

  return (
    <div className="editor">
      <svg
        ref={svgRef}
        className="plan-svg"
        viewBox={`${view.x} ${view.y} ${Math.max(viewW, 1e-3)} ${Math.max(viewH, 1e-3)}`}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPointerDown={(e) => {
          if (e.button === 1) startPan(e);
        }}
      >
        <defs>
          <pattern id="grid-minor" width={grid} height={grid} patternUnits="userSpaceOnUse">
            <path d={`M ${grid} 0 L 0 0 0 ${grid}`} fill="none" className="grid-minor" strokeWidth={px} />
          </pattern>
          <pattern id="grid-major" width={100} height={100} patternUnits="userSpaceOnUse">
            {grid * view.zoom >= 5 && <rect width={100} height={100} fill="url(#grid-minor)" />}
            <path d="M 100 0 L 0 0 0 100" fill="none" className="grid-major" strokeWidth={px} />
          </pattern>
          {FLOOR_TYPES.map((t) => {
            const url = floorTextureDataUrl(t);
            const s = floorTextureSizeCm(t);
            return (
              <pattern key={t} id={`floor-${t}`} width={s} height={s} patternUnits="userSpaceOnUse">
                <rect width={s} height={s} fill={FLOOR_COLORS[t]} />
                {url && <image href={url} width={s} height={s} preserveAspectRatio="none" />}
              </pattern>
            );
          })}
        </defs>

        <rect
          className="background"
          x={view.x}
          y={view.y}
          width={viewW}
          height={viewH}
          fill="url(#grid-major)"
          onPointerDown={startPan}
        />

        {/* Floors */}
        {plan.rooms.map((room) => (
          <polygon
            key={room.id}
            className={`floor ${room.id === selection.roomId ? 'selected' : ''}`}
            points={pointsAttr(room.points)}
            fill={`url(#floor-${room.floorType})`}
            onPointerDown={(e) => {
              onSelect({ roomId: room.id });
              begin(e, { kind: 'room', roomId: room.id, start: toWorld(e), origin: plan, moved: false });
            }}
          />
        ))}

        {/* Walls */}
        {plan.rooms.map((room) =>
          layouts.get(room.id)!.map((w) => {
            const wallSelected = room.id === selection.roomId && selection.wall === w.index;
            return sliceWall(w).map((slice, k) => {
              // Doors are gaps; windows are drawn by the overlay layer.
              if (slice.openings.length) return null;
              const pts = pointsAttr(wallFootprint(w, slice.a, slice.b));
              return (
                <polygon
                  key={`${room.id}-${w.index}-${k}`}
                  className={`wall ${wallSelected ? 'selected' : ''}`}
                  points={pts}
                />
              );
            });
          }),
        )}

        {/* Door swings */}
        {doorways.map((door) => {
          if (door.disabled) return null;
          const w = layouts.get(door.rooms[0])?.[door.walls[0]];
          const o = w?.openings.find((x) => x.id === door.id);
          if (!w || !o) return null;
          const width = o.end - o.start;
          const hinge = wallPoint(w, o.start, 1);
          const leaf = add(hinge, scale(w.normal, width));
          const closed = wallPoint(w, o.end, 1);
          const sweep = cross(w.normal, w.dir) > 0 ? 1 : 0;
          return (
            <g key={door.id} className="door">
              <line x1={hinge.x} y1={hinge.y} x2={leaf.x} y2={leaf.y} strokeWidth={2 * px} />
              <path
                d={`M ${leaf.x} ${leaf.y} A ${width} ${width} 0 0 ${sweep} ${closed.x} ${closed.y}`}
                strokeWidth={px}
                strokeDasharray={`${4 * px} ${3 * px}`}
              />
            </g>
          );
        })}

        {/* Interactive overlays */}
        {plan.rooms.map((room) => {
          const ls = layouts.get(room.id)!;
          const isSel = room.id === selection.roomId;
          const c = centroid(room.points);
          return (
            <g key={room.id}>
              {ls.map((w) => {
                const a = wallPoint(w, 0, 0.5);
                const b = wallPoint(w, w.length, 0.5);
                return (
                  <line
                    key={`hit-${w.index}`}
                    className="edge-hit"
                    x1={a.x}
                    y1={a.y}
                    x2={b.x}
                    y2={b.y}
                    strokeWidth={Math.max(w.thickness, 12 * px)}
                    style={{ cursor: edgeCursor(w) }}
                    onPointerDown={(e) => {
                      onSelect({ roomId: room.id, wall: w.index });
                      begin(e, { kind: 'edge', roomId: room.id, index: w.index, start: toWorld(e), origin: plan, moved: false });
                    }}
                    onDoubleClick={(e) => onDoubleClickWall(e, room, w.index)}
                  >
                    <title>Drag to move wall (Shift: free move) · double-click to add a corner</title>
                  </line>
                );
              })}

              {room.walls.map((wall, wi) =>
                wall.windows.map((win) => {
                  const w = ls[wi];
                  const o = w.openings.find((x) => x.id === win.id);
                  if (!o) return null;
                  const a = wallPoint(w, o.start, 0.5);
                  const b = wallPoint(w, o.end, 0.5);
                  const sel = selection.windowId === win.id;
                  return (
                    <g key={win.id} className={`window ${sel ? 'selected' : ''}`}>
                      <polygon points={pointsAttr(wallFootprint(w, o.start, o.end))} strokeWidth={px} />
                      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={1.5 * px} />
                      <line
                        className="window-hit"
                        x1={a.x}
                        y1={a.y}
                        x2={b.x}
                        y2={b.y}
                        strokeWidth={Math.max(w.thickness, 12 * px)}
                        onPointerDown={(e) => {
                          onSelect({ roomId: room.id, wall: wi, windowId: win.id });
                          begin(e, { kind: 'window', roomId: room.id, wall: wi, windowId: win.id, origin: plan, moved: false });
                        }}
                      >
                        <title>Drag to slide the window along the wall</title>
                      </line>
                    </g>
                  );
                }),
              )}

              <text className="room-label" x={c.x} y={c.y} fontSize={13 * px} textAnchor="middle">
                {room.name}
              </text>
              <text className="room-area" x={c.x} y={c.y + 16 * px} fontSize={11 * px} textAnchor="middle">
                {(polygonArea(room.points) / 10000).toFixed(1)} m² · h {room.ceilingHeight} cm
              </text>

              {isSel &&
                ls.map((w) => {
                  const mid = add(wallPoint(w, w.length / 2, 0), scale(w.normal, -16 * px));
                  return (
                    <text key={`dim-${w.index}`} className="dim" x={mid.x} y={mid.y + 4 * px} fontSize={11 * px} textAnchor="middle">
                      {(w.length / 100).toFixed(2)} m
                    </text>
                  );
                })}
            </g>
          );
        })}

        {/* Doorways: drag to slide along the shared wall; disabled ones show as a dashed marker */}
        {doorways.map((door) => {
          const wa = layouts.get(door.rooms[0])?.[door.walls[0]];
          const wb = layouts.get(door.rooms[1])?.[door.walls[1]];
          if (!wa || !wb) return null;
          const s = dot(sub(door.center, wa.p0), wa.dir);
          const half = door.width / 2;
          // Span both back-to-back walls: room A's inner face to room B's inner face.
          const footprint = [
            wallPoint(wa, s - half, 1),
            wallPoint(wa, s + half, 1),
            add(wallPoint(wa, s + half, 0), scale(wa.normal, -wb.thickness)),
            add(wallPoint(wa, s - half, 0), scale(wa.normal, -wb.thickness)),
          ];
          const sel = selection.doorwayKey === door.key;
          return (
            <polygon
              key={`hit-${door.key}`}
              className={`doorway-hit ${door.disabled ? 'disabled' : ''} ${sel ? 'selected' : ''}`}
              points={pointsAttr(footprint)}
              strokeWidth={1.5 * px}
              strokeDasharray={door.disabled ? `${4 * px} ${3 * px}` : undefined}
              onPointerDown={(e) => {
                onSelect({ doorwayKey: door.key });
                const grab = dot(sub(toWorld(e), door.stretchCenter), door.axis) - door.offset;
                begin(e, { kind: 'doorway', door, grab, origin: plan, moved: false });
              }}
            >
              <title>
                {door.disabled ? 'Disabled doorway · select to re-enable' : 'Drag to move doorway · Delete to disable'}
              </title>
            </polygon>
          );
        })}

        {selRoom &&
          selRoom.points.map((p, i) => (
            <circle
              key={i}
              className={`vertex ${selection.vertex === i ? 'selected' : ''}`}
              cx={p.x}
              cy={p.y}
              r={6 * px}
              strokeWidth={2 * px}
              onPointerDown={(e) => {
                onSelect({ roomId: selRoom.id, vertex: i });
                begin(e, { kind: 'vertex', roomId: selRoom.id, index: i, origin: plan, moved: false });
              }}
            >
              <title>Drag to move corner · Delete to remove</title>
            </circle>
          ))}

        {/* "+" just inside each wall's midpoint (clear of doorways): click to add a corner there, or drag to pull one out */}
        {selRoom &&
          selRoom.points.map((_, i) => {
            const [a, b] = edgeOf(selRoom, i);
            if (dist(a, b) < 2 * MIN_EDGE_LENGTH) return null;
            const w = layouts.get(selRoom.id)![i];
            const mid = scale(add(a, b), 0.5);
            const r = 5 * px;
            const m = add(mid, scale(w.normal, w.thickness + r + 4 * px));
            return (
              <g
                key={`add-${i}`}
                className="add-vertex"
                onPointerDown={(e) => {
                  const next = insertVertex(plan, selRoom.id, i, mid);
                  if (!next) return;
                  onPreview(next);
                  onSelect({ roomId: selRoom.id, vertex: i + 1 });
                  // moved: true so even a plain click is committed as one undo step.
                  const grab = sub(mid, toWorld(e));
                  begin(e, { kind: 'vertex', roomId: selRoom.id, index: i + 1, origin: next, undoTo: plan, moved: true, grab });
                }}
              >
                <circle cx={m.x} cy={m.y} r={r} strokeWidth={1.5 * px} />
                <path
                  d={`M ${m.x - r * 0.55} ${m.y} H ${m.x + r * 0.55} M ${m.x} ${m.y - r * 0.55} V ${m.y + r * 0.55}`}
                  strokeWidth={1.5 * px}
                />
                <title>Click or drag to add a corner</title>
              </g>
            );
          })}
      </svg>

      <div className="editor-hud">
        <button onClick={fit}>Fit</button>
        <span>{Math.round(view.zoom * 100)}%</span>
      </div>
      {blocked && <div className="editor-blocked">Rooms can't overlap or self-intersect</div>}
      <div className="editor-help">
        Drag floor: move room · drag wall: move wall · + or double-click wall: add corner · drag background: pan · wheel: zoom
      </div>
    </div>
  );
}
