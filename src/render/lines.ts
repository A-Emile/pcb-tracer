import { objById, objGeo, objList, objVer, objVisKey, objsShown, pickId } from '../draw/objects';
import { trDrawList, trShown, trVisKey } from '../draw/trace';
import { layerColor, layerShares, objWeight } from '../layers/model';
import { gl, progBase, useP, vao, vbuf } from './gl';
import { setPaneGL } from './layer';
import { S } from '../state';
import { hexRGB } from '../util';
import { LINE_FS, LINE_VS } from './shaders';
import { vm } from '../view/camera';

// ---- Linien in WebGL: Geometrie einmal je Änderung in Platinenkoordinaten, Breite in Bildschirm-px im Vertex-Shader,
// Gewicht je Objekt (objWeight: gedimmt/voll) als Alpha im Vertex. Pro Durchgang deckt der Stencil jeden Bildpunkt nur einmal (keine dunkleren Knoten).
// Puffer-Reihenfolge: gedimmte Objekte, volle, ausgewähltes Objekt (eigener Bereich, kann beim Ziehen verschoben gezeichnet werden).
// Ausgeblendete (Gewicht 0) kommen gar nicht in den Puffer.
export const LG = { prog: null, vao: null, vb: null, ib: null, key: '', r: [0, 0, 0, 0], tr: [0, 0, 0, 0] };
export function lineProg() {
  if (LG.prog) return LG.prog;
  const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, LINE_VS));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, LINE_FS));
  gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aN'); gl.bindAttribLocation(prog, 2, 'aQ'); gl.bindAttribLocation(prog, 3, 'aD'); gl.bindAttribLocation(prog, 4, 'aC');
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  const o = { prog };
  for (const n of ['uC', 'uS', 'uHalf', 'uW', 'uOff', 'uCol', 'uMix', 'uR', 'uB']) o[n] = gl.getUniformLocation(prog, n);
  LG.vao = gl.createVertexArray(); gl.bindVertexArray(LG.vao);
  LG.vb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, LG.vb);
  const F = 4, ST = 11 * F;
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, ST, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, ST, 2 * F);
  gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 2, gl.FLOAT, false, ST, 4 * F);
  gl.enableVertexAttribArray(3); gl.vertexAttribPointer(3, 1, gl.FLOAT, false, ST, 6 * F);
  gl.enableVertexAttribArray(4); gl.vertexAttribPointer(4, 4, gl.FLOAT, false, ST, 7 * F);
  LG.ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, LG.ib);
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);   // ARRAY_BUFFER ist globaler Zustand: Kachel-Puffer wieder binden
  return LG.prog = o;
}

