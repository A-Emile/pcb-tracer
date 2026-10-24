export const TILE = 512, BORDER = 2;

export function levelInfo(w, h) {
  let L = 0;
  while (Math.max(Math.ceil(w / 2 ** L), Math.ceil(h / 2 ** L)) > TILE) L++;
  return L;
}
export function tileCount(w, h, l) {
  const s = 2 ** l;
  return [Math.ceil(Math.ceil(w / s) / TILE), Math.ceil(Math.ceil(h / s) / TILE)];
}
// Inhalt (c*) und Quelle inkl. Rand (s*) einer Kachel in Vollauflösungs-Pixeln, Texturgröße tw×th
export function tileRect(w, h, l, tx, ty) {
  const s = 2 ** l, lw = Math.ceil(w / s), lh = Math.ceil(h / s);
  const x0 = tx * TILE, y0 = ty * TILE, x1 = Math.min(lw, x0 + TILE), y1 = Math.min(lh, y0 + TILE);
  const ex0 = Math.max(0, x0 - BORDER), ey0 = Math.max(0, y0 - BORDER);
  const ex1 = Math.min(lw, x1 + BORDER), ey1 = Math.min(lh, y1 + BORDER);
  return { cx0: x0 * s, cy0: y0 * s, cx1: Math.min(w, x1 * s), cy1: Math.min(h, y1 * s),
           sx0: ex0 * s, sy0: ey0 * s, sx1: Math.min(w, ex1 * s), sy1: Math.min(h, ey1 * s),
           tw: ex1 - ex0, th: ey1 - ey0 };
}
