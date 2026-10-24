import type { Pt } from '../types';
import { OBJ_TYPES, objGeo, objList, objsShown, pickId, smoothPath } from './objects';
import { drawText, drawTextSel, txFrame, txLead, txScreenPts, viewXf } from './text';
import { layerShares, objWeight } from '../layers/model';
import { octx } from '../render/gl';
import { S } from '../state';
import { w2s } from '../view/camera';

// ---- Overlay (2D): Pfeilspitzen, Textfelder, laufender Strich
// Pfeilspitze am Ende: Richtung aus dem Punkt ≥ 14 px davor
export function arrowHead(S2, color, wt) {
  const n = S2.length, [px, py] = S2[n - 1];
  let qx = S2[0][0], qy = S2[0][1];
  for (let i = n - 2; i >= 0; i--) if (Math.hypot(px - S2[i][0], py - S2[i][1]) >= 14) { qx = S2[i][0]; qy = S2[i][1]; break; }
  const d = Math.hypot(px - qx, py - qy);
  if (d < 1) return;
  const ux = (px - qx) / d, uy = (py - qy) / d, L = 16, Wd = 7, tx = px + ux * 3, ty = py + uy * 3;
  octx.globalAlpha = wt;
  octx.beginPath(); octx.moveTo(tx, ty); octx.lineTo(tx - ux * L - uy * Wd, ty - uy * L + ux * Wd); octx.lineTo(tx - ux * L + uy * Wd, ty - uy * L - ux * Wd); octx.closePath();
  octx.lineJoin = 'round'; octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.55)'; octx.stroke();
  octx.fillStyle = color; octx.fill(); octx.globalAlpha = 1;
}
// Bildschirmpunkte eines Objekts (mit Verschiebung beim Ziehen)
export function objScreen(o, cam, pane): Pt[] {
  if (o.t === 'text') return txScreenPts(o, cam, pane);
  const g = objGeo(o), off = S.omove && S.omove.id === o.id ? S.omove.off : null;
  return g.pts.map(([x, y]) => w2s(cam, pane, off ? x + off[0] : x, off ? y + off[1] : y));
}
export function drawObjs(pane, cam) {
  if (!objsShown()) return;
  const ls = objList(), W = pane.x + pane.w, H = pane.y + pane.h;
  const selId = pickId(), edId = S.note && S.note.id;
  // Pfeilspitzen in Bildschirmgröße, Texte in Platinengröße; außerhalb des Fensters übersprungen
  const vis = (pts, m) => { let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity; for (const [x, y] of pts) { const q = w2s(cam, pane, x, y); x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); y0 = Math.min(y0, q[1]); y1 = Math.max(y1, q[1]); } return x1 > pane.x - m && x0 < W + m && y1 > pane.y - m && y0 < H + m; };
  const bbPts = bb => [[bb[0], bb[1]], [bb[2], bb[1]], [bb[0], bb[3]], [bb[2], bb[3]]];
  const texts = [], sh = layerShares(), flip = viewXf(cam, pane).flip;
  for (const o of ls) {
    if (!OBJ_TYPES.includes(o.t)) continue;
    const other = objWeight(o, sh);
    if (!other) continue;
    if (o.t === 'text') { if (!pane.loupe && (o.id === selId || o.id === edId || vis(objGeo(o).pts, 40))) texts.push([o, other]); continue; }
    if (!o.arrow) continue;
    if (!vis(bbPts(objGeo(o).bb), 200) && !(S.omove && S.omove.id === o.id)) continue;
    arrowHead(objScreen(o, cam, pane), o.color, other);
  }
  // gedimmte Texte zuerst (unten), der ausgewählte ganz oben, darüber seine Griffe
  texts.sort((a, b) => a[1] - b[1] || +(a[0].id === selId || a[0].id === edId) - +(b[0].id === selId || b[0].id === edId));
  let top = null;
  for (const [o, wt] of texts) {
    const F = txFrame(o, cam, pane, flip), L = txLead(o, F, cam, pane);
    drawText(o, F, wt, L);
    if (o.id === edId || (o.id === selId && !S.note)) top = [o, F, L];
  }
  if (top) drawTextSel(top[0], top[1], top[2], top[0].id === edId);
  // Strich, der gerade gezogen wird
  const st = S.stroke;
  if (st && st.pts.length > 1 && !pane.loupe) {
    const P = st.pts.map(([x, y]) => w2s(cam, pane, x, y));
    octx.lineCap = 'round'; octx.lineJoin = 'round';
    const p = smoothPath(P);
    octx.lineWidth = 6; octx.strokeStyle = 'rgba(0,0,0,.55)'; octx.stroke(p);
    octx.lineWidth = 3; octx.strokeStyle = st.color; octx.stroke(p);
  }
}
