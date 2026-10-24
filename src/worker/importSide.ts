import { BORDER, TILE, levelInfo, tileCount, tileRect } from '../core/tiles';
import { idbPutMany } from '../db/idb';
import { getDB } from './rgb';
import { scope } from './scope';

export async function encode(cv) {
  let b = await cv.convertToBlob({ type: 'image/webp', quality: 0.92 });
  if (b.type !== 'image/webp') b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
  return b;
}

export async function importSide({ pid, side, blob, thumb }) {
  const d = await getDB();
  const bmp = await createImageBitmap(blob);
  const w = bmp.width, h = bmp.height, L = levelInfo(w, h);
  let total = 0, done = 0;
  for (let l = 0; l <= L; l++) { const [nx, ny] = tileCount(w, h, l); total += nx * ny; }
  const cv = new OffscreenCanvas(TILE + 2 * BORDER, TILE + 2 * BORDER);
  let ctx = cv.getContext('2d');
  let batch = [];
  for (let l = L; l >= 0; l--) {
    const [nx, ny] = tileCount(w, h, l);
    for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
      const r = tileRect(w, h, l, tx, ty);
      if (cv.width !== r.tw || cv.height !== r.th) { cv.width = r.tw; cv.height = r.th; }
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(bmp, r.sx0, r.sy0, r.sx1 - r.sx0, r.sy1 - r.sy0, 0, 0, r.tw, r.th);
      batch.push([`${pid}|${side}|${l}|${tx}|${ty}`, await encode(cv)]);
      done++;
      if (batch.length >= 16) { await idbPutMany(d, 'tiles', batch); batch = []; }
      if (done % 4 === 0 || done === total) scope.postMessage({ type: 'progress', side, done, total });
    }
  }
  if (batch.length) await idbPutMany(d, 'tiles', batch);
  if (thumb) {
    const k = 256 / Math.max(w, h), tc = new OffscreenCanvas(Math.round(w * k), Math.round(h * k));
    const tctx = tc.getContext('2d'); tctx.imageSmoothingQuality = 'high';
    tctx.drawImage(bmp, 0, 0, tc.width, tc.height);
    await idbPutMany(d, 'files', [[pid + '|thumb', await tc.convertToBlob({ type: 'image/jpeg', quality: 0.8 })]]);
  }
  bmp.close();
  return { w, h, L };
}
