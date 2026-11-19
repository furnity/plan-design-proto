import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Inspector } from './components/Inspector';
import { JsonDialog } from './components/JsonDialog';
import { PlanEditor, type Selection } from './components/PlanEditor';
import { Viewer3D } from './components/Viewer3D';
import { computeDoorways } from './model/doorways';
import { downloadText, serializePlan } from './model/io';
import { addRoom, createInitialPlan, findRoom, parsePlan, removeRoom, removeVertex, removeWindow } from './model/plan';
import type { Plan } from './model/types';

const STORAGE_KEY = 'floorplan-proto:plan';

function loadInitial(): Plan {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return parsePlan(raw);
  } catch {
    /* ignore corrupt or unavailable storage */
  }
  return createInitialPlan();
}

interface History {
  past: Plan[];
  present: Plan;
  future: Plan[];
}

function useHistory(initial: () => Plan) {
  const [h, setH] = useState<History>(() => ({ past: [], present: initial(), future: [] }));
  return {
    plan: h.present,
    canUndo: h.past.length > 0,
    canRedo: h.future.length > 0,
    /** Replace the current plan, recording an undo step. */
    apply: useCallback((next: Plan) => setH((s) => ({ past: [...s.past.slice(-99), s.present], present: next, future: [] })), []),
    /** Replace the current plan without recording (live drag). */
    preview: useCallback((next: Plan) => setH((s) => ({ ...s, present: next })), []),
    /** Record `origin` as the undo point for the current (previewed) plan. */
    commit: useCallback(
      (origin: Plan) => setH((s) => (s.present === origin ? s : { past: [...s.past.slice(-99), origin], present: s.present, future: [] })),
      [],
    ),
    undo: useCallback(
      () => setH((s) => (s.past.length ? { past: s.past.slice(0, -1), present: s.past[s.past.length - 1], future: [s.present, ...s.future] } : s)),
      [],
    ),
    redo: useCallback(
      () => setH((s) => (s.future.length ? { past: [...s.past, s.present], present: s.future[0], future: s.future.slice(1) } : s)),
      [],
    ),
  };
}

export default function App() {
  const history = useHistory(loadInitial);
  const { plan } = history;
  const [selection, setSelection] = useState<Selection>(() => ({ roomId: plan.rooms[0]?.id }));
  const [grid, setGrid] = useState(10);
  const [show3d, setShow3d] = useState(true);
  const [jsonOpen, setJsonOpen] = useState(false);
  const [fitKey, setFitKey] = useState(0);
  const refit = () => setFitKey((k) => k + 1);
  const [toast, setToast] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const doorways = useMemo(() => computeDoorways(plan), [plan]);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plan));
    } catch {
      /* storage unavailable */
    }
  }, [plan]);

  // Drop selection that no longer exists (after undo, delete, import...).
  useEffect(() => {
    const room = findRoom(plan, selection.roomId);
    if (selection.roomId && !room) setSelection({});
    else if (room && selection.vertex !== undefined && selection.vertex >= room.points.length) setSelection({ roomId: room.id });
    else if (room && selection.wall !== undefined && selection.wall >= room.walls.length) setSelection({ roomId: room.id });
  }, [plan, selection]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  const onAddRoom = () => {
    const res = addRoom(plan, selection.roomId, grid);
    history.apply(res.plan);
    setSelection({ roomId: res.roomId });
    refit();
  };

  const deleteSelected = useCallback(() => {
    const room = findRoom(plan, selection.roomId);
    if (!room) return;
    if (selection.windowId && selection.wall !== undefined) {
      history.apply(removeWindow(plan, room.id, selection.wall, selection.windowId));
      setSelection({ roomId: room.id, wall: selection.wall });
    } else if (selection.vertex !== undefined) {
      const next = removeVertex(plan, room.id, selection.vertex);
      if (next) {
        history.apply(next);
        setSelection({ roomId: room.id });
      } else setToast('Removing this corner would make the room invalid');
    } else {
      history.apply(removeRoom(plan, room.id));
      setSelection({});
    }
  }, [plan, selection, history]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, select')) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) history.redo();
        else history.undo();
      } else if (mod && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        history.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        deleteSelected();
      } else if (e.key === 'Escape') {
        setSelection({});
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [history, deleteSelected]);

  const onImportFile = async (file: File) => {
    try {
      history.apply(parsePlan(await file.text()));
      setSelection({});
      refit();
    } catch (e) {
      setToast(`Import failed: ${(e as Error).message}`);
    }
  };

  return (
    <div className={`app ${show3d ? '' : 'no-3d'}`}>
      <header className="toolbar">
        <h1>Floor plan</h1>
        <button className="primary" onClick={onAddRoom}>
          + Add room
        </button>
        <button
          disabled={!selection.roomId}
          onClick={() => {
            if (!selection.roomId) return;
            history.apply(removeRoom(plan, selection.roomId));
            setSelection({});
          }}
        >
          Remove room
        </button>
        <span className="sep" />
        <button onClick={history.undo} disabled={!history.canUndo} title="Ctrl+Z">
          Undo
        </button>
        <button onClick={history.redo} disabled={!history.canRedo} title="Ctrl+Shift+Z">
          Redo
        </button>
        <span className="sep" />
        <label className="inline">
          Grid
          <select value={grid} onChange={(e) => setGrid(Number(e.target.value))}>
            {[1, 5, 10, 25, 50].map((g) => (
              <option key={g} value={g}>
                {g} cm
              </option>
            ))}
          </select>
        </label>
        <label className="inline">
          <input type="checkbox" checked={show3d} onChange={(e) => setShow3d(e.target.checked)} /> 3D view
        </label>
        <span className="grow" />
        <button onClick={() => setJsonOpen(true)}>Edit JSON</button>
        <button onClick={() => downloadText('floorplan.json', serializePlan(plan))}>Export JSON</button>
        <button onClick={() => fileInput.current?.click()}>Import JSON</button>
        <button
          onClick={() => {
            if (confirm('Start over with a single room?')) {
              const fresh = createInitialPlan();
              history.apply(fresh);
              setSelection({ roomId: fresh.rooms[0].id });
              refit();
            }
          }}
        >
          Reset
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImportFile(f);
            e.target.value = '';
          }}
        />
      </header>

      <main className="workspace">
        <PlanEditor
          plan={plan}
          doorways={doorways}
          selection={selection}
          grid={grid}
          fitKey={fitKey}
          onSelect={setSelection}
          onPreview={history.preview}
          onCommit={history.commit}
          onApply={history.apply}
        />
        {show3d && <Viewer3D plan={plan} fitKey={fitKey} />}
        <Inspector
          plan={plan}
          doorways={doorways}
          selection={selection}
          onSelect={setSelection}
          onApply={history.apply}
          onError={setToast}
        />
      </main>

      {jsonOpen && (
        <JsonDialog
          plan={plan}
          onClose={() => setJsonOpen(false)}
          onApply={(p) => {
            history.apply(p);
            setSelection({});
            refit();
          }}
        />
      )}
      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
