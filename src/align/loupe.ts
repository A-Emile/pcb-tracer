import { snapPane, snapR } from './snap';
import { dirty } from '../render/frame';
import { S } from '../state';
import { $, clamp } from '../util';
import { s2w } from '../view/camera';

// ---------------------------------------------------------------- Lupe
// Lage der Lupe wird beim Aufsetzen festgelegt und springt danach nicht mehr.
// Der Punkt bewegt sich langsamer als der Finger (fein justieren).
// Gefangen wird erst nach kurzer Ruhe (SNAP_REST), immer nur ein Auftrag; beim Loslassen gilt genau die letzte Lupenposition.
export const LOUPE = 128, FINE = 0.35, SNAP_REST = 100;
// snapFn(w, R): eigener Fang (Weltpunkt, Radius in Weltpixeln) statt Via-Fang auf dem Foto des Fensters (Bahnen, draw/trace.ts)
export function loupeStart(pane, fx, fy, tx, ty, fine, nosnap?, snapFn?) {
  const st = $('#stage'), above = fy - 110 - LOUPE / 2 >= 4;
  S.loupe = { pane, fx, fy, fx0: fx, fy0: fy, x: tx, y: ty, x0: tx, y0: ty, fine, timer: 0, job: null, again: false, nosnap: !!nosnap, keepFx: !!nosnap || !!snapFn, snapFn,
              place: above ? 'above' : fx < st.clientWidth / 2 ? 'right' : 'left' };
  S.preview = null;
  loupeSnapSoon(); dirty();
}
export function loupeMove(fx, fy) {
  const L = S.loupe, p = L.pane, k = L.fine ? FINE : 1;
  L.fx = fx; L.fy = fy;
  const x = clamp(L.x0 + (fx - L.fx0) * k, p.x, p.x + p.w), y = clamp(L.y0 + (fy - L.fy0) * k, p.y, p.y + p.h);
  if (x !== L.x || y !== L.y) { L.x = x; L.y = y; loupeSnapSoon(); }
  dirty();
}
export function loupeSnapSoon() { const L = S.loupe; if (L.nosnap) return; clearTimeout(L.timer); L.timer = setTimeout(() => loupeSnap(L), SNAP_REST); }
// Fang für die aktuelle Lupenposition; Ergebnis (Promise) wird je Position gemerkt.
// force: auch wenn noch ein anderer Auftrag läuft (beim Loslassen), sonst wird nach dessen Ende neu angestoßen.
export function loupeSnap(L, force?) {
  const key = L.x + ',' + L.y;
  if (L.job && L.job.key === key) return L.job.p;
  if (L.job && !L.job.done && !force) { L.again = true; return null; }
  const cam = S.cams[L.pane.id], w = s2w(cam, L.pane, L.x, L.y), at = [L.x, L.y];
  const job: any = L.job = { key, done: false };
  job.p = (L.snapFn ? L.snapFn(w, snapR(loupeScale(cam))) : snapPane(L.pane.id, w[0], w[1], snapR(loupeScale(cam)))).then(pt => {
    job.done = true; job.pt = pt;
    if (S.loupe === L && L.x === at[0] && L.y === at[1]) { S.preview = { pane: L.pane.id, pt, at }; dirty(); }
    if (S.loupe === L && L.again) { L.again = false; loupeSnap(L); }
    return pt;
  });
  return job.p;
}
export function loupeRect() {
  const L = S.loupe, st = $('#stage'), W = st.clientWidth, H = st.clientHeight;
  let cx = L.fx, cy = L.fy - 110;
  if (L.place !== 'above') { cx = L.fx + (L.place === 'right' ? 1 : -1) * 120; cy = L.fy; }
  cx = clamp(cx, LOUPE / 2 + 4, W - LOUPE / 2 - 4); cy = clamp(cy, LOUPE / 2 + 4, H - LOUPE / 2 - 4);
  return { x: cx - LOUPE / 2, y: cy - LOUPE / 2, w: LOUPE, h: LOUPE };
}
export const loupeScale = cam => Math.max(3 * cam.s, 0.8);
export function loupeCam() {
  const L = S.loupe, cam = S.cams[L.pane.id], w = s2w(cam, L.pane, L.x, L.y);
  return { cx: w[0], cy: w[1], s: loupeScale(cam) };
}
