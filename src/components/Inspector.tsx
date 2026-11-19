import { useEffect, useState } from 'react';
import { polygonArea } from '../model/geometry';
import {
  addWindow,
  findRoom,
  moveVertex,
  removeRoom,
  removeVertex,
  removeWindow,
  setDoorway,
  updateRoom,
  updateWall,
  updateWindow,
  wallLength,
} from '../model/plan';
import { FLOOR_TYPES, type Doorway, type FloorType, type Plan } from '../model/types';
import type { Selection } from './PlanEditor';

interface Props {
  plan: Plan;
  doorways: Doorway[];
  selection: Selection;
  onSelect: (s: Selection) => void;
  onApply: (plan: Plan) => void;
  onError: (msg: string) => void;
}

/** Number input that commits on blur / Enter, so typing intermediate values doesn't fight validation. */
function NumberField(props: { label: string; value: number; min?: number; max?: number; step?: number; unit?: string; onChange: (v: number) => void }) {
  const { label, value, min, max, step = 1, unit = 'cm', onChange } = props;
  const [text, setText] = useState(String(round(value)));
  useEffect(() => setText(String(round(value))), [value]);
  const commit = () => {
    const n = Number(text);
    if (text.trim() === '' || !Number.isFinite(n)) return setText(String(round(value)));
    const clamped = Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));
    if (clamped !== value) onChange(clamped);
    setText(String(round(clamped)));
  };
  return (
    <label className="field">
      <span>{label}</span>
      <input
        type="number"
        value={text}
        min={min}
        max={max}
        step={step}
        onChange={(e) => setText(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
      <em>{unit}</em>
    </label>
  );
}

const round = (n: number) => Math.round(n * 10) / 10;

export function Inspector({ plan, doorways, selection, onSelect, onApply, onError }: Props) {
  const room = findRoom(plan, selection.roomId);
  const roomName = (id: string) => findRoom(plan, id)?.name ?? '?';
  const otherRoom = (d: Doorway, id: string) => roomName(d.rooms[0] === id ? d.rooms[1] : d.rooms[0]);

  const settings = (
    <section>
      <h3>Plan</h3>
      <NumberField
        label="Door width"
        value={plan.settings.doorWidth}
        min={50}
        max={300}
        onChange={(doorWidth) => onApply({ ...plan, settings: { ...plan.settings, doorWidth } })}
      />
      <NumberField
        label="Door height"
        value={plan.settings.doorHeight}
        min={150}
        max={400}
        onChange={(doorHeight) => onApply({ ...plan, settings: { ...plan.settings, doorHeight } })}
      />
      <p className="muted">
        {plan.rooms.length} room{plan.rooms.length === 1 ? '' : 's'} · {doorways.filter((d) => !d.disabled).length} doorway
        {doorways.filter((d) => !d.disabled).length === 1 ? '' : 's'}. Doorways are created automatically where rooms
        share a wall; select one to move or disable it.
      </p>
    </section>
  );

  const door = doorways.find((d) => d.key === selection.doorwayKey);
  if (door) {
    return (
      <aside className="inspector">
        <section>
          <h3>Doorway</h3>
          <p>
            {roomName(door.rooms[0])} ↔ {roomName(door.rooms[1])}
          </p>
          <label className="field checkbox">
            <span>Enabled</span>
            <input
              type="checkbox"
              checked={!door.disabled}
              onChange={(e) => onApply(setDoorway(plan, door.key, { disabled: !e.target.checked }))}
            />
          </label>
          <NumberField
            label="Offset"
            value={door.offset}
            min={-door.maxOffset}
            max={door.maxOffset}
            onChange={(offset) => onApply(setDoorway(plan, door.key, { offset }))}
          />
          <p className="muted">
            Distance from the middle of the shared wall (±{Math.round(door.maxOffset)} cm available). Width{' '}
            {Math.round(door.width)} cm, height {Math.round(door.height)} cm. Drag the doorway in the plan to move it.
          </p>
          <button disabled={door.offset === 0} onClick={() => onApply(setDoorway(plan, door.key, { offset: 0 }))}>
            Centre on wall
          </button>
        </section>
        {settings}
      </aside>
    );
  }

  if (!room) {
    return (
      <aside className="inspector">
        {settings}
        <section>
          <p className="muted">Select a room, wall, corner or window in the plan to edit it.</p>
        </section>
      </aside>
    );
  }

  const wallIndex = selection.wall;
  const wall = wallIndex !== undefined ? room.walls[wallIndex] : undefined;
  const vertex = selection.vertex !== undefined ? room.points[selection.vertex] : undefined;

  return (
    <aside className="inspector">
      <section>
        <h3>Room</h3>
        <label className="field">
          <span>Name</span>
          <input value={room.name} onChange={(e) => onApply(updateRoom(plan, room.id, { name: e.target.value }))} />
        </label>
        <NumberField
          label="Ceiling height"
          value={room.ceilingHeight}
          min={180}
          max={600}
          onChange={(ceilingHeight) => onApply(updateRoom(plan, room.id, { ceilingHeight }))}
        />
        <label className="field">
          <span>Floor</span>
          <select
            value={room.floorType}
            onChange={(e) => onApply(updateRoom(plan, room.id, { floorType: e.target.value as FloorType }))}
          >
            {FLOOR_TYPES.map((t) => (
              <option key={t} value={t}>
                {t[0].toUpperCase() + t.slice(1)}
              </option>
            ))}
          </select>
        </label>
        <p className="muted">Area {(polygonArea(room.points) / 10000).toFixed(2)} m²</p>
        <button
          className="danger"
          onClick={() => {
            onApply(removeRoom(plan, room.id));
            onSelect({});
          }}
        >
          Remove room
        </button>
      </section>

      <section>
        <h3>Walls</h3>
        <table className="walls">
          <thead>
            <tr>
              <th>#</th>
              <th>Length</th>
              <th>Thickness</th>
              <th>Win.</th>
            </tr>
          </thead>
          <tbody>
            {room.walls.map((w, i) => (
              <tr
                key={w.id}
                className={i === wallIndex ? 'selected' : ''}
                onClick={() => onSelect({ roomId: room.id, wall: i })}
              >
                <td>{i + 1}</td>
                <td>{Math.round(wallLength(room, i))} cm</td>
                <td>{w.thickness} cm</td>
                <td>{w.windows.length}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {doorways.some((d) => d.rooms.includes(room.id)) && (
        <section>
          <h3>Doorways</h3>
          {doorways
            .filter((d) => d.rooms.includes(room.id))
            .map((d) => (
              <div key={d.key} className="doorway-row">
                <input
                  type="checkbox"
                  title={d.disabled ? 'Enable doorway' : 'Disable doorway'}
                  checked={!d.disabled}
                  onChange={(e) => onApply(setDoorway(plan, d.key, { disabled: !e.target.checked }))}
                />
                <button className="link" onClick={() => onSelect({ doorwayKey: d.key })}>
                  To {otherRoom(d, room.id)}
                </button>
                <span className="muted">{d.disabled ? 'disabled' : `${Math.round(d.width)} cm`}</span>
              </div>
            ))}
        </section>
      )}

      {wall && wallIndex !== undefined && (
        <section>
          <h3>Wall {wallIndex + 1}</h3>
          <NumberField
            label="Thickness"
            value={wall.thickness}
            min={1}
            max={60}
            onChange={(thickness) => onApply(updateWall(plan, room.id, wallIndex, { thickness }))}
          />
          <button
            onClick={() => {
              const res = addWindow(plan, room.id, wallIndex);
              if (!res) return;
              onApply(res.plan);
              onSelect({ roomId: room.id, wall: wallIndex, windowId: res.windowId });
            }}
          >
            + Add window
          </button>
          {wall.windows.map((win, k) => (
            <div key={win.id} className={`window-card ${selection.windowId === win.id ? 'selected' : ''}`}>
              <div className="window-card-head" onClick={() => onSelect({ roomId: room.id, wall: wallIndex, windowId: win.id })}>
                <strong>Window {k + 1}</strong>
                <button
                  className="link danger"
                  onClick={(e) => {
                    e.stopPropagation();
                    onApply(removeWindow(plan, room.id, wallIndex, win.id));
                    onSelect({ roomId: room.id, wall: wallIndex });
                  }}
                >
                  Remove
                </button>
              </div>
              <NumberField label="Width" value={win.width} min={10} onChange={(width) => onApply(updateWindow(plan, room.id, wallIndex, win.id, { width }))} />
              <NumberField label="Height" value={win.height} min={10} onChange={(height) => onApply(updateWindow(plan, room.id, wallIndex, win.id, { height }))} />
              <NumberField label="From floor" value={win.sill} min={0} onChange={(sill) => onApply(updateWindow(plan, room.id, wallIndex, win.id, { sill }))} />
              <NumberField label="Centre at" value={win.offset} min={0} onChange={(offset) => onApply(updateWindow(plan, room.id, wallIndex, win.id, { offset }))} />
            </div>
          ))}
        </section>
      )}

      {vertex && selection.vertex !== undefined && (
        <section>
          <h3>Corner {selection.vertex + 1}</h3>
          <NumberField
            label="X"
            value={vertex.x}
            onChange={(x) => {
              const next = moveVertex(plan, room.id, selection.vertex!, { x, y: vertex.y });
              if (next) onApply(next);
              else onError('That position would make rooms overlap or the outline self-intersect');
            }}
          />
          <NumberField
            label="Y"
            value={vertex.y}
            onChange={(y) => {
              const next = moveVertex(plan, room.id, selection.vertex!, { x: vertex.x, y });
              if (next) onApply(next);
              else onError('That position would make rooms overlap or the outline self-intersect');
            }}
          />
          <button
            disabled={room.points.length <= 3}
            onClick={() => {
              const next = removeVertex(plan, room.id, selection.vertex!);
              if (next) {
                onApply(next);
                onSelect({ roomId: room.id });
              } else onError('Removing this corner would make the room invalid');
            }}
          >
            Remove corner
          </button>
        </section>
      )}

      {settings}
    </aside>
  );
}
