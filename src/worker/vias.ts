import { TILE } from '../core/tiles';
import { idbGet, idbPutMany } from '../db/idb';
import { RING_D, RING_TMAX, detectBlob, holeContrast, refineVia, scanBlobs, viaZones } from '../snap/blob';
import { getDB, rgbBlock } from './rgb';
import { scope } from './scope';

// Alle Vias einer Seite: Grobsuche auf halber Auflösung (nur runde Flächen mit Bohrung),
// Feinlage in voller Auflösung, räumlich sortiert abgearbeitet. Ergebnis wird gespeichert.
export async function findVias({ pid, side, w, h }) {
  const d = await getDB(), ck = `${pid}|vias13|${side}`, cached = await idbGet(d, 'files', ck);
  if (cached) return cached;
  const lw = Math.ceil(w / 2), lh = Math.ceil(h / 2), radii = [5, 7, 10, 14], M = 30, B = 1024;
  const coarse = [], nb = Math.ceil(lw / B) * Math.ceil(lh / B);
  let k = 0;
  for (let by = 0; by < lh; by += B) for (let bx = 0; bx < lw; bx += B) {
    const x0 = Math.max(0, bx - M), y0 = Math.max(0, by - M), x1 = Math.min(lw, bx + B + M), y1 = Math.min(lh, by + B + M);
    const W = x1 - x0, H = y1 - y0, C = await rgbBlock(pid, side, w, h, 1, x0, y0, x1, y1);
    for (const [x, y, r, sc] of scanBlobs(C, W, H, radii, 35, bx - x0, by - y0, Math.min(B, lw - bx) + bx - x0, Math.min(B, lh - by) + by - y0, 3))
      if (holeContrast(C, W, H, x, y, r) >= 6 && viaZones(C, W, H, x, y, r)[9] >= 12) coarse.push([(x + x0 + 0.5) * 2, (y + y0 + 0.5) * 2, r * 2, sc]);
    scope.postMessage({ type: 'viaprog', side, f: 0.5 * ++k / nb });
  }
  coarse.sort((p, q) => (Math.floor(p[1] / TILE) - Math.floor(q[1] / TILE)) || (p[0] - q[0]));
  const out = [];
  for (let i = 0; i < coarse.length; i++) {
    const [x, y, rho] = coarse[i], half = 12 + RING_TMAX + RING_D + 4;
    const x0 = Math.max(0, Math.floor(x - half)), y0 = Math.max(0, Math.floor(y - half)), x1 = Math.min(w, Math.ceil(x + half)), y1 = Math.min(h, Math.ceil(y + half));
    const C = await rgbBlock(pid, side, w, h, 0, x0, y0, x1, y1);
    const v = refineVia(C, x1 - x0, y1 - y0, x - x0 - 0.5, y - y0 - 0.5, rho);
    if (v && v.r >= 6 && v.hole >= 6 && v.z[9] >= 12) {
      const vx = v.x + x0 + 0.5, vy = v.y + y0 + 0.5;
      if (!out.some(o => Math.abs(o[0] - vx) < 10 && Math.abs(o[1] - vy) < 10)) out.push([vx, vy, v.r, coarse[i][3], ...v.z]);
    }
    if (i % 40 === 0) scope.postMessage({ type: 'viaprog', side, f: 0.5 + 0.5 * i / coarse.length });
  }
  const arr = Float32Array.from(out.flat());
  await idbPutMany(d, 'files', [[ck, arr]]);
  return arr;
}

export async function snapVia({ pid, side, w, h, x, y, R, z }) {
  const half = Math.ceil(Math.max(R, 12) + RING_TMAX + RING_D + 4);
  const x0 = Math.max(0, Math.floor(x - half)), y0 = Math.max(0, Math.floor(y - half));
  const x1 = Math.min(w, Math.ceil(x + half)), y1 = Math.min(h, Math.ceil(y + half));
  const W = x1 - x0, H = y1 - y0;
  if (W < 16 || H < 16) return null;
  const C = await rgbBlock(pid, side, w, h, 0, x0, y0, x1, y1);
  const hit = detectBlob(C, W, H, x - x0 - 0.5, y - y0 - 0.5, R);
  if (!hit) return null;
  const o: any = { x: hit.x + x0 + 0.5, y: hit.y + y0 + 0.5, r: hit.r, score: hit.score };
  // Bohrung/Farbzonen nur auf Wunsch (Vorbild für die Via-Suche), beim Ziehen der Lupe unnötig
  if (z) { o.hole = holeContrast(C, W, H, hit.x, hit.y, hit.r); o.z = viaZones(C, W, H, hit.x, hit.y, hit.r); }
  return o;
}
