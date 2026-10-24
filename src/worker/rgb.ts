import { TILE, tileCount, tileRect } from '../core/tiles';
import { idbGet, openDB } from '../db/idb';

export let db = null;
export const getDB = async () => db || (db = await openDB());
export const rgb = new Map(), RGBMAX = 48;

export async function rgbTile(pid, side, w, h, tx, ty, l = 0) {
  const key = `${pid}|${side}|${l}|${tx}|${ty}`;
  let g = rgb.get(key);
  if (g) { rgb.delete(key); rgb.set(key, g); return g; }
  const b = await idbGet(await getDB(), 'tiles', key);
  if (!b) return null;
  const bmp = await createImageBitmap(b);
  const c = new OffscreenCanvas(bmp.width, bmp.height), x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(bmp, 0, 0); bmp.close();
  const d = x.getImageData(0, 0, c.width, c.height).data, n = c.width * c.height, a = new Uint8Array(n * 3);
  for (let i = 0, j = 0, k = 0; i < n; i++, j += 4, k += 3) { a[k] = d[j]; a[k + 1] = d[j + 1]; a[k + 2] = d[j + 2]; }
  const r = tileRect(w, h, l, tx, ty), s = 2 ** l;
  g = { a, w: c.width, h: c.height, ox: Math.round(r.sx0 / s), oy: Math.round(r.sy0 / s) };
  rgb.set(key, g);
  if (rgb.size > RGBMAX) rgb.delete(rgb.keys().next().value);
  return g;
}
// RGB-Ausschnitt [x0,x1)×[y0,y1) in Pixeln der Stufe l
export async function rgbBlock(pid, side, w, h, l, x0, y0, x1, y1) {
  const W = x1 - x0, H = y1 - y0, C = new Uint8Array(W * H * 3);
  const [nx, ny] = tileCount(w, h, l);
  for (let ty = Math.floor(y0 / TILE); ty <= Math.min(ny - 1, Math.floor((y1 - 1) / TILE)); ty++)
    for (let tx = Math.floor(x0 / TILE); tx <= Math.min(nx - 1, Math.floor((x1 - 1) / TILE)); tx++) {
      const g = await rgbTile(pid, side, w, h, tx, ty, l);
      if (!g) continue;
      const ya = Math.max(y0, g.oy), yb = Math.min(y1, g.oy + g.h), xa = Math.max(x0, g.ox), xb = Math.min(x1, g.ox + g.w);
      for (let yy = ya; yy < yb; yy++)
        C.set(g.a.subarray(((yy - g.oy) * g.w + xa - g.ox) * 3, ((yy - g.oy) * g.w + xb - g.ox) * 3), ((yy - y0) * W + xa - x0) * 3);
    }
  return C;
}
