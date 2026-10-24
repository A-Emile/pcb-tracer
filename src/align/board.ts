import { solveLin } from '../core/linalg';
import { S } from '../state';

// ---------------------------------------------------------------- Platinenkoordinaten („Gerade stellen“)
// p.straight: Homografie Rohpixel der Oberseite → Platine, 3×3 zeilenweise (fehlt = Identität, wie bisher).
// Sie steht vor allem anderen: Rückseite = straight ∘ fwd, Zeichnungen werden aus ihren Ankern (Bild + Rohpixel) neu berechnet,
// Kacheln und Material-Masken bleiben Rohpixel ihres Fotos. Das Ausrichte-Fenster „Oben“ zeigt weiterhin die Rohpixel.
export const ID9 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
export const BD = { h: null as number[] | null, hi: null as number[] | null, aff: true, box: [0, 0, 1, 1] };
export const homApply = (h, x, y) => { const d = h[6] * x + h[7] * y + h[8]; return [(h[0] * x + h[1] * y + h[2]) / d, (h[3] * x + h[4] * y + h[5]) / d]; };
export function homMul(a, b) {
  const r = new Array(9).fill(0);
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) for (let k = 0; k < 3; k++) r[i * 3 + j] += a[i * 3 + k] * b[k * 3 + j];
  return r;
}
export function homInv(m) {
  const [a, b, c, d, e, f, g, h, i] = m, A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g, det = a * A + b * B + c * C;
  const r = [A, -(b * i - c * h), b * f - c * e, B, a * i - c * g, -(a * f - c * d), C, -(a * h - b * g), a * e - b * d].map(v => v / det);
  return r.map(v => v / r[8]);
}
const isId = h => !h || h.every((v, i) => Math.abs(v - ID9[i]) < 1e-12);
export const toB = (x, y) => BD.h ? homApply(BD.h, x, y) : [x, y];
export const fromB = (x, y) => BD.hi ? homApply(BD.hi, x, y) : [x, y];
// Rand des Oberseitenfotos in Platinenkoordinaten (für Einpassen und Grenzen der Hauptansicht)
export function frontOutline(h, n = 16) {
  const { w, h: H } = S.proj.sides.front, pts = [];
  const edge = (x0, y0, x1, y1) => { for (let i = 0; i < n; i++) pts.push(h ? homApply(h, x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n) : [x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  edge(0, 0, w, 0); edge(w, 0, w, H); edge(w, H, 0, H); edge(0, H, 0, 0);
  return pts;
}
export function rebuildBoard() {
  const p = S.proj, h = p.straight;
  BD.h = isId(h) ? null : h.slice(); BD.hi = BD.h ? homInv(BD.h) : null;
  BD.aff = !BD.h || (Math.abs(BD.h[6]) < 1e-15 && Math.abs(BD.h[7]) < 1e-15);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of frontOutline(BD.h)) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  BD.box = [x0, y0, x1, y1];
}

// Drehung um den Bildmittelpunkt, sodass die Linie q1→q2 (Rohpixel oben) waagrecht oder senkrecht liegt (je nachdem, was näher ist)
export function lineFix(h0, q1, q2) {
  h0 = h0 || ID9;
  const a = homApply(h0, q1[0], q1[1]), b = homApply(h0, q2[0], q2[1]), phi = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const d = Math.round(phi / (Math.PI / 2)) * (Math.PI / 2) - phi, c = Math.cos(d), s = Math.sin(d);
  const fs = S.proj.sides.front, m = homApply(h0, fs.w / 2, fs.h / 2);
  const R = [c, -s, m[0] - c * m[0] + s * m[1], s, c, m[1] - s * m[0] - c * m[1], 0, 0, 1];
  return { h: homMul(R, h0), deg: d * 180 / Math.PI };
}
// Perspektive aus 4 Punkten (exakt), h33 = 1
export function hom4(src, dst) {
  const M = new Float64Array(64), v = new Float64Array(8);
  src.forEach(([x, y], i) => {
    const [u, w] = dst[i], r = 2 * i;
    M.set([x, y, 1, 0, 0, 0, -u * x, -u * y], r * 8); v[r] = u;
    M.set([0, 0, 0, x, y, 1, -w * x, -w * y], (r + 1) * 8); v[r + 1] = w;
  });
  const s = solveLin(M, 8, [v]);
  return s ? [...s[0], 1] : null;
}
// 4 Ecken der Platine (Rohpixel oben, beliebige Reihenfolge) → Rechteck, achsparallel in der Lage, die der heutigen am nächsten ist;
// Kantenlängen gemittelt, Mittelpunkt bleibt. null, wenn die Punkte kein brauchbares Viereck bilden.
export function cornersFix(h0, raw) {
  h0 = h0 || ID9;
  const b = raw.map(q => homApply(h0, q[0], q[1]));
  const mx = b.reduce((a, p) => a + p[0], 0) / 4, my = b.reduce((a, p) => a + p[1], 0) / 4;
  const ord = [0, 1, 2, 3].sort((i, j) => Math.atan2(b[i][1] - my, b[i][0] - mx) - Math.atan2(b[j][1] - my, b[j][0] - mx));
  const B = ord.map(i => b[i]), Q = ord.map(i => raw[i]), L = k => Math.hypot(B[(k + 1) % 4][0] - B[k][0], B[(k + 1) % 4][1] - B[k][1]);
  const W = (L(0) + L(2)) / 2, H = (L(1) + L(3)) / 2;
  if (Math.min(W, H) < 20) return null;
  // konvex und annähernd rechtwinklig (Handyfoto: leicht schräg, nicht verzerrt), sonst lieber nichts tun
  for (let k = 0; k < 4; k++) {
    const p = B[k], q = B[(k + 1) % 4], r = B[(k + 2) % 4], ux = q[0] - p[0], uy = q[1] - p[1], vx = r[0] - q[0], vy = r[1] - q[1];
    const sin = (ux * vy - uy * vx) / (Math.hypot(ux, uy) * Math.hypot(vx, vy));
    if (!(sin > 0.85)) return null;   // Winkel zwischen 58° und 122°
  }
  const k0 = Math.round(Math.atan2(B[1][1] - B[0][1], B[1][0] - B[0][0]) / (Math.PI / 2));
  const d1 = [Math.round(Math.cos(k0 * Math.PI / 2)), Math.round(Math.sin(k0 * Math.PI / 2))], d2 = [-d1[1], d1[0]];
  const R = [[0, 0], [W * d1[0], W * d1[1]], [W * d1[0] + H * d2[0], W * d1[1] + H * d2[1]], [H * d2[0], H * d2[1]]];
  const rx = R.reduce((a, p) => a + p[0], 0) / 4, ry = R.reduce((a, p) => a + p[1], 0) / 4;
  const h = hom4(Q, R.map(([x, y]) => [x - rx + mx, y - ry + my]));
  if (!h) return null;
  // Nenner im ganzen Foto positiv (keine Fluchtlinie im Bild), Maßstab an den Bildecken vernünftig
  const fs = S.proj.sides.front;
  for (const [x, y] of [[0, 0], [fs.w, 0], [0, fs.h], [fs.w, fs.h]]) {
    const d = h[6] * x + h[7] * y + h[8];
    if (!(d > 0.2 && d < 5)) return null;
  }
  return h;
}
