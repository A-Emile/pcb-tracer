import { newWorker } from '../worker/client';
import { affApply } from './geometry';
import { S } from '../state';
import { clamp } from '../util';

// Fang-Anfragen an den Analyse-Worker
export let ana = null, snapSeq = 0;
export const snapWait = new Map();
export function getAna() {
  if (ana) return ana;
  ana = newWorker();
  ana.onmessage = e => {
    const m = e.data;
    if ((m.type === 'snap' || m.type === 'error') && snapWait.has(m.id)) { snapWait.get(m.id)(m.type === 'snap' ? m.hit : null); snapWait.delete(m.id); }
  };
  return ana;
}
export const viaCache = {}, viaWorkers = {};
// eigener Worker je Seite: beide Seiten parallel, und das Einrasten wartet nicht auf die Suche
export function getVias(side, onProg?) {
  const key = S.proj.id + side;
  progWait[side] = onProg;
  if (viaCache[key]) return viaCache[key];
  const w = viaWorkers[side] || (viaWorkers[side] = newWorker());
  w.onmessage = e => {
    const m = e.data;
    if (m.type === 'viaprog') { viaProg[m.side] = m.f; progWait[m.side]?.(m.f); return; }
    if ((m.type === 'vias' || m.type === 'error') && snapWait.has(m.id)) { snapWait.get(m.id)(m.type === 'vias' ? m.vias : null); snapWait.delete(m.id); }
  };
  const id = ++snapSeq, sd = S.proj.sides[side];
  viaCache[key] = new Promise(res => snapWait.set(id, res));
  w.postMessage({ type: 'vias', id, pid: S.proj.id, side, w: sd.w, h: sd.h });
  return viaCache[key];
}
export const viaProg: Record<string, number> = {}, VSTRIDE = 14;
export const progWait = {};
export function snapRaw(side, x, y, R, z = false) {
  const id = ++snapSeq, sd = S.proj.sides[side];
  getAna().postMessage({ type: 'snap', id, pid: S.proj.id, side, w: sd.w, h: sd.h, x, y, R, z });
  return new Promise<any>(res => snapWait.set(id, res));
}
// Pane-Koordinaten → Rohpunkt der Seite, gefangen auf Via falls sicher
export async function snapPane(paneId, wx, wy, R) {
  const side = paneId === 'back' ? 'back' : 'front';
  const raw = side === 'back' ? affApply(S.preInv, wx, wy) : [wx, wy];
  const hit = await snapRaw(side, raw[0], raw[1], R);
  return hit ? { x: hit.x, y: hit.y, r: hit.r, snapped: true } : { x: raw[0], y: raw[1], r: 0, snapped: false };
}
// Fangradius: ~18 CSS-px um das Fadenkreuz, in Bildpixeln; s = Maßstab, in dem gezielt wird (Lupe oder Fenster)
export const snapR = s => clamp(18 / s, 6, 48);
