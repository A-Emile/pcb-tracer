import { affApply } from '../align/geometry';
import { TILE, tileCount, tileRect } from '../core/tiles';
import { layerColor, shownLayer, visibleLayers } from '../layers/model';
import { MAT_TINT, matLook, matOn, matState } from '../material/state';
import { mgMask } from '../material/gpu';
import { P, gl, progBase, progMat, useP } from './gl';
import { frameNo, requestTile, texCache, tileVerts } from './tiles';
import { DPR, S } from '../state';
import { clamp, hexRGB } from '../util';
import { fromB } from '../align/board';
import { s2w, vm } from '../view/camera';

// sichtbarer Bereich in Rohkoordinaten einer Seite
export function rawBBox(pane, cam, kind) {
  const pts = [];
  for (let j = 0; j <= 4; j++) for (let i = 0; i <= 4; i++) {
    const w = s2w(cam, pane, pane.x + pane.w * i / 4, pane.y + pane.h * j / 4);
    if (kind === 'fwd') { const q = fromB(w[0], w[1]); pts.push(S.inv(q[0], q[1])); }
    else pts.push(kind === 'pre' ? affApply(S.preInv, w[0], w[1]) : kind === 'board' ? fromB(w[0], w[1]) : w);
  }
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const mg = 0.05 * Math.max(x1 - x0, y1 - y0);
  return [x0 - mg, y0 - mg, x1 + mg, y1 + mg];
}
// mt: Material dieser Lage ({meta, out, g}) oder null. Je Bild-Kachel die Maske aus mgMask (Kachel-Maske oder Übersichts-Maske).
export function drawLayer(side, kind, cam, pane, alpha, mt?) {
  const sd = S.proj.sides[side], pid = S.proj.id;
  const bb = rawBBox(pane, cam, kind);
  const target = clamp(Math.floor(Math.log2(1 / (cam.s * DPR))), 0, sd.L);
  gl.clear(gl.STENCIL_BUFFER_BIT);
  gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
  gl.uniform2f(P.uC, cam.cx, cam.cy); gl.uniform1f(P.uS, cam.s); gl.uniform2f(P.uHalf, pane.w / 2, pane.h / 2); gl.uniform1f(P.uA, alpha); gl.uniform4fv(P.uR, vm().m);
  const ccx = (bb[0] + bb[2]) / 2, ccy = (bb[1] + bb[3]) / 2;
  for (let l = target; l <= sd.L; l++) {
    const span = TILE * 2 ** l, [nx, ny] = tileCount(sd.w, sd.h, l);
    const tx0 = Math.max(0, Math.floor(bb[0] / span)), tx1 = Math.min(nx - 1, Math.floor(bb[2] / span));
    const ty0 = Math.max(0, Math.floor(bb[1] / span)), ty1 = Math.min(ny - 1, Math.floor(bb[3] / span));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const key = `${pid}|${side}|${l}|${tx}|${ty}`, tc = texCache.get(key), prio = l === sd.L ? -1 : Math.hypot((tx + 0.5) * span - ccx, (ty + 0.5) * span - ccy) / span;
      if (!tc) {
        if (l === target || l === sd.L) requestTile(key, prio);
        continue;
      }
      tc.used = frameNo;
      if (P === progMat) {
        const mc = mt ? mgMask(mt.g, sd, l, tx, ty, prio) : null;   // Masken-Textur von der GPU (material/gpu.ts)
        gl.uniform1f(P.uOn, mc ? 1 : 0);
        if (mc) {
          const r = tileRect(sd.w, sd.h, l, tx, ty), mr = mc.r;
          const rw = r.sx1 - r.sx0, rh = r.sy1 - r.sy0, mw = mr.sx1 - mr.sx0, mh = mr.sy1 - mr.sy0, gw = mt.meta.cw * 2 ** mt.meta.c, gh = mt.meta.ch * 2 ** mt.meta.c;
          gl.uniform4f(P.uMT, (r.sx0 - mr.sx0) / mw, (r.sy0 - mr.sy0) / mh, rw / mw, rh / mh);
          gl.uniform4f(P.uGT, r.sx0 / gw, r.sy0 / gh, rw / gw, rh / gh);
          gl.uniform2f(P.uRing, mt.meta.tw / rw, mt.meta.tw / rh);
          gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, mc.t); gl.activeTexture(gl.TEXTURE0);
        }
      }
      const v = tileVerts(side, l, tx, ty, kind);
      gl.bindTexture(gl.TEXTURE_2D, tc.t);
      gl.bufferData(gl.ARRAY_BUFFER, v, gl.STREAM_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, v.length / 4);
    }
  }
}
export function setPaneGL(r) {
  const H = gl.canvas.height;
  const x = Math.round(r.x * DPR), y = Math.round(H - (r.y + r.h) * DPR), w = Math.round(r.w * DPR), h = Math.round(r.h * DPR);
  gl.viewport(x, y, w, h); gl.scissor(x, y, w, h);
}
export function drawPane(pane, cam) {
  setPaneGL(pane);
  gl.enable(gl.STENCIL_TEST);
  if (pane.id === 'main') drawMain(pane, cam);
  else if (pane.id === 'front') drawLayer('front', 'ident', cam, pane, 1);
  else drawLayer('back', 'pre', cam, pane, 1);
  gl.disable(gl.STENCIL_TEST);
}

// Hauptansicht: Lagen von hinten nach vorne übereinander, je mit wirksamer Deckkraft (visibleLayers) und Material-Ansicht
// (gilt für alle Lagen gleich; bei „Nur Kupfer“ die nicht gezeigten Lagen in ihrer Lagenfarbe). Zielalpha bleibt unberührt (ZERO, ONE).
export function drawMain(pane, cam) {
  const vis = visibleLayers(), m = matLook(), on = matOn(), sid = shownLayer();
  useP(progMat);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  if (on) {
    gl.uniform4f(P.uVis, 1, m.cu && m.pour ? 0 : 1, 1, m.cu ? 0 : 1);
    gl.uniform1f(P.uOutV, m.cu || m.bg ? 0 : 1);
    gl.uniform1f(P.uFill, m.silk ? 1 : 0);
  }
  for (let i = vis.length - 1; i >= 0; i--) {
    const L = vis[i], mt = on ? matState(L.id) : null;
    if (mt) {
      const tint = m.cu && (L.id !== sid || MAT_TINT === 'all') ? hexRGB(layerColor(L.id)) : null;
      gl.uniform4f(P.uTint, ...((tint || [0, 0, 0]) as [number, number, number]), tint ? 1 : 0);
      gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, mt.out); gl.activeTexture(gl.TEXTURE0);
    }
    drawLayer(L.id, L.id === 'front' ? 'board' : 'fwd', cam, pane, L.op, mt);
  }
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  useP(progBase);
}
