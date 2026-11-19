import { useState } from 'react';
import { parsePlan } from '../model/plan';
import { serializePlan } from '../model/io';
import type { Plan } from '../model/types';

interface Props {
  plan: Plan;
  onApply: (plan: Plan) => void;
  onClose: () => void;
}

export function JsonDialog({ plan, onApply, onClose }: Props) {
  const [text, setText] = useState(() => serializePlan(plan));
  const [error, setError] = useState<string | null>(null);

  const apply = () => {
    try {
      onApply(parsePlan(text));
      onClose();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return (
    <div className="modal-backdrop" onPointerDown={onClose}>
      <div className="modal" onPointerDown={(e) => e.stopPropagation()}>
        <header>
          <h2>Plan JSON</h2>
          <button className="link" onClick={onClose}>
            Close
          </button>
        </header>
        <p className="muted">
          Lengths are in cm. <code>doorways</code> is derived from the geometry and recomputed on load.
        </p>
        <textarea spellCheck={false} value={text} onChange={(e) => setText(e.target.value)} />
        {error && <p className="error">{error}</p>}
        <footer>
          <button onClick={apply} className="primary">
            Apply
          </button>
        </footer>
      </div>
    </div>
  );
}
