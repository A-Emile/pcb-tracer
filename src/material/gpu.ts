// ---------------------------------------------------------------- Material auf der GPU (Masken je Kachel, nichts gespeichert)
// Je Bild-Kachel der Stufe a (mit Rand Mg aus den Nachbarkacheln) laufen die Schritte des früheren mClassify als Shader-Durchgänge
// (material/shaders.ts): Lab, Gauß getrennt in x/y (texelFetch, Rand = nächster Wert), Kupferfläche als wiederholte 3×3-Dilatation.
// Ergebnis je Kachel: Masken-Textur (R Kupfer, G Fläche, B Druck, A = 1) für Ansichten in Stufe ≤ a (höchstens MG_KEEP gehalten,
// sonst neu gerechnet) und – gemittelt – ein Eintrag in der Übersichts-Maske MA (eine Textur je Lage in Stufe b ≥ a+1 mit Mip-Stufen,
// A = 0 wo noch nichts gerechnet ist) für alle gröberen Ansichten. Reihenfolge: in drawLayer gewünschte (sichtbare) Kacheln zuerst
// (mgMask → mgWant), ohne Geste der Rest in Zeilenfolge; höchstens 3 Kacheln je Bild (1 während einer Geste) und 12 ms.
// Im Speicher (IndexedDB) steht nur das Modell (worker/matModel.ts, files `pid|mat|side`).
// Zwischenwerte RGBA32F (EXT_color_buffer_float), sonst RGBA16F (EXT_color_buffer_half_float; im Mittel < 1/255 Abweichung).
// Speicher (50 MP, a = 1): Arbeits-Texturen 7 × 576² × 16 B ≈ 37 MB, Übersichts-Masken 2 × ≈ 17 MB, ≤ 24 Kachel-Masken ≈ 34 MB.
import { BORDER, TILE, tileCount, tileRect } from '../core/tiles';
import { dirty } from '../render/frame';
import { gl, progBase, useP, vao, vao0 } from '../render/gl';
import { VQ } from '../render/shaders';
import { frameNo, requestTile, texCache } from '../render/tiles';
import { S } from '../state';
import { gest } from '../ui/pointer';
import { updateMatUI } from './run';
import { MG_FS, MG_HEAD } from './shaders';
import { MAT, MATG, matOn } from './state';

export const MG = { ok: null as boolean | null, f32: false, err: '', P: {} as Record<string, any>, fb: new Map<string, WebGLFramebuffer>(), pool: null as any, S: 0, empty: null as WebGLTexture | null, keep: 0, nid: 0 };
export const MG_KEEP = 24, MG_MA_MAX = 4096;
const texId = new WeakMap<WebGLTexture, number>();

