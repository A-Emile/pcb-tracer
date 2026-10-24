import { updateAlignBar } from '../align/align';
import { loupeMove, loupeSnap, loupeStart } from '../align/loupe';
import { hitPoint, movePairPoint, movePending, placePoint, selectPair } from '../align/pairs';
import { trActive, trCancel, trDown, trEnd, trHover, trMove } from '../draw/trace';
import { trHandleDown } from '../draw/trEdit';
import { objDown, objEnd, objGestCancel, objMove, objPinch, objTap } from '../draw/gestures';
import { ov } from '../render/gl';
import { dirty } from '../render/frame';
import { S } from '../state';
import { evPos, gest, ptrs, setGest } from './pointer';
import { stActive, stCancel, stDown, stEnd, stMove } from '../align/straight';
import { camAt, camPan, clampCam, linkFrom, s2w } from '../view/camera';
import { pinchRot, pinchRotEnd, pinchRotStart, wheelRotate } from '../view/orient';

// ---------------------------------------------------------------- Gesten
let lastTap = null;

export function paneAt(x, y) { return S.panes.find(p => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h) || S.panes[0]; }

export function zoomAt(pane, x, y, f) {
  const cam = S.cams[pane.id], w = s2w(cam, pane, x, y);
  cam.s *= f; clampCam(pane.id);
  camAt(cam, pane, w[0], w[1], x, y);
  clampCam(pane.id); linkFrom(pane.id); dirty();
}
export function startPinch() {
  const [a, b] = [...ptrs.values()], pane = (gest && gest.pane) || paneAt(a.x, a.y), cam = S.cams[pane.id];
  if (gest && (gest.kind === 'place' || gest.kind === 'move')) { S.loupe = null; S.preview = null; }
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  setGest({ kind: 'pinch', pane, d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: cam.s, w0: s2w(cam, pane, mx, my) });
  pinchRotStart(gest, Math.atan2(b.y - a.y, b.x - a.x), gest.d0);
}
export function endPointer(e, cancel) {
  const p = ptrs.get(e.pointerId);
  if (!p) return;
  ptrs.delete(e.pointerId);
  const g = gest;
  if (!g) return;
  if (g.timer) { clearTimeout(g.timer); g.timer = 0; }
  if (g.kind === 'tpinch') { objEnd(g, cancel); setGest(ptrs.size ? { kind: 'none', pane: g.pane } : null); return; }   // Text drehen/skalieren
  if (g.kind === 'pinch') { pinchRotEnd(g); if (ptrs.size === 0) setGest(null); else setGest({ kind: 'none', pane: g.pane }); return; }
  if (ptrs.size) return;
  setGest(null);
  if (g.kind === 'none') return;
  const [x, y] = [p.x, p.y], dt = performance.now() - p.t0;
  if (g.kind === 'draw' || g.kind === 'omove' || g.kind === 'tx') { objEnd(g, cancel); return; }
  if (String(g.kind).startsWith('st')) { stEnd(g, cancel); return; }
  if (String(g.kind).startsWith('tr')) { trEnd(g, cancel); return; }
  if (g.kind === 'place' || g.kind === 'move') {
    // Ziel = genau die letzte Lupenposition; vorhandener Fang dafür wird übernommen, sonst einmal fangen
    const L = S.loupe;
    S.loupe = null; S.preview = null; dirty();
    if (L) clearTimeout(L.timer);
    if (cancel || !L) return;
    if (g.kind === 'move' && !g.moved && dt < 350) { if (g.hit.pair != null) selectPair(g.hit.pair, g.pane.id); return; }
    const w = s2w(S.cams[g.pane.id], g.pane, L.x, L.y), pt = loupeSnap(L, true);
    if (g.kind === 'move') {
      if (g.hit.pair != null) { S.sel = g.hit.pair; movePairPoint(g.hit.pair, g.pane.id, w[0], w[1], pt); updateAlignBar(); }
      else movePending(g.hit.pend, w[0], w[1], pt);
      return;
    }
    if (S.sel != null) selectPair(null);
    placePoint(g.pane.id, w[0], w[1], pt);
    return;
  }
  if (cancel || g.moved) return;
  // Tipp / Klick
  if (S.mode === 'main' && objTap(g, x, y)) { lastTap = null; return; }
  const now = performance.now();
  if (lastTap && now - lastTap.t < 320 && Math.hypot(x - lastTap.x, y - lastTap.y) < 30) { zoomAt(g.pane, x, y, 2); lastTap = null; return; }
  lastTap = { t: now, x, y };
  if (g.kind === 'mouse' && S.mode === 'align') {
    if (S.sel != null) selectPair(null);
    const w = s2w(S.cams[g.pane.id], g.pane, x, y);
    placePoint(g.pane.id, w[0], w[1]);
  }
}

