import { looColor } from '../align/align';
import { toB } from '../align/board';
import { drawStraight } from '../align/straight';
import { affApply } from '../align/geometry';
import { loupeCam, loupeRect } from '../align/loupe';
import { placeMenu } from '../draw/menu';
import { drawObjs } from '../draw/overlay';
import { drawTrace } from '../draw/trace';
import { visibleLayers } from '../layers/model';
import { matLook, matOn } from '../material/state';
import { octx, ov } from './gl';
import { DPR, S } from '../state';
import { w2s } from '../view/camera';

// ---------------------------------------------------------------- Overlay
export function drawOverlay() {
  const W = ov.width / DPR, H = ov.height / DPR;
  octx.setTransform(DPR, 0, 0, DPR, 0, 0);
  octx.clearRect(0, 0, W, H);
  for (const p of S.panes) drawPaneOverlay(p, S.cams[p.id]);
  if (S.mode === 'main') placeMenu();
  if (S.loupe) {
    const L = loupeRect(), cam = loupeCam();
    octx.clearRect(L.x, L.y, L.w, L.h);
    drawPaneOverlay({ ...L, id: S.loupe.pane.id, loupe: true }, cam);
    octx.strokeStyle = '#fff'; octx.lineWidth = 2; octx.strokeRect(L.x, L.y, L.w, L.h);
    octx.strokeStyle = 'rgba(255,255,255,.9)'; octx.lineWidth = 1;
    const cx = L.x + L.w / 2, cy = L.y + L.h / 2;
    octx.beginPath(); octx.moveTo(cx - 14, cy); octx.lineTo(cx - 4, cy); octx.moveTo(cx + 4, cy); octx.lineTo(cx + 14, cy);
    octx.moveTo(cx, cy - 14); octx.lineTo(cx, cy - 4); octx.moveTo(cx, cy + 4); octx.lineTo(cx, cy + 14); octx.stroke();
  }
}
export function ring(cam, pane, wx, wy, r, color, opt: any = {}) {
  if (pane.loupe) opt = { ...opt, width: 1.5, min: 4 };
  const [x, y] = w2s(cam, pane, wx, wy), rad = Math.max(opt.min ?? 9, r * cam.s * (pane.loupe ? 1 : 1.6));
  octx.save();
  octx.setLineDash(opt.dash ? [5, 4] : []);
  octx.lineWidth = opt.width || 2.5;
  octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.beginPath(); octx.arc(x, y, rad + 1.5, 0, 7); octx.stroke();
  octx.strokeStyle = color; octx.beginPath(); octx.arc(x, y, rad, 0, 7); octx.stroke();
  if (opt.label) {
    octx.font = '600 12px system-ui,sans-serif'; octx.textBaseline = 'middle';
    const tw = octx.measureText(opt.label).width;
    octx.fillStyle = 'rgba(0,0,0,.75)'; octx.fillRect(x + rad + 3, y - 9, tw + 8, 18);
    octx.fillStyle = color; octx.fillText(opt.label, x + rad + 7, y);
  }
  octx.restore();
}
export function drawPaneOverlay(pane, cam) {
  octx.save();
  octx.beginPath(); octx.rect(pane.x, pane.y, pane.w, pane.h); octx.clip();
  if (pane.id === 'front' || pane.id === 'back') {
    const isB = pane.id === 'back', pr = S.proj.align.pairs;
    pr.forEach((q, i) => {
      const w = isB ? affApply(S.pre.m, q.b[0], q.b[1]) : q.f;
      ring(cam, pane, w[0], w[1], (isB ? q.rb : q.rf) || 6, looColor(S.loo[i]), { label: pane.loupe || (pr.length > 30 && S.sel !== i) ? null : String(i + 1), width: S.sel === i ? 4 : 2.5, min: pr.length > 30 ? 5 : 9 });
    });
    if (S.props) for (const o of S.props) {
      const w = isB ? affApply(S.pre.m, o.b[0], o.b[1]) : o.f;
      ring(cam, pane, w[0], w[1], (isB ? o.rb : o.rf) || 6, '#e9edf2', { dash: true, width: 2, min: 6 });
    }
    const P = S.pending;
    if (P && P[pane.id]) {
      const pt = P[pane.id], w = isB ? affApply(S.pre.m, pt.x, pt.y) : [pt.x, pt.y];
      ring(cam, pane, w[0], w[1], pt.r || 6, isB ? '#4fb3ff' : '#ff9a3d', { dash: P[pane.id + 'Prop'], width: 3, label: pane.loupe ? null : (P[pane.id + 'Prop'] ? 'Vorschlag' : 'neu') });
    }
    const pv = S.preview;
    if (S.loupe && pv && pv.pane === pane.id && pv.pt.snapped && pv.at[0] === S.loupe.x && pv.at[1] === S.loupe.y) {
      const w = isB ? affApply(S.pre.m, pv.pt.x, pv.pt.y) : [pv.pt.x, pv.pt.y];
      ring(cam, pane, w[0], w[1], pv.pt.r, '#ffffff', { width: 2 });
    }
    if (!pane.loupe) {
      octx.font = '600 13px system-ui,sans-serif';
      const label = isB ? 'Unten' : 'Oben', tw = octx.measureText(label).width;
      octx.fillStyle = 'rgba(0,0,0,.6)'; octx.fillRect(pane.x + 8, pane.y + 8, tw + 16, 24);
      octx.fillStyle = isB ? '#4fb3ff' : '#ff9a3d'; octx.textBaseline = 'middle'; octx.fillText(label, pane.x + 16, pane.y + 20);
    }
  } else if (pane.id === 'main' && visibleLayers().some(L => L.id === 'back') && !(matOn() && (matLook().cu || matLook().bg))) {
    // (nicht bei „Nur Kupfer“/„Hintergrund ausblenden“: dort ist außerhalb der Platine ohnehin alles weg)
    // Umriss des Rückseitenfotos: zeigt, wo nur eine Seite vorhanden ist
    const bs = S.proj.sides.back, pts = [];
    const edge = (x0, y0, x1, y1) => { for (let i = 0; i < 24; i++) { const q = S.fwd(x0 + (x1 - x0) * i / 24, y0 + (y1 - y0) * i / 24); pts.push(toB(q[0], q[1])); } };
    edge(0, 0, bs.w, 0); edge(bs.w, 0, bs.w, bs.h); edge(bs.w, bs.h, 0, bs.h); edge(0, bs.h, 0, 0);
    octx.setLineDash([6, 5]); octx.lineWidth = 1.5; octx.strokeStyle = 'rgba(79,179,255,.8)';
    octx.beginPath();
    pts.forEach((w, i) => { const s = w2s(cam, pane, w[0], w[1]); i ? octx.lineTo(s[0], s[1]) : octx.moveTo(s[0], s[1]); });
    octx.closePath(); octx.stroke();
  }
  if (pane.id === 'main') { octx.setLineDash([]); drawTrace(pane, cam); drawObjs(pane, cam); drawStraight(pane, cam); }
  octx.restore();
  if (S.mode === 'align' && !pane.loupe && pane.id === 'back') {
    octx.fillStyle = '#343c48';
    if (pane.x > 0) octx.fillRect(pane.x - 2, 0, 2, pane.h); else octx.fillRect(0, pane.y - 2, pane.w, 2);
  }
}
