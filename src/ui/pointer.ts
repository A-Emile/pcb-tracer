import { ov } from '../render/gl';

// Zeiger und laufende Geste, gemeinsam für ui/gestures.ts (Fenster, Ausrichten) und draw/gestures.ts (Zeichnen, Objekte)
export const ptrs = new Map();
export let gest = null;
export function setGest(g) { gest = g; }

export function evPos(e) { const r = ov.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; }