export function mgInit() {
  if (MG.ok !== null) return MG.ok;
  // Zwischenwerte in 32-Bit-Float (dann bis auf ±1/255 gleich mit der CPU-Rechnung); window.__mgF16 (Test) erzwingt 16 Bit
  MG.f32 = !!gl.getExtension('EXT_color_buffer_float') && !(window as any).__mgF16;
  MG.ok = MG.f32 || !!gl.getExtension('EXT_color_buffer_half_float');
  if (!MG.ok) return false;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const vs = sh(gl.VERTEX_SHADER, VQ);
  for (const [name, [fs, uni]] of Object.entries(MG_FS)) {
    const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, MG_HEAD + fs)); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const o: any = { prog: p };
    for (const n of ['uSz', ...uni]) o[n] = gl.getUniformLocation(p, n);
    MG.P[name] = o;
  }
  MG.empty = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, MG.empty);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
  return true;
}
export function mgTex(fmt, w, h, levels = 1) {
  const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texStorage2D(gl.TEXTURE_2D, levels, fmt, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, levels > 1 ? gl.LINEAR_MIPMAP_LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, levels > 1 ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}
// Arbeits-Texturen: 7 × RGBA32F (bzw. 16F), Quelle/Region RGBA8, eine Kachel-Maske zum Wegwerfen (bei 576² ≈ 37 MB)
export function mgPool(S_) {
  if (MG.pool && MG.S >= S_) return MG.pool;
  mgFreePool();
  const S2 = Math.ceil(S_ / 64) * 64;
  MG.S = S2;
  const FF = MG.f32 ? gl.RGBA32F : gl.RGBA16F;
  MG.pool = { F: [0, 1, 2, 3, 4, 5, 6].map(() => mgTex(FF, S2, S2)), src: mgTex(gl.RGBA8, S2, S2), G: [mgTex(gl.RGBA8, S2, S2), mgTex(gl.RGBA8, S2, S2)], msk: mgTex(gl.RGBA8, TILE + 2 * BORDER, TILE + 2 * BORDER) };
  return MG.pool;
}
export function mgFreePool() {
  if (!MG.pool) return;
  for (const t of [...MG.pool.F, MG.pool.src, ...MG.pool.G, MG.pool.msk]) gl.deleteTexture(t);
  for (const f of MG.fb.values()) gl.deleteFramebuffer(f);
  MG.fb.clear(); MG.pool = null; MG.S = 0;
}
// Ziel (eine oder mehrere Texturen, Stufe 0) binden; Framebuffer je Kombination gecacht
function mgTarget(...ts) {
  const key = ts.map(t => { let i = texId.get(t); if (!i) texId.set(t, i = ++MG.nid); return i; }).join(',');
  let f = MG.fb.get(key);
  if (!f) {
    f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    ts.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    gl.drawBuffers(ts.map((_, i) => gl.COLOR_ATTACHMENT0 + i));
    MG.fb.set(key, f);
  } else gl.bindFramebuffer(gl.FRAMEBUFFER, f);
}
function mgFb(t) { // Framebuffer für Ziel-Texturen außerhalb des Pools (Kachel-Masken, MA), nicht gecacht
  const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0);
  return f;
}
function mgUse(name, BW, BH, inputs) {
  const p = MG.P[name]; useP(p);
  gl.uniform2i(p.uSz, BW, BH);
  let u = 0;
  for (const [n, t] of inputs) { gl.activeTexture(gl.TEXTURE0 + u); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p[n], u); u++; }
  return p;
}
const mgDraw = () => gl.drawArrays(gl.TRIANGLES, 0, 3);
// Unschärfe genau wie mBlur, σ je Kanal: σ ≤ 0,25 unverändert, σ < 1,2 echter Gauß-Kern (Radius ⌈3σ⌉), sonst 3 Kastenfilter
// (gleiche Breiten wie mBlur), erst waagrecht, dann senkrecht; Rand = nächster Wert.
export function mgKernels(sig) {
  const K = [[], [], []]; // je Durchgang: 4 Kanäle × Gewichte (null = unverändert)
  for (let c = 0; c < 4; c++) {
    const sg = sig[c];
    if (!(sg > 0.25)) { for (const k of K) k.push(null); continue; }
    if (sg < 1.2) {
      const r = Math.ceil(3 * sg), w = []; let sum = 0;
      for (let i = 0; i <= r; i++) { w[i] = Math.exp(-i * i / (2 * sg * sg)); sum += i ? 2 * w[i] : w[i]; }
      K[0].push(w.map(v => v / sum)); K[1].push(null); K[2].push(null);
      continue;
    }
    const wI = Math.sqrt(4 * sg * sg + 1); let wl = Math.floor(wI); if (wl % 2 === 0) wl--;
    const m = Math.round((12 * sg * sg - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4));
    for (let k = 0; k < 3; k++) { const r = ((k < m ? wl : wl + 2) - 1) >> 1; K[k].push(new Array(r + 1).fill(1 / (2 * r + 1))); }
  }
  return K.filter(k => k.some(Boolean)).map(k => {
    const R = Math.min(48, Math.max(0, ...k.map(w => w ? w.length - 1 : 0))), W = new Float32Array(4 * 49);
    k.forEach((w, c) => { if (!w) W[c] = 1; else for (let i = 0; i <= Math.min(R, w.length - 1); i++) W[4 * i + c] = w[i]; });
    return [R, W] as [number, Float32Array];
  });
}
// Zwischenspeicher F[2] und dst abwechselnd, letzter Durchgang nach dst
function mgBlur(src, dst, sig, BW, BH) {
  const pl = MG.pool, K = mgKernels(sig), pass = [];
  for (const dir of [[1, 0], [0, 1]]) for (const k of K) pass.push([dir, k]);
  let from = src;
  pass.forEach(([dir, [R, W]], j) => {
    const to = (pass.length - 1 - j) % 2 === 0 ? dst : pl.F[2];
    mgTarget(to);
    const p = mgUse('blur', BW, BH, [['uSrc', from]]);
    gl.uniform2i(p.uDir, dir[0], dir[1]); gl.uniform1i(p.uR, R); gl.uniform4fv(p.uW, W);
    mgDraw();
    from = to;
  });
}
// Zustand je Lage, angelegt sobald Modell + Umriss da sind (material/run.ts matReady)
export function mgSide(side, meta) {
  const sd = S.proj.sides[side], a = meta.a, [nx, ny] = tileCount(sd.w, sd.h, a);
  let b = a + 1;
  while (b < sd.L && Math.max(Math.ceil(sd.w / 2 ** b), Math.ceil(sd.h / 2 ** b)) > Math.min(MG_MA_MAX, gl.getParameter(gl.MAX_TEXTURE_SIZE))) b++;
  const mw = Math.ceil(sd.w / 2 ** b), mh = Math.ceil(sd.h / 2 ** b), lv = Math.floor(Math.log2(Math.max(mw, mh))) + 1;
  const ma = mgTex(gl.RGBA8, mw, mh, lv), fb = mgFb(ma);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, ma); gl.generateMipmap(gl.TEXTURE_2D);
  const off = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, off);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R16F, meta.cw, meta.ch, 0, gl.RED, gl.FLOAT, meta.off);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return { side, a, b, nx, ny, mw, mh, ma, maFb: fb, off, done: new Uint8Array(nx * ny), tries: {}, n: 0, tiles: new Map(), want: new Map(), maDirty: false,
    Mg: Math.ceil(6.5 * meta.tw / 2 ** a) + 4, t0: performance.now(), tFirst: 0, tVis: 0, tDone: 0 };
}
export function mgFreeSide(g) {
  gl.deleteTexture(g.ma); gl.deleteFramebuffer(g.maFb); gl.deleteTexture(g.off);
  for (const T of g.tiles.values()) gl.deleteTexture(T.t);
  MG.keep -= g.tiles.size;
}
// Wunsch aus drawLayer: Kachel i (Stufe a) bald rechnen; keep = als eigene Textur halten (Ansicht in Stufe ≤ a)
export function mgWant(g, i, prio, keep) {
  const o = g.want.get(i);
  if (!o) g.want.set(i, { prio, keep });
  else { o.prio = Math.min(o.prio, prio); o.keep = o.keep || keep; }
}
// Maske für die Bild-Kachel (l, tx, ty) beim Zeichnen: in Stufe ≤ a die Kachel-Maske (fehlt sie: anfordern), sonst bzw. bis dahin
// die Übersichts-Maske MA (vor dem ersten Ergebnis MG.empty: Foto + schon wirksamer Umriss). r = Bereich der Textur in Vollauflösungs-Pixeln.
export function mgMask(g, sd, l, tx, ty, prio): { t: WebGLTexture, r: { sx0: number, sy0: number, sx1: number, sy1: number } } {
  const a = g.a;
  if (l <= a) {
    const ax = tx >> (a - l), ay = ty >> (a - l), i = ay * g.nx + ax, T = g.tiles.get(i);
    if (T) { T.used = frameNo; return { t: T.t, r: tileRect(sd.w, sd.h, a, ax, ay) }; }
    mgWant(g, i, prio, true);
  } else {
    const k = l - a;
    for (let y = ty << k; y < Math.min(g.ny, (ty + 1) << k); y++) for (let x = tx << k; x < Math.min(g.nx, (tx + 1) << k); x++) if (!g.done[y * g.nx + x]) mgWant(g, y * g.nx + x, prio, false);
  }
  return { t: g.n ? g.ma : MG.empty, r: { sx0: 0, sy0: 0, sx1: g.mw * 2 ** g.b, sy1: g.mh * 2 ** g.b } };
}
// Eine Kachel rechnen. false = Quellkacheln fehlen noch (angefordert).
export function mgTile(side, g, i, keep, prio) {
  const sd = S.proj.sides[side], pid = S.proj.id, meta = MAT.meta[side], M = meta.model, a = g.a, s = 2 ** a;
  const tx = i % g.nx, ty = (i / g.nx) | 0, r = tileRect(sd.w, sd.h, a, tx, ty), lw = Math.ceil(sd.w / s), lh = Math.ceil(sd.h / s);
  const ex0 = r.sx0 / s, ey0 = r.sy0 / s, ex1 = ex0 + r.tw, ey1 = ey0 + r.th, Mg = g.Mg;
  const bx0 = Math.max(0, ex0 - Mg), by0 = Math.max(0, ey0 - Mg), bx1 = Math.min(lw, ex1 + Mg), by1 = Math.min(lh, ey1 + Mg), BW = bx1 - bx0, BH = by1 - by0;
  const src = [];
  let miss = false;
  for (let y = Math.floor(by0 / TILE); y <= Math.min(g.ny - 1, Math.floor((by1 - 1) / TILE)); y++)
    for (let x = Math.floor(bx0 / TILE); x <= Math.min(g.nx - 1, Math.floor((bx1 - 1) / TILE)); x++) {
      const key = `${pid}|${side}|${a}|${x}|${y}`, tc = texCache.get(key);
      if (!tc) { requestTile(key, prio); miss = true; } else { tc.used = frameNo; src.push([tc.t, tileRect(sd.w, sd.h, a, x, y)]); }
    }
  if (miss) {
    // fehlende Quellkacheln: nach 600 Versuchen ohne Maske lassen (kein Dauer-Neuzeichnen)
    g.tries[i] = (g.tries[i] || 0) + 1;
    if (g.tries[i] > 600 && !g.done[i]) { g.done[i] = 1; g.n++; console.warn('Material: Quellkacheln fehlen', side, tx, ty); if (g.n === g.nx * g.ny) g.tDone = performance.now(); }
    return false;
  }
  const pl = mgPool(Math.max(BW, BH)), F = pl.F, twa = meta.tw / s;
  gl.viewport(0, 0, BW, BH);
  // Quelle
  mgTarget(pl.src); gl.enable(gl.SCISSOR_TEST);
  let p = mgUse('copy', BW, BH, []);
  for (const [t, rr] of src) {
    const ox = rr.sx0 / s - bx0, oy = rr.sy0 / s - by0, x0 = Math.max(0, ox), y0 = Math.max(0, oy), x1 = Math.min(BW, ox + rr.tw), y1 = Math.min(BH, oy + rr.th);
    gl.scissor(x0, y0, x1 - x0, y1 - y0);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(p.uT, 0); gl.uniform2i(p.uOff, ox, oy);
    mgDraw();
  }
  gl.disable(gl.SCISSOR_TEST);
  const fc = 2 ** (meta.c - a);
  mgTarget(F[0], F[1]);
  p = mgUse('lab', BW, BH, [['uSrc', pl.src], ['uOffT', g.off]]);
  gl.uniform4f(p.uOM, bx0 / fc / meta.cw, by0 / fc / meta.ch, 1 / fc / meta.cw, 1 / fc / meta.ch); gl.uniform1f(p.uLc, M.lack[0]);
  mgDraw();
  const s0 = 0.12 * twa;
  if (s0 > 0.8) { // (nur bei sehr breiten Bahnen in der gröbsten Stufe) leichte Glättung
    mgBlur(F[0], F[3], [s0, s0, s0, 0], BW, BH);
    mgTarget(F[1]); p = mgUse('x', BW, BH, [['uT0', F[3]]]); gl.uniform1f(p.uLc, M.lack[0]); mgDraw();
    [F[0], F[3]] = [F[3], F[0]];
  }
  mgBlur(F[1], F[3], [0.4 * twa, 0.4 * twa, 0, 0], BW, BH);
  mgTarget(F[4], F[5], F[6]);
  p = mgUse('cls', BW, BH, [['uT0', F[0]], ['uBL', F[3]]]);
  gl.uniform3f(p.uLack, M.lack[0], M.lack[1], M.lack[2]); gl.uniform3f(p.uCu, M.cu[0], M.cu[1], M.cu[2]); gl.uniform1f(p.uC0, M.C0); gl.uniform1f(p.uBare, M.bare ? 1 : 0);
  mgDraw();
  mgBlur(F[6], F[0], [1.2 * twa, 0.7 * twa, 0, 0], BW, BH);
  mgTarget(F[1], F[3]); mgUse('ws', BW, BH, [['uC1', F[4]], ['uC2', F[5]], ['uBW', F[0]]]); mgDraw();
  mgBlur(F[1], F[4], [0, 0, 0, 0.4 * twa], BW, BH);
  mgTarget(F[5]); mgUse('norm', BW, BH, [['uZ', F[4]], ['uC2', F[3]]]); mgDraw();
  mgBlur(F[5], F[6], [0, 0, 0.8 * twa, 2 * twa], BW, BH);
  mgTarget(pl.G[0]); mgUse('seed', BW, BH, [['uD', F[5]], ['uE', F[6]]]); mgDraw();
  let gi = 0;
  const nd = Math.ceil(2.6 * twa);
  for (let it = 0; it < nd + 2; it++) {
    mgTarget(pl.G[1 - gi]); p = mgUse('dil', BW, BH, [['uG', pl.G[gi]]]); gl.uniform1f(p.uOk, it < nd ? 1 : 0); mgDraw(); gi = 1 - gi;
  }
  // Ergebnis: eigene Textur (halten) oder Wegwerf-Maske
  let out = pl.msk, fbo = null;
  if (keep) {
    out = mgTex(gl.RGBA8, r.tw, r.th, Math.floor(Math.log2(Math.max(r.tw, r.th))) + 1);
    fbo = mgFb(out);
  } else mgTarget(out);
  gl.viewport(0, 0, r.tw, r.th);
  p = mgUse('fin', r.tw, r.th, [['uD', F[5]], ['uE', F[6]], ['uG', pl.G[gi]]]); gl.uniform2i(p.uO, ex0 - bx0, ey0 - by0); mgDraw();
  if (keep) {
    gl.deleteFramebuffer(fbo);
    gl.bindTexture(gl.TEXTURE_2D, out); gl.generateMipmap(gl.TEXTURE_2D);
    const old = g.tiles.get(i); if (old) { gl.deleteTexture(old.t); MG.keep--; }
    g.tiles.set(i, { t: out, used: frameNo }); MG.keep++;
  }
  if (!g.done[i]) {
    const f = 2 ** (g.b - a), x0 = tx * TILE, y0 = ty * TILE, x1 = Math.min(lw, x0 + TILE), y1 = Math.min(lh, y0 + TILE);
    gl.bindFramebuffer(gl.FRAMEBUFFER, g.maFb); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, g.mw, g.mh); gl.enable(gl.SCISSOR_TEST);
    const X0 = Math.floor(x0 / f), Y0 = Math.floor(y0 / f), X1 = Math.ceil(x1 / f), Y1 = Math.ceil(y1 / f);
    gl.scissor(X0, Y0, X1 - X0, Y1 - Y0);
    p = mgUse('down', r.tw, r.th, [['uT', out]]);
    gl.uniform2i(p.uE0, ex0, ey0); gl.uniform2i(p.uX0, x0, y0); gl.uniform2i(p.uX1, x1, y1); gl.uniform1i(p.uF, f);
    mgDraw(); gl.disable(gl.SCISSOR_TEST);
    g.done[i] = 1; g.n++; g.maDirty = true;
    if (!g.tFirst) g.tFirst = performance.now();
    if (g.n === g.nx * g.ny) g.tDone = performance.now();
  }
  return true;
}
// Nach dem Zeichnen (render/scene.ts): gewünschte Kacheln (sichtbar zuerst), ohne Bedienung auch den Rest. Höchstens n Kacheln je Bild.
export function matPump() {
  if (!matOn() || MG.ok === false) return;
  try { if (!mgInit()) { updateMatUI(); return; } } catch (e) { MG.ok = false; MG.err = String(e.message || e); console.error(e); updateMatUI(); return; }
  const sides = Object.keys(MATG).filter(sd => MAT.meta[sd]);
  if (!sides.length) return;
  const busy = !!gest, list = [];
  for (const sd of sides) {
    const g = MATG[sd];
    for (const [i, o] of g.want) if (!g.done[i] || (o.keep && !g.tiles.has(i))) list.push([o.prio, sd, i, o.keep]);
    // ohne Bedienung: der Rest in Zeilenfolge (wenige zugleich, damit die Quellkacheln im Speicher bleiben)
    if (!busy) for (let i = 0, k = 0; i < g.done.length && k < 4; i++) if (!g.done[i] && !g.want.has(i)) { list.push([1e6 + i, sd, i, false]); k++; }
  }
  let n = 0;
  if (list.length) {
    list.sort((p, q) => p[0] - q[0]);
    const max = busy ? 1 : 3, t0 = performance.now();
    gl.disable(gl.BLEND); gl.disable(gl.STENCIL_TEST); gl.disable(gl.SCISSOR_TEST); gl.bindVertexArray(vao0);
    for (const [prio, sd, i, keep] of list) {
      if (n >= max || performance.now() - t0 > 12) break;
      if (keep && MG.keep >= MG_KEEP) mgEvict();
      if (mgTile(sd, MATG[sd], i, keep, prio < 1e6 ? 0.25 : 50)) n++;
    }
    for (const sd of sides) { const g = MATG[sd]; if (g.maDirty) { gl.bindTexture(gl.TEXTURE_2D, g.ma); gl.generateMipmap(gl.TEXTURE_2D); g.maDirty = false; } }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.activeTexture(gl.TEXTURE0); gl.bindVertexArray(vao); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    useP(progBase);
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  }
  for (const sd of sides) {
    const g = MATG[sd];
    if (!g.tVis && g.n && ![...g.want].some(([i, o]) => !g.done[i] || (o.keep && !g.tiles.has(i)))) g.tVis = performance.now();
    g.want.clear();
  }
  if (n || list.length) { dirty(); updateMatUI(); }
}
// älteste nicht im letzten Bild benutzte Kachel-Maske verwerfen (wird bei Bedarf neu gerechnet)
function mgEvict() {
  let best = null;
  for (const g of Object.values(MATG)) for (const [i, T] of g.tiles) if (T.used < frameNo && (!best || T.used < best[2].used)) best = [g, i, T];
  if (!best) return;
  gl.deleteTexture(best[2].t); best[0].tiles.delete(best[1]); MG.keep--;
}
