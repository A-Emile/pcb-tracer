import { edit, toastUndo } from './edit';
import { trDelete } from './trEdit';
import { labelInk, openNote } from './note';
import { PENS, PEN_NAME, TR_TYPES, anchorFrom, objById, objsShown, pickId } from './objects';
import { trShown } from './trace';
import { trBusy, trMenu } from './trEdit';
import { objScreen } from './overlay';
import { txBusy, txDefaultLead } from './text';
import { layerById, layerColor, layerName, layerShort, layers, objPickable } from '../layers/model';
import { dirty } from '../render/frame';
import { S } from '../state';
import { $, clamp } from '../util';

// ---- Auswahl und Menü am Objekt
export let menuSub = null;
export function selectObj(id) { S.pick.clear(); if (id) S.pick.add(id); menuSub = null; buildMenu(); dirty(); }
export function buildMenu() {
  const m = $('#objMenu'), o = objById(pickId());
  const tr = o && TR_TYPES.includes(o.t);
  if (!o || S.note || S.omove || txBusy || trBusy() || !(tr ? trShown() : objsShown()) || !objPickable(o)) { m.hidden = true; return; }
  m.innerHTML = '';
  const btn = (html, fn, cls?, label?) => {
    const b = document.createElement('button'); b.innerHTML = html; if (cls) b.className = cls; if (label) b.setAttribute('aria-label', label);
    b.addEventListener('click', e => { e.stopPropagation(); fn(); }); m.append(b); return b;
  };
  if (tr) trMenu(o, btn);   // Bahn, Ecke, Via, Pad (draw/trEdit.ts)
  else if (menuSub === 'color') PENS.forEach((c, i) => btn(`<i style="background:${c}"></i>`, () => { menuSub = null; if (o.color !== c) objSet(o.id, x => { x.color = c; }); else buildMenu(); }, 'pen' + (o.color === c ? ' on' : ''), PEN_NAME[i]));
  else if (menuSub === 'layer') layers().forEach(L => btn(`<i class="sw" style="--lc:${layerColor(L.id)}"></i>${layerShort(L)}`, () => objToLayer(o.id, L.id), 'mlay' + (o.L === L.id ? ' on' : ''), 'Auf ' + layerName(L) + ' legen'));
  else {
    if (o.t === 'text') btn('Bearbeiten', () => openNote(o, false));
    btn(`<i style="background:${o.color}"></i>Farbe`, () => { menuSub = 'color'; buildMenu(); }, 'mcol');
    if (o.t === 'text') btn('Linie', () => objSet(o.id, x => { x.lead = !x.lead; if (x.lead && !Number.isFinite(x.lx)) { [x.lx, x.ly] = txDefaultLead(x); anchorFrom(x); } }), o.lead ? 'on' : '', 'Hinweislinie').setAttribute('aria-pressed', !!o.lead);
    const lo = layerById(o.L);
    if (layers().length > 1) btn(`<i class="sw" style="--lc:${layerColor(o.L)}"></i>${lo ? layerShort(lo) : 'Lage'}`, () => { menuSub = 'layer'; buildMenu(); }, 'mlay', 'Lage: ' + (lo ? layerName(lo) : o.L));
    if (o.t === 'ink') {
      btn('Pfeil', () => objSet(o.id, x => { x.arrow = !x.arrow; }), o.arrow ? 'on' : '').setAttribute('aria-pressed', !!o.arrow);
      btn('Text', () => labelInk(o));
    }
    btn('Löschen', () => objDelete(o.id), 'del');
  }
  m.hidden = false;
  placeMenu();
}
// über dem Objekt, sonst darunter, sonst im Fenster
export function placeMenu() {
  const m = $('#objMenu'), o = objById(pickId());
  if (m.hidden || !o) return;
  const pane = S.panes[0], P = objScreen(o, S.cams.main, pane);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const w = m.offsetWidth, h = m.offsetHeight, gap = 14;
  let y = y0 - gap - h;
  if (y < 8) y = y1 + gap;
  if (y + h > pane.h - 8) y = clamp(y0 - gap - h, 8, pane.h - h - 8);
  const x = clamp((x0 + x1) / 2 - w / 2, 8, pane.w - w - 8);
  m.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}

export function objSet(id, f) { edit(e => e.mod(id, f)); buildMenu(); }
// Objekt auf eine andere Lage legen: Platinenposition bleibt, Anker wechselt auf das Foto der neuen Lage
export function objToLayer(id, L) {
  menuSub = null;
  const o = objById(id);
  if (!o || o.L === L) { buildMenu(); return; }
  edit(e => e.mod(id, x => { x.L = L; if (S.proj.sides[L]) { x.img = L; anchorFrom(x); } }));
  const nl = layerById(L);
  dropHiddenPick(); buildMenu();
  toastUndo('Auf ' + (nl ? layerName(nl) : L) + ' gelegt');
}
export function objDelete(id) {
  const o = objById(id);
  if (o && TR_TYPES.includes(o.t)) { trDelete(id); toastUndo('Gelöscht'); return; }
  edit(e => e.del(id));
  buildMenu();
  if (!S.draw) toastUndo('Gelöscht');
}

// Auswahl aufheben, wenn das Objekt nicht mehr anwählbar ist (andere Lage, ausgeblendet)
export function dropHiddenPick() {
  const o = objById(pickId());
  if (S.pick.size && (!o || !objPickable(o))) selectObj(null);
}
