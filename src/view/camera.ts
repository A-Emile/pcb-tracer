import type { Pt } from '../types';
import { BD, fromB, toB } from '../align/board';
import { affApply } from '../align/geometry';
import { gl, ov } from '../render/gl';
import { dirty } from '../render/frame';
import { DPR, S } from '../state';
import { $, clamp } from '../util';

// ---------------------------------------------------------------- Drehen/Spiegeln der Ansicht (nur Darstellung)
// p.look.orient = { a: Grad im Uhrzeigersinn am Bildschirm, f: links/rechts gespiegelt }; fehlt = 0°, ungespiegelt.
// Bildschirm = Fenstermitte + s · M · (Welt − c) mit M = Spiegel(f) · Drehung(a). Gilt für alle Fenster (auch Ausrichten, Lupe).
export const VM = { a: 0, f: false, m: [1, 0, 0, 1], mi: [1, 0, 0, 1] };
export function vm() {
  const o = S.proj && S.proj.look && S.proj.look.orient, a = o ? +o.a || 0 : 0, f = !!(o && o.f);
  if (a !== VM.a || f !== VM.f) {
    const r = a * Math.PI / 180, k = f ? -1 : 1, q = v => Math.abs(v) < 1e-12 ? 0 : v;
    const c = q(Math.cos(r)), s = q(Math.sin(r)), m = [k * c, -k * s, s, c], det = m[0] * m[3] - m[1] * m[2];
    VM.a = a; VM.f = f; VM.m = m; VM.mi = [m[3] / det, -m[1] / det, -m[2] / det, m[0] / det];
  }
  return VM;
}

// ---------------------------------------------------------------- Kamera & Fenster
export function s2w(cam, p, x, y): Pt {
  const mi = vm().mi, dx = (x - (p.x + p.w / 2)) / cam.s, dy = (y - (p.y + p.h / 2)) / cam.s;
  return [cam.cx + mi[0] * dx + mi[1] * dy, cam.cy + mi[2] * dx + mi[3] * dy];
}
export function w2s(cam, p, x, y): Pt {
  const m = vm().m, dx = (x - cam.cx) * cam.s, dy = (y - cam.cy) * cam.s;
  return [p.x + p.w / 2 + m[0] * dx + m[1] * dy, p.y + p.h / 2 + m[2] * dx + m[3] * dy];
}
// Kamera so setzen, dass Weltpunkt (wx, wy) am Bildschirmpunkt (sx, sy) liegt
export function camAt(cam, p, wx, wy, sx, sy) {
  const mi = vm().mi, dx = (sx - (p.x + p.w / 2)) / cam.s, dy = (sy - (p.y + p.h / 2)) / cam.s;
  cam.cx = wx - (mi[0] * dx + mi[1] * dy); cam.cy = wy - (mi[2] * dx + mi[3] * dy);
}
// um (dx, dy) Bildschirm-px verschieben (Inhalt folgt dem Finger)
export function camPan(cam, dx, dy) {
  const mi = vm().mi;
  cam.cx -= (mi[0] * dx + mi[1] * dy) / cam.s; cam.cy -= (mi[2] * dx + mi[3] * dy) / cam.s;
}
// Bereich eines Fensters in seinen Weltkoordinaten: Hauptansicht = Platine (gerade gestellt), sonst die Fotos
export function paneBox(id) {
  const sd = S.proj.sides;
  if (id === 'main') return BD.box;
  return id === 'back' ? [0, 0, S.pre.w, S.pre.h] : [0, 0, sd.front.w, sd.front.h];
}
export function paneDims(id) { const b = paneBox(id); return [b[2] - b[0], b[3] - b[1]]; }
export function fitScale(id, pane) {
  const [w, h] = paneDims(id), m = vm().m;
  return Math.min(pane.w / (Math.abs(m[0]) * w + Math.abs(m[1]) * h), pane.h / (Math.abs(m[2]) * w + Math.abs(m[3]) * h)) * 0.95;
}
export function fitCam(id) {
  const pane = S.panes.find(p => p.id === id) || S.panes[0], b = paneBox(id);
  S.cams[id] = { cx: (b[0] + b[2]) / 2, cy: (b[1] + b[3]) / 2, s: fitScale(id, pane) };
}
export function clampCam(id) {
  const cam = S.cams[id], pane = S.panes.find(p => p.id === id);
  if (!cam || !pane) return;
  const b = paneBox(id), w = b[2] - b[0], h = b[3] - b[1];
  cam.s = clamp(cam.s, fitScale(id, pane) * 0.5, 16);
  cam.cx = clamp(cam.cx, b[0] - w * 0.25, b[2] + w * 0.25); cam.cy = clamp(cam.cy, b[1] - h * 0.25, b[3] + h * 0.25);
}
export function layout() {
  const st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  for (const c of [gl.canvas, ov]) { c.width = Math.round(W * DPR); c.height = Math.round(H * DPR); }
  if (S.mode === 'align') {
    if (W >= H) S.panes = [{ id: 'front', x: 0, y: 0, w: W / 2 - 1, h: H }, { id: 'back', x: W / 2 + 1, y: 0, w: W / 2 - 1, h: H }];
    else S.panes = [{ id: 'front', x: 0, y: 0, w: W, h: H / 2 - 1 }, { id: 'back', x: 0, y: H / 2 + 1, w: W, h: H / 2 - 1 }];
  } else S.panes = [{ id: 'main', x: 0, y: 0, w: W, h: H }];
  for (const p of S.panes) { if (!S.cams[p.id]) fitCam(p.id); else clampCam(p.id); }
  dirty();
}

// Hauptansicht (Platine) ↔ Fenster „Oben“ beim Ausrichten (Rohpixel der Oberseite): Mitte über die Geradestellung umrechnen
export function camMainToFront(c, f) { const r = fromB(c.cx, c.cy); f.cx = r[0]; f.cy = r[1]; f.s = Math.max(c.s, f.s); }
export function camFrontToMain(f, c) { const r = toB(f.cx, f.cy); c.cx = r[0]; c.cy = r[1]; c.s = f.s; }

// Ansichten im Ausrichte-Modus koppeln (über aktuelle Zuordnung)
export function frontToPre(x, y) { const r = S.inv(x, y); return affApply(S.pre.m, r[0], r[1]); }
export function preToFront(x, y) { const r = affApply(S.preInv, x, y); return S.fwd(r[0], r[1]); }
export function linkFrom(id) {
  if (!S.link || S.mode !== 'align' || S.proj.align.pairs.length < 1) return;
  const a = S.cams[id], other = id === 'front' ? 'back' : 'front', b = S.cams[other];
  const map = id === 'front' ? frontToPre : preToFront;
  const p = map(a.cx, a.cy), q = map(a.cx + 50 / a.s, a.cy);
  const k = Math.hypot(q[0] - p[0], q[1] - p[1]) / (50 / a.s);
  b.cx = p[0]; b.cy = p[1]; b.s = a.s / (k || 1);
  clampCam(other);
}

// Fenstergröße beobachten
export function initCamera() {
  new ResizeObserver(() => { if (S.proj) layout(); }).observe($('#stage'));
}
