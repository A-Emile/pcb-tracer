import { BD, toB } from '../align/board';
import { affApply } from '../align/geometry';
import { tileRect } from '../core/tiles';
import { idbGet } from '../db/idb';
import { gl } from './gl';
import { dirty } from './frame';
import { S } from '../state';

export const texCache = new Map(); // key -> {t, used}
export const want = new Map(), loading = new Set();
export let inflight = 0, frameNo = 0, projToken = 0;
export const TEX_MAX = 160;
// neues Bild: Bildnummer weiter, Kachelwünsche werden beim Zeichnen neu gesammelt
export function nextFrame() { frameNo++; want.clear(); }
export function requestTile(key, prio) {
  if (texCache.has(key) || loading.has(key)) return;
  const old = want.get(key);
  if (old === undefined || prio < old) want.set(key, prio);
}
export function pump() {
  while (inflight < 6 && want.size) {
    let bk = null, bp = Infinity;
    for (const [k, p] of want) if (p < bp) { bp = p; bk = k; }
    want.delete(bk); loading.add(bk); inflight++;
    loadTile(bk, projToken).finally(() => { inflight--; loading.delete(bk); pump(); });
  }
}
export async function loadTile(key, token) {
  const blob = await idbGet(S.db, 'tiles', key);
  if (!blob || token !== projToken) return;
  const kp = key.split('|'), isMask = kp[2][0] === 'm';
  const bmp = await (isMask ? createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' }) : createImageBitmap(blob));
  if (token !== projToken) { bmp.close(); return; }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  bmp.close();
  texCache.set(key, { t, used: frameNo, top: +(isMask ? kp[2].slice(1) : kp[2]) === S.proj.sides[kp[1]].L });
  evict();
  dirty();
}
export function evict() {
  if (texCache.size <= TEX_MAX) return;
  const list = [...texCache].filter(([, v]) => !v.top && v.used < frameNo).sort((a, b) => a[1].used - b[1].used);
  for (let i = 0; i < list.length && texCache.size > TEX_MAX; i++) { gl.deleteTexture(list[i][1].t); texCache.delete(list[i][0]); }
}
export function dropTextures() {
  for (const v of texCache.values()) gl.deleteTexture(v.t);
  texCache.clear(); want.clear(); meshCache.clear(); projToken++;
}

export const meshCache = new Map();
export const GRID = 8;
export function tileVerts(side, l, tx, ty, kind) {
  const sd = S.proj.sides[side], r = tileRect(sd.w, sd.h, l, tx, ty);
  const uw = r.sx1 - r.sx0, vh = r.sy1 - r.sy0;
  const uv = (x, y) => [(x - r.sx0) / uw, (y - r.sy0) / vh];
  // Rückseite (fwd) und gerade gestellte Oberseite mit Perspektive (board): Gitter, sonst reichen die 4 Ecken
  if (kind === 'fwd' || (kind === 'board' && !BD.aff)) {
    const key = `${side}|${kind}|${l}|${tx}|${ty}`;
    let m = meshCache.get(key);
    if (m) return m;
    const g = GRID, P = [];
    for (let j = 0; j <= g; j++) for (let i = 0; i <= g; i++) {
      const x = r.cx0 + (r.cx1 - r.cx0) * i / g, y = r.cy0 + (r.cy1 - r.cy0) * j / g;
      const q = kind === 'fwd' ? S.fwd(x, y) : [x, y];
      P.push([...toB(q[0], q[1]), ...uv(x, y)]);
    }
    m = new Float32Array(g * g * 6 * 4);
    let o = 0;
    for (let j = 0; j < g; j++) for (let i = 0; i < g; i++) {
      const a = j * (g + 1) + i, b = a + 1, c = a + g + 1, d = c + 1;
      for (const k of [a, b, c, b, d, c]) { m.set(P[k], o); o += 4; }
    }
    meshCache.set(key, m);
    return m;
  }
  const map = kind === 'pre' ? (x, y) => affApply(S.pre.m, x, y) : kind === 'board' ? toB : (x, y) => [x, y];
  const c = [[r.cx0, r.cy0], [r.cx1, r.cy0], [r.cx0, r.cy1], [r.cx1, r.cy1]].map(([x, y]) => [...map(x, y), ...uv(x, y)]);
  return new Float32Array([...c[0], ...c[1], ...c[2], ...c[1], ...c[3], ...c[2]]);
}