// Kurve wie smoothPath (Mittelpunkte, quadratisch), je Bogen 3 Teilstücke
export function curvePts(P) {
  if (P.length < 3) return P;
  const out = [P[0]];
  let s = P[0];
  for (let i = 1; i < P.length - 1; i++) {
    const c = P[i], e = [(P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2];
    for (let k = 1; k <= 3; k++) { const t = k / 3, u = 1 - t; out.push([u * u * s[0] + 2 * u * t * c[0] + t * t * e[0], u * u * s[1] + 2 * u * t * c[1] + t * t * e[1]]); }
    s = e;
  }
  out.push(P[P.length - 1]);
  return out;
}
export function buildLines(selId) {
  lineProg();
  const V = [], I = [];
  let nv = 0;
  const quad = (a, b, c, d) => { I.push(nv + a, nv + b, nv + c, nv + b, nv + d, nv + c); };
  // je Strich ein durchgehendes Band mit Gehrung (keine Fugen zwischen Teilstücken), runde Kappen an den Enden und scharfen Knicken
  const emit = (o, oth) => {
    const [r, g, b] = hexRGB(o.color), Q = [];
    for (const p of curvePts(objGeo(o).pts)) { const l = Q[Q.length - 1]; if (!l || Math.hypot(p[0] - l[0], p[1] - l[1]) > 1e-3) Q.push(p); }
    const disc = (p, d) => { for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) V.push(p[0], p[1], cx, cy, cx, cy, d, r, g, b, oth); quad(0, 1, 2, 3); nv += 4; };
    if (Q.length < 2) { if (Q.length) disc(Q[0], 0); return; }
    const N = [];
    for (let i = 0; i < Q.length - 1; i++) { const dx = Q[i + 1][0] - Q[i][0], dy = Q[i + 1][1] - Q[i][1], l = Math.hypot(dx, dy); N.push([-dy / l, dx / l, l]); }
    let dist = 0;
    const base = nv, sharp = [];
    for (let k = 0; k < Q.length; k++) {
      const a = N[Math.max(0, k - 1)], c = N[Math.min(N.length - 1, k)];
      let mx = a[0] + c[0], my = a[1] + c[1];
      const ml = Math.hypot(mx, my), cosT = a[0] * c[0] + a[1] * c[1];
      if (ml < 1e-6) { mx = c[0]; my = c[1]; } else { mx /= ml; my /= ml; }
      const sc = 1 / Math.max(mx * c[0] + my * c[1], 0.5);   // Gehrung, höchstens doppelte Breite
      if (cosT < 0.5) sharp.push([Q[k], dist]);
      V.push(Q[k][0], Q[k][1], mx * sc, my * sc, 0, 1, dist, r, g, b, oth, Q[k][0], Q[k][1], -mx * sc, -my * sc, 0, -1, dist, r, g, b, oth);
      if (k < N.length) dist += N[k][2];
    }
    for (let k = 0; k < Q.length - 1; k++) { const i = base + 2 * k; I.push(i, i + 1, i + 2, i + 1, i + 3, i + 2); }
    nv += 2 * Q.length;
    disc(Q[0], 0); disc(Q[Q.length - 1], dist);
    for (const [p, d] of sharp) disc(p, d);
  };
  // Bahnen zuerst (eigene Bereiche LG.tr: gedämpft, voll, hervorgehoben): Band mit halber Breite aD, runde Enden
  const tq = [];
  for (const [o, wt, grp] of trDrawList()) {
    const a = objById(o.a), b = objById(o.b);
    if (a && b) tq.push([a, b, o.w / 2, hexRGB(layerColor(o.L)), wt, grp]);
  }
  const seg = ([a, b, hw, [r, g, bl], wt]) => {
    const dx = b.x - a.x, dy = b.y - a.y, l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l;
    V.push(a.x, a.y, nx, ny, 0, 1, hw, r, g, bl, wt, a.x, a.y, -nx, -ny, 0, -1, hw, r, g, bl, wt, b.x, b.y, nx, ny, 0, 1, hw, r, g, bl, wt, b.x, b.y, -nx, -ny, 0, -1, hw, r, g, bl, wt);
    quad(0, 1, 2, 3); nv += 4;
    for (const p of [a, b]) { for (const [cx, cy] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) V.push(p.x, p.y, cx, cy, cx, cy, hw, r, g, bl, wt); quad(0, 1, 2, 3); nv += 4; }
  };
  const tr = [];
  for (const k of [0, 1, 2]) { tr.push(I.length); for (const q of tq) if (q[5] === k) seg(q); }
  tr.push(I.length);
  LG.tr = tr;
  const sh = layerShares(), inks = (objsShown() ? objList() : []).filter(o => o.t === 'ink').map(o => [o, objWeight(o, sh)] as [any, number]).filter(a => a[1] > 0) as any[], r = [];
  for (const grp of [([o, w]) => w < 1 && o.id !== selId, ([o, w]) => w >= 1 && o.id !== selId, ([o]) => o.id === selId]) {
    r.push(I.length);
    for (const a of inks) if (grp(a)) emit(a[0], a[1]);
  }
  r.push(I.length);
  LG.r = r;
  gl.bindVertexArray(LG.vao);
  gl.bindBuffer(gl.ARRAY_BUFFER, LG.vb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(V), gl.STATIC_DRAW);
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, LG.ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint32Array(I), gl.STATIC_DRAW);
  gl.bindVertexArray(vao); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
}
export function drawLinesGL(pane, cam, loupe = false) {
  if (!objsShown() && !trShown()) return;
  const sel = pickId(), key = objVer + '|' + objVisKey() + '|' + sel + '|' + (objsShown() ? 1 : 0) + '|' + trVisKey();
  if (LG.key !== key) { LG.key = key; buildLines(sel); }
  const r = LG.r, t = LG.tr;
  if (r[3] === 0 && t[3] === 0) return;
  const p = lineProg();
  setPaneGL(pane);
  gl.enable(gl.SCISSOR_TEST); gl.enable(gl.STENCIL_TEST);
  useP(p); gl.bindVertexArray(LG.vao);
  gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ZERO, gl.ONE);
  gl.uniform2f(p.uC, cam.cx, cam.cy); gl.uniform1f(p.uS, cam.s); gl.uniform2f(p.uHalf, pane.w / 2, pane.h / 2); gl.uniform4fv(p.uR, vm().m);
  gl.stencilFunc(gl.EQUAL, 0, 0xff); gl.stencilOp(gl.KEEP, gl.KEEP, gl.INCR);
  const pass = (a, b, w, col, mix) => {
    if (b <= a) return;
    gl.clear(gl.STENCIL_BUFFER_BIT);
    gl.uniform1f(p.uW, w); gl.uniform4f(p.uCol, col[0], col[1], col[2], col[3]); gl.uniform1f(p.uMix, mix);
    gl.drawElements(gl.TRIANGLES, b - a, gl.UNSIGNED_INT, a * 4);
  };
  const two = (a, b) => { pass(a, b, 6, [0, 0, 0, 0.55], 1); pass(a, b, 3, [0, 0, 0, 1], 0); };
  gl.uniform2f(p.uOff, 0, 0);
  // Bahnen: dunkler Saum, Füllung in Lagenfarbe (Lupe: blasser, damit das Kupfer darunter zu sehen bleibt); hervorgehoben mit hellem Rand
  if (t[3] > 0) {
    const fa = loupe ? 0.4 : 0.78;
    gl.uniform1f(p.uB, 1);
    for (const k of [0, 1]) { pass(t[k], t[k + 1], 2, [0, 0, 0, 0.5 * fa], 1); pass(t[k], t[k + 1], 0, [0, 0, 0, fa], 0); }
    if (!loupe) pass(t[2], t[3], 6, [1, 1, 1, 0.55], 1);
    pass(t[2], t[3], 2, [0, 0, 0, 0.6 * fa], 1); pass(t[2], t[3], 0, [0, 0, 0, Math.min(1, fa + 0.1)], 0);
    gl.uniform1f(p.uB, 0);
  }
  two(r[0], r[1]); two(r[1], r[2]);
  if (r[3] > r[2]) {
    const off = S.omove && S.omove.id === sel ? S.omove.off : [0, 0];
    gl.uniform2f(p.uOff, off[0], off[1]);
    pass(r[2], r[3], 12, [1, 1, 1, 0.35], 1); two(r[2], r[3]);
  }
  gl.disable(gl.STENCIL_TEST);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
  gl.bindVertexArray(vao); useP(progBase);
}
