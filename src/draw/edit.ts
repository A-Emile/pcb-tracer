import { buildMenu } from './menu';
import { updateDrawUI } from './mode';
import { newConflicts, netSync } from './nets';
import { closeNote } from './note';
import { trCheck, trConflict, updateTrUI } from './trace';
import { TR_TYPES, clone, geoCache, objMap, objsChanged, reanchor } from './objects';
import { S } from '../state';
import { toast, toastLater } from '../ui/toast';
import { $ } from '../util';

// ---- Änderungen mit Rückgängig: edit(fn) gibt fn ein Werkzeug { put(obj), del(id), mod(id, f) } und speichert
// die Patches [id, vorher, nachher]; Rückgängig setzt „vorher“ wieder ein (null = gab es nicht), Wiederholen „nachher“.
// Betrifft eine Änderung Bahnen, gleicht netSync (nets.ts) im selben Schritt die Netz-Objekte ab.
export function edit(fn) {
  const m = objMap(), before = new Map();
  const touch = id => { if (!before.has(id)) before.set(id, clone(m[id])); };
  const tool = {
    put(o) { touch(o.id); m[o.id] = o; geoCache.delete(o); },
    del(id) { touch(id); delete m[id]; S.pick.delete(id); },
    mod(id, f) { const o = m[id]; if (!o) return; touch(id); f(o); geoCache.delete(o); },
  };
  fn(tool);
  const isTr = id => { const o = m[id] || before.get(id); return !!o && TR_TYPES.includes(o.t); };
  if ([...before.keys()].some(isTr)) netSync(tool);
  const patches: any = [];
  for (const [id, b] of before) { const a = clone(m[id]); if (JSON.stringify(a) !== JSON.stringify(b)) patches.push([id, b, a]); }
  if (patches.length) pushPatches(patches);
  objsChanged();
  const cf = newConflicts();
  if (cf.length) trConflict(cf[0]);
  return patches;
}
// Wiederholen-Stapel: jede neue Änderung leert ihn
export const oredo = [];
export function resetRedo() { oredo.length = 0; }
export function pushPatches(patches, keepRedo?: boolean) {
  patches.av = S.alignVer;   // Ausrichtung beim Aufzeichnen: unverändert → Rückgängig stellt x,y exakt wieder her (ohne Neuberechnung aus dem Anker)
  S.oundo.push(patches); if (S.oundo.length > 200) S.oundo.shift();
  if (!keepRedo) oredo.length = 0;
  updateDrawUI(); updateTrUI();
}
function applyStep(step, k) {
  if (S.note) closeNote(true);
  const m = objMap(), list = k === 1 ? step.slice().reverse() : step;
  for (const p of list) {
    const id = p[0], v = p[k];
    if (v == null) { delete m[id]; S.pick.delete(id); }
    else { m[id] = clone(v); if (step.av !== S.alignVer) reanchor(m[id]); }   // Ausrichtung kann sich seitdem geändert haben
  }
  objsChanged(); trCheck(); buildMenu(); updateDrawUI();
  newConflicts();   // nur Stand merken (keine Warnung beim Rückgängig/Wiederholen)
}
export function objUndo(quiet?: boolean) {
  const step = S.oundo.pop();
  if (!step) { if (!quiet) toast('Nichts zum Rückgängigmachen'); updateDrawUI(); return; }
  const t = $('#toast');   // Meldung mit eigenem Rückgängig-Knopf gilt nicht mehr (sonst nähme ein Tipp darauf den nächsten Schritt zurück)
  if (!quiet && t.classList.contains('undo')) t.classList.remove('show', 'undo', 'warn');
  applyStep(step, 1);
  if (!quiet) oredo.push(step);   // quiet: interne Rücknahme beim Nachziehen (letzte Ecke), nicht wiederholbar
}
export function objRedo() {
  const step = oredo.pop();
  if (!step) { toast('Nichts zum Wiederholen'); return; }
  applyStep(step, 2);
  S.oundo.push(step);
  updateDrawUI(); updateTrUI();
}

// Aktion mit Rückgängig-Knopf in der Meldung oben (außerhalb des Zeichenmodus gibt es kein ↶ in der Leiste)
export function toastUndo(msg) {
  const t = $('#toast');
  t.innerHTML = ''; t.append(msg + ' ');
  const b = document.createElement('button'); b.textContent = 'Rückgängig'; b.style.cssText = 'min-height:40px;margin-left:8px;color:var(--accent);background:transparent;border-color:transparent';
  b.onclick = () => { t.classList.remove('show', 'undo'); objUndo(); };
  t.append(b); t.classList.add('show', 'undo');
  toastLater(() => t.classList.remove('show', 'undo'), 5000);
}
