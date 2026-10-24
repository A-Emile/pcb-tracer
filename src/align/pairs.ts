import type { Pair } from '../types';
import { autoOrient, pushUndo, rebuildAlign, updateAlignBar } from './align';
import { affApply } from './geometry';
import { snapPane, snapR, snapRaw } from './snap';
import { saveSoon } from '../db/projects';
import { P } from '../render/gl';
import { dirty } from '../render/frame';
import { S } from '../state';
import { clampCam, w2s } from '../view/camera';

// ptP: fertiger Fang (aus der Lupe) oder Promise darauf; sonst wird hier gefangen
export async function placePoint(paneId, wx, wy, ptP?) {
  const side = paneId === 'back' ? 'back' : 'front', other = side === 'front' ? 'back' : 'front';
  const pt = await (ptP || snapPane(paneId, wx, wy, snapR(S.cams[paneId].s)));
  const P = S.pending || {};
  P[side] = pt; P[side + 'Prop'] = false;
  if (P[other] && !P[other + 'Prop']) { S.pending = P; commitPair(); return; }
  P[other] = null; P[other + 'Prop'] = false;
  S.pending = P;
  if (S.proj.align.pairs.length >= 1) {
    const pr = side === 'front' ? S.inv(pt.x, pt.y) : S.fwd(pt.x, pt.y);
    const cam = S.cams[other], disp = other === 'back' ? affApply(S.pre.m, pr[0], pr[1]) : pr;
    // anderes Fenster nur verschieben, wenn die vorhergesagte Stelle nicht gut sichtbar ist (Rand/zu klein)
    const op = S.panes.find(q => q.id === other), sp = op && w2s(cam, op, disp[0], disp[1]);
    const small = cam.s < S.cams[paneId].s * 0.5;
    if (small || !sp || Math.abs(sp[0] - op.x - op.w / 2) > 0.35 * op.w || Math.abs(sp[1] - op.y - op.h / 2) > 0.35 * op.h) {
      cam.cx = disp[0]; cam.cy = disp[1];
      if (small) cam.s = S.cams[paneId].s;
      clampCam(other);
    }
    const hit = await snapRaw(other, pr[0], pr[1], 60);
    if (S.pending !== P || P[other]) { dirty(); return; }
    P[other] = hit ? { x: hit.x, y: hit.y, r: hit.r, snapped: true } : { x: pr[0], y: pr[1], r: 0, snapped: false };
    P[other + 'Prop'] = true;
  }
  updateAlignBar(); dirty();
}
export function commitPair() {
  const P = S.pending;
  if (!P || !P.front || !P.back) return;
  pushUndo();
  const pr = S.proj.align.pairs;
  const dup = pr.findIndex(q => Math.hypot(q.f[0] - P.front.x, q.f[1] - P.front.y) < 4);
  const pair: Pair = { f: [P.front.x, P.front.y], b: [P.back.x, P.back.y], rf: P.front.r, rb: P.back.r };
  if (dup >= 0) pr[dup] = pair; else pr.push(pair);
  S.pending = null;
  rebuildAlign();
  autoOrient();
  saveSoon();
  updateAlignBar();
}

export function acceptProps() {
  if (!S.props || !S.props.length) return;
  pushUndo();
  for (const o of S.props) S.proj.align.pairs.push({ f: o.f, b: o.b, rf: o.rf, rb: o.rb, auto: true });
  S.props = null;
  rebuildAlign(); autoOrient(); saveSoon(); updateAlignBar();
}
export function pairScreen(paneId, i) {
  const q = S.proj.align.pairs[i], pane = S.panes.find(p => p.id === paneId), cam = S.cams[paneId];
  const w = paneId === 'back' ? affApply(S.pre.m, q.b[0], q.b[1]) : q.f;
  return w2s(cam, pane, w[0], w[1]);
}
export function hitPair(paneId, x, y) {
  let best = null, bd = 24;
  S.proj.align.pairs.forEach((q, i) => { const s = pairScreen(paneId, i), d = Math.hypot(s[0] - x, s[1] - y); if (d < bd) { bd = d; best = i; } });
  return best;
}
export function pendingScreen(paneId) {
  const pt = S.pending && S.pending[paneId], pane = S.panes.find(p => p.id === paneId);
  if (!pt || !pane) return null;
  const w = paneId === 'back' ? affApply(S.pre.m, pt.x, pt.y) : [pt.x, pt.y];
  return w2s(S.cams[paneId], pane, w[0], w[1]);
}
// Punkt unter dem Finger: offener Punkt vor bestehenden Paaren
export function hitPoint(paneId, x, y) {
  const ps = pendingScreen(paneId);
  if (ps && Math.hypot(ps[0] - x, ps[1] - y) < 28) return { pend: paneId, s: ps };
  const i = hitPair(paneId, x, y);
  return i != null ? { pair: i, s: pairScreen(paneId, i) } : null;
}
// Auswahl: nur das andere Fenster springt zum Gegenstück
export function selectPair(i, fromPane?) {
  S.sel = i; S.pending = null;
  if (i != null) {
    const q = S.proj.align.pairs[i], b = affApply(S.pre.m, q.b[0], q.b[1]);
    if (fromPane !== 'front') { S.cams.front.cx = q.f[0]; S.cams.front.cy = q.f[1]; }
    if (fromPane !== 'back') { S.cams.back.cx = b[0]; S.cams.back.cy = b[1]; }
  }
  updateAlignBar(); dirty();
}
export async function movePending(side, wx, wy, ptP) {
  const pt = await (ptP || snapPane(side, wx, wy, snapR(S.cams[side].s))), P = S.pending;
  if (!P) return;
  P[side] = pt; P[side + 'Prop'] = false;
  const other = side === 'front' ? 'back' : 'front';
  if (P[other] && !P[other + 'Prop']) commitPair(); else { updateAlignBar(); dirty(); }
}
export async function movePairPoint(i, paneId, wx, wy, ptP) {
  const pt = await (ptP || snapPane(paneId, wx, wy, snapR(S.cams[paneId].s)));
  pushUndo();
  const q = S.proj.align.pairs[i];
  if (paneId === 'back') { q.b = [pt.x, pt.y]; q.rb = pt.r; } else { q.f = [pt.x, pt.y]; q.rf = pt.r; }
  rebuildAlign(); saveSoon();
}
