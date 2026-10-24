import type { Layer } from '../types';
import { saveSoon } from '../db/projects';
import { dropHiddenPick } from '../draw/menu';
import { closeNote } from '../draw/note';
import { trFinish } from '../draw/trace';
import { MODES, activeLayer, layerById, layerColor, layerMode, layerName, layerShort, layers } from './model';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { updateViewUI } from '../ui/sheet';
import { $, clamp } from '../util';

// Aktive Lage wechseln: „Oben ⇄“ tippen, Zeile in der Lagenliste, Bild↑/Bild↓, +/−, Tab. Die aktive Lage ist immer sichtbar.
export function setT(t) { S.t = clamp(t, 0, 1); $('#fade').value = Math.round(S.t * 100); if (S.proj) dropHiddenPick(); dirty(); saveSoon(); }
export function setActive(id) {
  const lk = lookState(), L = layerById(id);
  if (!L) return;
  if (lk.active === id && L.on) return;
  if (S.note) closeNote();
  if (S.proj.route && S.proj.route.L !== id) trFinish();   // Bahn endet beim Lagenwechsel (weiter am Via auf der neuen Lage)
  L.on = true; lk.active = id;
  if (S.stroke) S.stroke.L = id;
  dropHiddenPick();
  updateSideUI(); dirty(); saveSoon();
}
export const stepActive = d => { const ls = layers(), i = ls.findIndex(L => L.id === activeLayer()); if (ls.length) setActive(ls[clamp(i + d, 0, ls.length - 1)].id); };
// bei zwei Lagen hin und her, bei mehr reihum nach unten
export const swapFront = () => { const ls = layers(), i = ls.findIndex(L => L.id === activeLayer()); if (ls.length > 1) setActive(ls[(i + 1) % ls.length].id); };
// Auge: gilt für Foto und Objekte der Lage. Wird die aktive ausgeblendet, wird die nächste sichtbare aktiv.
export function setLayerOn(id, on) {
  const L = layerById(id);
  if (!L || L.on === on) return;
  L.on = on;
  if (!on && id === activeLayer()) {
    const ls = layers(), i = ls.indexOf(L);
    const nb = ls.map((M, k) => [M, Math.abs(k - i)] as [Layer, number]).filter(([M]) => M.on).sort((a, b) => a[1] - b[1])[0];
    if (nb) lookState().active = nb[0].id;
  }
  dropHiddenPick();
  updateSideUI(); dirty(); saveSoon();
}
export function setLayerMode(m) {
  if (!MODES.includes(m) || layerMode() === m) return;
  lookState().mode = m;
  dropHiddenPick();
  updateViewUI(); dirty(); saveSoon();
}

export function setHold(on) { if (!!S.hold === on) return; S.hold = on; updateSideUI(); dirty(); }
export function updateSideUI() {
  if (!S.proj) return;
  const a = activeLayer(), L = layerById(a) || { id: a }, col = layerColor(a), al = S.mode === 'align';
  const bs = $('#btnSide');
  bs.textContent = layerShort(L) + ' ⇄'; bs.style.color = col;
  bs.setAttribute('aria-label', 'Lage wechseln, aktiv: ' + layerName(L));
  const chip = $('#sideChip');
  chip.innerHTML = al ? 'Ausrichten' : `<i class="sw" style="background:${col}"></i>${a === 'back' ? 'Unten (Durchsicht)' : layerShort(L)}<span class="dd">▾</span>`;
  chip.style.color = al ? '' : col;
  chip.disabled = al;
  chip.setAttribute('aria-label', al ? 'Ausrichten' : 'Aktive Lage: ' + layerName(L) + ', Lagen zeigen');
  updateViewUI();
}

// Lagenknopf und Durchsicht-Schieber verdrahten
export function initLayerUI() {
  $('#fade').addEventListener('input', e => { S.t = e.target.value / 100; dropHiddenPick(); dirty(); saveSoon(); });
  (() => {
    const b = $('#btnSide');
    let timer = 0, held = false;
    b.addEventListener('pointerdown', () => { held = false; timer = setTimeout(() => { held = true; setHold(true); }, 250); });
    const up = () => { clearTimeout(timer); if (held) setHold(false); };
    b.addEventListener('pointerup', up); b.addEventListener('pointercancel', up); b.addEventListener('pointerleave', up);
    b.addEventListener('click', () => { if (!held) swapFront(); held = false; });
  })();
}
