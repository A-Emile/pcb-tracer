import { HIT, OBJ_TYPES, objGeo, objList, objsShown } from './objects';
import { objScreen } from './overlay';
import { txDist } from './text';
import { activeLayer, layerShare, layerShares, objPickable } from '../layers/model';
import { S } from '../state';
import { clamp } from '../util';
import { s2w } from '../view/camera';

// ---- Treffertest: 24 px am Bildschirm, unabhängig vom Zoom. Nur anwählbare Objekte (objPickable): überwiegend sichtbare Lage;
// im Modus „Normal“ auch andere, aber nur wenn auf der aktiven nichts getroffen wird. Texte vor Linien.
export function distSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy, t = l ? clamp(((px - ax) * dx + (py - ay) * dy) / l, 0, 1) : 0;
  return Math.hypot(px - ax - t * dx, py - ay - t * dy);
}
export function hitObj(x, y) {
  if (!objsShown()) return null;
  const pane = S.panes[0], cam = S.cams.main, act = activeLayer(), m = HIT / cam.s, w = s2w(cam, pane, x, y), sh = layerShares();
  let best = null;
  for (const o of objList()) {
    if (!OBJ_TYPES.includes(o.t) || !objPickable(o, sh)) continue;
    const g = objGeo(o), bb = g.bb;
    if (w[0] < bb[0] - m || w[0] > bb[2] + m || w[1] < bb[1] - m || w[1] > bb[3] + m) continue;
    let d = Infinity;
    const P = o.t === 'text' ? null : objScreen(o, cam, pane);
    if (o.t === 'text') d = txDist(o, x, y, distSeg);
    else if (P.length === 1) d = Math.hypot(x - P[0][0], y - P[0][1]);
    else for (let i = 1; i < P.length; i++) d = Math.min(d, distSeg(x, y, P[i - 1][0], P[i - 1][1], P[i][0], P[i][1]));
    if (d > (o.t === 'text' ? 10 : HIT)) continue;   // Text: Kasten + 4 px, Linie 10 px (daneben tippen setzt neuen Text)
    const sc = d + (layerShare(sh, o.L) >= 0.5 - 1e-6 ? 0 : 1000) + (o.L === act ? 0 : 1) - (o.t === 'text' ? 6 : 0);
    if (!best || sc <= best.sc) best = { o, sc };
  }
  return best && best.o;
}