// Zeiger-Ereignisse der Zeichenfläche verdrahten
export function initGestures() {
  ov.addEventListener('pointerdown', e => {
    if (!S.proj) return;
    e.preventDefault();   // keine nachgeschobenen Maus-Ereignisse: sonst verliert das Notiz-Feld den Fokus (Tastatur ginge wieder zu)
    try { ov.setPointerCapture(e.pointerId); } catch {}
    const [x, y] = evPos(e);
    ptrs.set(e.pointerId, { x, y, x0: x, y0: y, t0: performance.now(), type: e.pointerType });
    if (ptrs.size === 2 && S.mode === 'main' && objPinch()) { dirty(); return; }
    if (ptrs.size === 2) { objGestCancel(); stCancel(); trCancel(); startPinch(); dirty(); return; }
    if (ptrs.size > 2) return;
    const pane = paneAt(x, y), mouse = e.pointerType === 'mouse';
    // rechte/mittlere Maustaste: schieben (im Zeichenmodus zeichnet die linke)
    if (mouse && e.button !== 0) { setGest(S.mode === 'main' ? { kind: 'pan', pane, moved: false } : null); return; }
    if (S.mode === 'align') {
      const h = hitPoint(pane.id, x, y);
      if (h) { setGest({ kind: 'move', pane, hit: h, moved: false }); loupeStart(pane, x, y, h.s[0], h.s[1], !mouse); return; }
      if (!mouse) { setGest({ kind: 'place', pane, moved: false }); loupeStart(pane, x, y, x, y, true); return; }
    }
    if (stActive()) { stDown(pane, x, y, mouse); return; }
    if (S.mode === 'main' && trHandleDown(pane, x, y, mouse)) return;   // Griff am ausgewählten Bahnobjekt
    if (trActive()) { trDown(pane, x, y, mouse); return; }
    if (S.mode === 'main') { objDown(pane, x, y, mouse); return; }
    setGest({ kind: mouse ? 'mouse' : 'pan', pane, moved: false });
  });
  ov.addEventListener('pointermove', e => {
    const p = ptrs.get(e.pointerId);
    if (!p) { if (e.pointerType === 'mouse' && !ptrs.size) { const q = evPos(e); trHover(q[0], q[1]); } return; }
    const [x, y] = evPos(e), dx = x - p.x, dy = y - p.y;
    p.x = x; p.y = y;
    if (!gest) return;
    if (Math.hypot(x - p.x0, y - p.y0) > 6) gest.moved = true;
    if (gest.moved && gest.timer) { clearTimeout(gest.timer); gest.timer = 0; }
    if (gest.kind === 'draw' || gest.kind === 'omove' || gest.kind === 'tx' || gest.kind === 'tpinch') { objMove(e, x, y); return; }
    if (String(gest.kind).startsWith('st')) { stMove(x, y); return; }
    if (String(gest.kind).startsWith('tr')) { trMove(x, y, dx, dy); if (e.pointerType === 'mouse') trHover(x, y); return; }
    const cam = S.cams[gest.pane.id];
    if (gest.kind === 'pinch' && ptrs.size >= 2) {
      const [a, b] = [...ptrs.values()], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2, pane = gest.pane;
      cam.s = gest.s0 * Math.hypot(a.x - b.x, a.y - b.y) / gest.d0;
      pinchRot(gest, Math.atan2(b.y - a.y, b.x - a.x), mx, my, Math.hypot(a.x - b.x, a.y - b.y)); clampCam(pane.id);
      camAt(cam, pane, gest.w0[0], gest.w0[1], mx, my);
      clampCam(pane.id); linkFrom(pane.id); dirty();
    } else if (gest.kind === 'pan' || (gest.kind === 'mouse' && gest.moved)) {
      camPan(cam, dx, dy); clampCam(gest.pane.id); linkFrom(gest.pane.id); dirty();
    } else if ((gest.kind === 'place' || gest.kind === 'move') && S.loupe) loupeMove(x, y);
  });
  ov.addEventListener('pointerup', e => endPointer(e, false));
  ov.addEventListener('pointercancel', e => endPointer(e, true));
  ov.addEventListener('wheel', e => {
    e.preventDefault();
    if (!S.proj) return;
    const [x, y] = evPos(e);
    // Umschalt+Mausrad: frei drehen (manche Systeme liefern dann deltaX)
    if (e.shiftKey && !e.ctrlKey) { const d = (e.deltaY || e.deltaX) * (e.deltaMode === 1 ? 33 : 1); wheelRotate(x, y, d); linkFrom(paneAt(x, y).id); return; }
    zoomAt(paneAt(x, y), x, y, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0015)));
  }, { passive: false });
  ov.addEventListener('contextmenu', e => e.preventDefault());
  ov.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !ptrs.size) trHover(null, null); });
}
