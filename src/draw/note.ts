import { saveSoon } from '../db/projects';
import { pushPatches } from './edit';
import { buildMenu } from './menu';
import { clone, curPen, geoCache, objById, objMap, objsChanged } from './objects';
import { objScreen } from './overlay';
import { txNew } from './text';
import { setLayerOn } from '../layers/actions';
import { activeLayer, layerById } from '../layers/model';
import { dirty } from '../render/frame';
import { S } from '../state';
import { $ } from '../util';
import { s2w } from '../view/camera';

// ---- Textfeld bearbeiten: Eingabezeile am unteren Rand des VisualViewport (über der Tastatur), der Text auf der Platine
// zeigt jede Eingabe sofort; die Karte rückt ihn in den freien Bereich darüber.
export function openNote(o, isNew) {
  if (S.note) closeNote();
  S.note = { id: o.id, isNew, before: isNew ? null : clone(o) };
  S.pick.clear(); S.pick.add(o.id);
  const ta = $('#noteTx'); ta.value = o.note || ''; ta.placeholder = 'Text';
  $('#noteEd').hidden = false; buildMenu();
  growNote(); placeNote();
  try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
  const v = window.visualViewport;
  if (v && !S.note.vv) { S.note.vv = v; v.addEventListener('resize', onVV); v.addEventListener('scroll', onVV); }
  ensureVisible(o, false);
  dirty();
}
export function onVV() { if (!S.note) return; placeNote(); const o = objById(S.note.id); if (o) ensureVisible(o, true); }
export function growNote() { const ta = $('#noteTx'); ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, 114) + 'px'; }
export function placeNote() {
  const el = $('#noteEd'), v = window.visualViewport, bottom = v ? v.offsetTop + v.height : window.innerHeight;
  el.style.top = Math.round(bottom - el.offsetHeight) + 'px';
}
// Text samt Rahmen muss zwischen Kopfzeile und Eingabezeile sichtbar sein (sonst wird die Karte verschoben)
export function ensureVisible(o, anim) {
  const st = $('#stage').getBoundingClientRect(), v = window.visualViewport, ed = $('#noteEd').getBoundingClientRect();
  const top = Math.max(st.top, v ? v.offsetTop : 0) + 8, bot = (S.note ? ed.top : Math.min(st.bottom, v ? v.offsetTop + v.height : innerHeight)) - 12;
  const P = objScreen(o, S.cams.main, S.panes[0]);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  x0 += st.left; x1 += st.left; y0 += st.top; y1 += st.top;
  const sx = (x0 + x1) / 2, sy = (y0 + y1) / 2;
  let dy = 0, dx = 0;
  if (y0 < top || y1 > bot) dy = y1 - y0 < bot - top ? (top + (bot - top) * 0.45) - sy : top - y0;
  if (x0 < st.left + 8 || x1 > st.right - 8) dx = x1 - x0 < st.width - 16 ? st.left + st.width / 2 - sx : st.left + 8 - x0;
  if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) panBy(dx, dy, anim);
}
// Karte um (dx, dy) Bildschirm-px verschieben (über s2w, gilt auch bei gedrehter/gespiegelter Ansicht)
export function panBy(dx, dy, anim) {
  const cam = S.cams.main, pane = S.panes[0], c0 = { cx: cam.cx, cy: cam.cy }, t0 = performance.now(), T = anim === false ? 0 : 180;
  const mx = pane.x + pane.w / 2, my = pane.y + pane.h / 2, a = s2w(cam, pane, mx, my), b = s2w(cam, pane, mx + dx, my + dy), bx = b[0] - a[0], by = b[1] - a[1];
  const step = () => {
    const k = T ? Math.min(1, (performance.now() - t0) / T) : 1, e = 1 - (1 - k) ** 3;
    cam.cx = c0.cx - bx * e; cam.cy = c0.cy - by * e; dirty();
    if (k < 1) requestAnimationFrame(step); else saveSoon();
  };
  step();
}
// schließen: Text übernehmen; leerer Text wird verworfen (neu: spurlos, sonst gelöscht mit Rückgängig)
export function closeNote(keepSel?) {
  const n = S.note;
  if (!n) return;
  S.note = null;
  if (n.vv) { n.vv.removeEventListener('resize', onVV); n.vv.removeEventListener('scroll', onVV); }
  const ta = $('#noteTx'); ta.blur(); $('#noteEd').hidden = true;
  if (n.fn) { n.fn(ta.value.replace(/\s+/g, ' ').trim()); buildMenu(); dirty(); return; }   // Name/Notiz einer Zeile (Netz, Pad: draw/trEdit.ts openLine)
  const o = objById(n.id);
  if (o) {
    o.note = ta.value.replace(/\s+$/, ''); geoCache.delete(o);
    if (!o.note.trim()) { delete objMap()[o.id]; if (!n.isNew) pushPatches([[o.id, n.before, null]]); }
    else if (n.isNew || (n.before.note || '') !== o.note) pushPatches([[o.id, n.before, clone(o)]]);
    objsChanged();
  }
  if (!keepSel || !objById(n.id)) S.pick.clear();
  buildMenu(); dirty();
}
// Neues entsteht auf der aktiven Lage; ist sie (alle Lagen aus) ausgeblendet, wird sie wieder eingeblendet
export function workLayer() { const a = activeLayer(), L = layerById(a); if (L && !L.on) setLayerOn(a, true); return a; }
export const anchorImg = L => S.proj.sides[L] ? L : 'front';
// Neuer Text an einem Bildschirmpunkt; Rückgängig-Schritt erst beim Schließen (Text samt Inhalt)
export function newText(x, y) {
  const L = workLayer(), o = txNew(x, y, L, anchorImg(L), curPen());
  objMap()[o.id] = o; objsChanged();
  openNote(o, true);
}
// Strich beschriften: neuer Text rechts oberhalb des Strichendes, Hinweislinie dorthin
export function labelInk(ink) {
  const pane = S.panes[0], P = objScreen(ink, S.cams.main, pane), e = P[P.length - 1], end = ink.pts[ink.pts.length - 1];
  const x = Math.min(Math.max(e[0] + 56, 60), pane.w - 60), y = Math.min(Math.max(e[1] - 44, 60), pane.h - 60);
  const o = txNew(x, y, ink.L, ink.img, ink.color, end);
  objMap()[o.id] = o; objsChanged();
  openNote(o, true);
}

// Eingabezeile verdrahten
export function initNote() {
  $('#noteTx').addEventListener('input', () => { growNote(); placeNote(); const o = S.note && objById(S.note.id); if (o) { o.note = $('#noteTx').value; geoCache.delete(o); ensureVisible(o, false); dirty(); saveSoon(); } });
  $('#noteTx').addEventListener('keydown', e => {
    if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey || (S.note && S.note.fn)))) { e.preventDefault(); e.stopPropagation(); closeNote(true); }
  });
  $('#noteDone').addEventListener('click', () => closeNote(true));
}
