import { P, gl, progBase, progBlur, progComp, useP, vao, vao0 } from './gl';
import { DPR, fxQuiet, lookState } from '../state';
import { clamp } from '../util';

// ---------------------------------------------------------------- Filter (lokaler Kontrast) über Bildschirm-Puffer
// Szene → Textur A (mit Mip-Stufen) → Gauß in Stufe k waagrecht (B) und senkrecht (C) → A + k·(A − C).
// Radius folgt der Platine: etwa FX_SIG Pixel des Fotos, umgerechnet in Gerätepixel.
// Regler v: Verstärkung kleiner Unterschiede k·v, höchstens a0 + a1·v Helligkeit wird addiert (weiche Grenze).
// Gemessen (Grün, Regler ½): Lichthof an Bauteilkanten p95 ≈ 23 statt 70–75 Graustufen im Prototyp, Bahnkanten ×1,7–2,0 statt ×2,1–2,2.
export const FX_SIG = 20, BAHN = { k: 10, a0: 0.05, a1: 0.1 };
export const fxb = { w: 0, h: 0, texA: null, fbA: null, rbA: null, lv: {} as Record<number, any> };
export function fxBuffers() {
  const W = gl.canvas.width, H = gl.canvas.height;
  if (fxb.w === W && fxb.h === H && fxb.texA) return fxb;
  fxFree();
  fxb.w = W; fxb.h = H;
  fxb.texA = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, fxb.texA);
  gl.texStorage2D(gl.TEXTURE_2D, Math.floor(Math.log2(Math.max(W, H))) + 1, gl.RGBA8, W, H);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  fxb.rbA = gl.createRenderbuffer(); gl.bindRenderbuffer(gl.RENDERBUFFER, fxb.rbA);
  gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH24_STENCIL8, W, H);
  fxb.fbA = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, fxb.fbA);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, fxb.texA, 0);
  gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_STENCIL_ATTACHMENT, gl.RENDERBUFFER, fxb.rbA);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fxb;
}
export function fxLevel(k) {
  let o = fxb.lv[k];
  if (o) return o;
  const w = Math.max(1, fxb.w >> k), h = Math.max(1, fxb.h >> k), mkT = () => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
    return [t, f];
  };
  const [tB, fB] = mkT(), [tC, fC] = mkT();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return fxb.lv[k] = { w, h, tB, fB, tC, fC };
}
export function fxFree() {
  if (fxb.texA) { gl.deleteTexture(fxb.texA); gl.deleteFramebuffer(fxb.fbA); gl.deleteRenderbuffer(fxb.rbA); }
  for (const o of Object.values(fxb.lv)) { gl.deleteTexture(o.tB); gl.deleteTexture(o.tC); gl.deleteFramebuffer(o.fB); gl.deleteFramebuffer(o.fC); }
  fxb.lv = {}; fxb.texA = null; fxb.w = fxb.h = 0;
}
export function fxApply(cam, v) {
  const sig = clamp(FX_SIG * cam.s * DPR, 1.5, 200), k = clamp(Math.floor(Math.log2(sig / 2)), 1, 7), sk = sig / 2 ** k;
  const lv = fxLevel(k), W = [];
  let sum = 0;
  for (let i = 0; i < 9; i++) { W[i] = Math.exp(-i * i / (2 * sk * sk)); sum += i ? 2 * W[i] : W[i]; }
  for (let i = 0; i < 9; i++) W[i] /= sum;
  gl.disable(gl.SCISSOR_TEST); gl.disable(gl.STENCIL_TEST); gl.disable(gl.BLEND);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, fxb.texA); gl.generateMipmap(gl.TEXTURE_2D);
  gl.bindVertexArray(vao0);
  useP(progBlur); gl.uniform1i(P.uSrc, 0); gl.uniform1fv(P.uW, W); gl.uniform2f(P.uInv, 1 / lv.w, 1 / lv.h);
  gl.viewport(0, 0, lv.w, lv.h);
  gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fB); gl.uniform1f(P.uLod, k); gl.uniform2f(P.uDir, 1 / lv.w, 0);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, lv.fC); gl.bindTexture(gl.TEXTURE_2D, lv.tB); gl.uniform1f(P.uLod, 0); gl.uniform2f(P.uDir, 0, 1 / lv.h);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, fxb.w, fxb.h);
  useP(progComp); gl.uniform1i(P.uA, 0); gl.uniform1i(P.uB, 1); gl.uniform2f(P.uInv, 1 / fxb.w, 1 / fxb.h); gl.uniform1f(P.uK, BAHN.k * v); gl.uniform1f(P.uC, BAHN.k * v / (BAHN.a0 + BAHN.a1 * v));
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, lv.tC); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, fxb.texA);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  gl.bindVertexArray(vao); gl.enable(gl.BLEND);
  useP(progBase);
}

export function fxBahnen() { return fxQuiet() ? 0 : lookState().bahnen; }
