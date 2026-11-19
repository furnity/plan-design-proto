import { computeDoorways } from './doorways';
import type { Plan } from './types';

/**
 * Serialise a plan. Doorways are derived data, included for consumers of the
 * JSON; they are recomputed (and ignored) when a plan is loaded.
 */
export function serializePlan(plan: Plan): string {
  return JSON.stringify({ ...plan, doorways: computeDoorways(plan) }, null, 2);
}

export function downloadText(filename: string, text: string, mime = 'application/json') {
  downloadBlob(filename, new Blob([text], { type: mime }));
}

export function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
