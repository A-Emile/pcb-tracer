import { edit } from './edit';
import { distSeg, hitObj } from './hit';
import { buildMenu, selectObj } from './menu';
import { anchorImg, closeNote, newText, openNote, workLayer } from './note';
import { HOLD_MS, anchorFrom, curPen, newId, objById, pickId, r1 } from './objects';
import { TR, trClearHi, trHit, trSelect } from './trace';
import { txGestEnd, txGestMove, txGestStart, txHandleAt, txNear, txPinchMove, txPinchStart } from './text';
import { dirty } from '../render/frame';
import { S } from '../state';
import { evPos, gest, ptrs, setGest } from '../ui/pointer';
import { s2w } from '../view/camera';

// ---- Gesten im Hauptfenster (aufgerufen aus den Zeiger-Ereignissen)
// Ausgewählter Text: Griffe und Kasten greifen sofort (Ziehen verschiebt, Ecke skaliert, Kreis oben dreht, Punkt = Ziel der Linie).
// Mit der Maus greift jeder Text sofort; am Touchscreen ein nicht ausgewählter erst nach Halten (sonst Karte schieben/zeichnen).
export function objDown(pane, x, y, mouse) {
  const sel = S.note ? null : objById(pickId());
  const part = sel && sel.t === 'text' ? txHandleAt(sel, x, y, mouse ? 12 : undefined) : null;
  if (part) { setGest({ pane, moved: false, hit: sel, x0: x, y0: y }); txGestStart(gest, sel, part, x, y); return; }
  const hit = S.note ? null : hitObj(x, y);
  if (mouse && hit && hit.t === 'text') { selectObj(hit.id); setGest({ pane, moved: false, hit, x0: x, y0: y }); txGestStart(gest, hit, 'move', x, y); return; }
  setGest({ kind: S.draw && !S.note ? 'draw' : mouse ? 'mouse' : 'pan', pane, moved: false, hit, x0: x, y0: y });
  if (hit) { const g = gest; g.timer = setTimeout(() => objHold(g), HOLD_MS); }
}
// Halten auf einem Objekt: verschieben
export function objHold(g) {
  g.timer = 0;
  if (gest !== g || g.moved || ptrs.size !== 1) return;
  const o = g.hit, cam = S.cams.main;
  S.stroke = null;
  if (o.t === 'text') { selectObj(o.id); txGestStart(g, o, 'move', g.x0, g.y0); g.moved = true; try { navigator.vibrate && navigator.vibrate(12); } catch {} dirty(); return; }
  g.kind = 'omove'; g.w0 = s2w(cam, g.pane, g.x0, g.y0);
  S.omove = { id: o.id, off: [0, 0] };
  selectObj(o.id);
  try { navigator.vibrate && navigator.vibrate(12); } catch {}
  dirty();
}
export function objMove(e, x, y) {
  const g = gest, cam = S.cams.main;
  if (g.kind === 'tx') { txGestMove(g, x, y); return; }
  if (g.kind === 'tpinch') { if (ptrs.size >= 2) { const [a, b] = [...ptrs.values()]; txPinchMove(g, a, b); } return; }
  if (g.kind === 'omove') {
    const w = s2w(cam, g.pane, x, y); S.omove.off = [w[0] - g.w0[0], w[1] - g.w0[1]];
    dirty(); return;
  }
  // Zeichnen: erst ab 6 px Weg (sonst Tipp); Zwischenpunkte des Ereignisses mitnehmen
  if (!S.stroke) {
    if (!g.moved) return;
    S.stroke = { L: workLayer(), color: curPen(), pts: [s2w(cam, g.pane, g.x0, g.y0)], len: 0 };
    if (S.pick.size) selectObj(null);
  }
  const st = S.stroke, evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of evs.length ? evs : [e]) {
    const [ex, ey] = evPos(ev), w = s2w(cam, g.pane, ex, ey), l = st.pts[st.pts.length - 1], d = Math.hypot(w[0] - l[0], w[1] - l[1]) * cam.s;
    if (d >= 1.5) { st.pts.push(w); st.len += d; }
  }
  dirty();
}
// Strich fertig: glätten (gewichtetes Mittel), vereinfachen (Douglas-Peucker 0,6 px am Bildschirm), in Lagen-Rohkoordinaten speichern
export function rdp(P, eps) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const stack = [[0, P.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let md = 0, mi = -1;
    for (let i = a + 1; i < b; i++) { const d = distSeg(P[i][0], P[i][1], P[a][0], P[a][1], P[b][0], P[b][1]); if (d > md) { md = d; mi = i; } }
    if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
export function finishStroke() {
  const st = S.stroke;
  S.stroke = null;
  if (!st || st.pts.length < 2 || st.len < 8) { dirty(); return null; }
  const s = S.cams.main.s;
  let P = st.pts;
  for (let k = 0; k < 2; k++) P = P.map((p, i) => i === 0 || i === P.length - 1 ? p : [(P[i - 1][0] + 2 * p[0] + P[i + 1][0]) / 4, (P[i - 1][1] + 2 * p[1] + P[i + 1][1]) / 4]);
  P = rdp(P, 0.6 / s);
  const o = { id: newId(), t: 'ink', L: st.L, img: anchorImg(st.L), pts: P.map(([x, y]) => [r1(x), r1(y)]), color: st.color, arrow: false, note: '' };
  anchorFrom(o);
  edit(e => e.put(o));
  return o;
}
export function objEnd(g, cancel) {
  if (g.kind === 'tx' || g.kind === 'tpinch') { if (txGestEnd(g, cancel) && g.kind === 'tx' && g.part === 'move') objTap(g, g.x0, g.y0); return; }
  if (g.kind === 'omove') {
    const mv = S.omove, o = objById(mv && mv.id);
    S.omove = null; S.loupe = null;
    if (o && !cancel && Math.hypot(mv.off[0], mv.off[1]) * S.cams.main.s > 0.5) edit(e => e.mod(o.id, o => {
      const [dx, dy] = mv.off;
      o.pts = o.pts.map(([x, y]) => [r1(x + dx), r1(y + dy)]);
      anchorFrom(o);   // neuer Anker über die Umkehrabbildung
    }));
    buildMenu(); dirty(); return;
  }
  // Zeichnen
  if (S.stroke) { const o = finishStroke(); if (o) selectObj(o.id); return; }
  if (!cancel && !g.moved) objTap(g, g.x0, g.y0);
}
// Tipp im Hauptfenster; true = verbraucht (kein Doppeltipp-Zoom). Zweiter Tipp auf denselben Text: bearbeiten.
let lastTx = null;
export function objTap(g, x, y) {
  if (S.note) { closeNote(); return true; }
  const now = performance.now();
  if (g.hit) {
    const o = g.hit;
    if (o.t === 'text' && lastTx && lastTx.id === o.id && now - lastTx.t < 400) { lastTx = null; openNote(o, false); return true; }
    lastTx = { id: o.id, t: now };
    if (pickId() !== o.id) selectObj(o.id);
    return true;
  }
  lastTx = null;
  // Bahn antippen (außer beim Zeichnen): auswählen, Netz hervorheben
  const th = !S.draw && trHit(x, y);
  if (th) { trSelect(th.id); return true; }
  if (TR.hiId) { trClearHi(); return true; }
  if (S.pick.size) { selectObj(null); return true; }
  if (S.draw) { newText(x, y); return true; }
  return false;
}
// zweiter Finger: liegt der erste auf dem ausgewählten Text (oder beide nah daran), dreht/skaliert die Geste den Text statt der Karte
export function objPinch() {
  const o = objById(pickId());
  if (!o || o.t !== 'text' || S.note || ptrs.size !== 2) return false;
  const [a, b] = [...ptrs.values()], onIt = gest && gest.kind === 'tx' && gest.o === o;
  if (!onIt && !(txNear(o, a.x, a.y, 30) && txNear(o, b.x, b.y, 30)) && !txNear(o, (a.x + b.x) / 2, (a.y + b.y) / 2, 10)) return false;
  if (gest && gest.timer) clearTimeout(gest.timer);
  setGest(txPinchStart(gest ? gest.pane : S.panes[0], o, a, b, onIt ? gest.before : null));
  return true;
}
export function objGestCancel() {
  if (!gest) return;
  if (gest.timer) { clearTimeout(gest.timer); gest.timer = 0; }
  if (gest.kind === 'draw') S.stroke = null;
  if (gest.kind === 'omove') { S.omove = null; S.loupe = null; buildMenu(); }
  if (gest.kind === 'tx' || gest.kind === 'tpinch') txGestEnd(gest, true);
}
