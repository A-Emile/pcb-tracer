// ---------------------------------------------------------------- Zustand
import type { AppState, Look } from './types';

export const DPR = Math.min(2, window.devicePixelRatio || 1);
export const S: AppState = {
  db: null, proj: null, mode: 'list',
  t: 0, hold: false, before: false,
  cams: {}, panes: [],
  pre: null, preInv: null, fwd: null, inv: null, loo: [], alignVer: 0,
  pending: null, sel: null, link: true, undo: [],
  loupe: null, preview: null,
  draw: false, pick: new Set<string>(), oundo: [], note: null, stroke: null, omove: null, tr: false,
};

// Ansicht-Einstellungen des offenen Projekts (p.look, Format siehe layers/model.ts)
export function lookState(): Look { const p = S.proj; if (!p.look) p.look = { bahnen: 0, layers: [] }; return p.look; }

// [Vorher] gehalten: Original zeigen (ohne „Bahnen deutlicher“ und Material-Ansicht)
export const fxQuiet = () => !S.proj || !!S.before;
