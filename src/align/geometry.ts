import type { MapFn } from '../types';
import { solveLin } from '../core/linalg';

// ---------------------------------------------------------------- Geometrie
// Affin [a,b,c,d,e,f]: x' = a x + b y + c, y' = d x + e y + f
export const affApply = (m, x, y) => [m[0] * x + m[1] * y + m[2], m[3] * x + m[4] * y + m[5]];
export const affMul = (m, n) => [m[0] * n[0] + m[1] * n[3], m[0] * n[1] + m[1] * n[4], m[0] * n[2] + m[1] * n[5] + m[2],
                          m[3] * n[0] + m[4] * n[3], m[3] * n[1] + m[4] * n[4], m[3] * n[2] + m[4] * n[5] + m[5]];
export function affInv(m) {
  const det = m[0] * m[4] - m[1] * m[3], a = m[4] / det, b = -m[1] / det, d = -m[3] / det, e = m[0] / det;
  return [a, b, -(a * m[2] + b * m[5]), d, e, -(d * m[2] + e * m[5])];
}
// Rohkoordinaten Rückseite → Anzeige im Ausrichte-Fenster (spiegeln/drehen)
export function preMatrix(pre, w, h) {
  let m = [1, 0, 0, 0, 1, 0], W = w, H = h;
  if (pre.fx) m = affMul([-1, 0, W, 0, 1, 0], m);
  if (pre.fy) m = affMul([1, 0, 0, 0, -1, H], m);
  for (let i = 0; i < (pre.rot & 3); i++) { m = affMul([0, -1, H, 1, 0, 0], m); [W, H] = [H, W]; }
  return { m, w: W, h: H };
}
export function affFit(src, dst) {
  const n = src.length;
  let mx = 0, my = 0;
  for (const p of src) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  const M = new Float64Array(9), bx = [0, 0, 0], by = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const v = [src[i][0] - mx, src[i][1] - my, 1];
    for (let r = 0; r < 3; r++) {
      for (let c = 0; c < 3; c++) M[r * 3 + c] += v[r] * v[c];
      bx[r] += v[r] * dst[i][0]; by[r] += v[r] * dst[i][1];
    }
  }
  const s = solveLin(M, 3, [bx, by]);
  if (!s) return null;
  const [X, Y] = s;
  const det = X[0] * Y[1] - X[1] * Y[0];
  if (Math.abs(det) < 1e-6) return null;
  return [X[0], X[1], X[2] - X[0] * mx - X[1] * my, Y[0], Y[1], Y[2] - Y[0] * mx - Y[1] * my];
}
export function tpsFit(src, dst, withLoo?): MapFn {
  const n = src.length, N = n + 3, sc = 1000;
  let mx = 0, my = 0;
  for (const p of src) { mx += p[0]; my += p[1]; }
  mx /= n; my /= n;
  const P = src.map(p => [(p[0] - mx) / sc, (p[1] - my) / sc]);
  const A = new Float64Array(N * N), bx = new Float64Array(N), by = new Float64Array(N);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < n; j++) {
      const dx = P[i][0] - P[j][0], dy = P[i][1] - P[j][1], r2 = dx * dx + dy * dy;
      A[i * N + j] = r2 > 0 ? r2 * Math.log(r2) : 0;
    }
    A[i * N + i] += 1e-7;
    A[i * N + n] = A[n * N + i] = 1;
    A[i * N + n + 1] = A[(n + 1) * N + i] = P[i][0];
    A[i * N + n + 2] = A[(n + 2) * N + i] = P[i][1];
    bx[i] = dst[i][0]; by[i] = dst[i][1];
  }
  const units = [];
  if (withLoo) for (let i = 0; i < n; i++) { const e = new Float64Array(N); e[i] = 1; units.push(e); }
  const s = solveLin(A, N, [bx, by, ...units]);
  if (!s) return null;
  const [wx, wy] = s;
  // Leave-one-out-Fehler ohne Neuberechnung: e_i = w_i / (A⁻¹)_ii
  const loo = withLoo ? units.map((_, i) => Math.hypot(wx[i] / s[2 + i][i], wy[i] / s[2 + i][i])) : null;
  const f = (x, y) => {
    const u = (x - mx) / sc, v = (y - my) / sc;
    let X = wx[n] + wx[n + 1] * u + wx[n + 2] * v, Y = wy[n] + wy[n + 1] * u + wy[n + 2] * v;
    for (let i = 0; i < n; i++) {
      const dx = u - P[i][0], dy = v - P[i][1], r2 = dx * dx + dy * dy;
      if (r2 > 0) { const k = r2 * Math.log(r2); X += wx[i] * k; Y += wy[i] * k; }
    }
    return [X, Y];
  };
  f.loo = loo;
  return f;
}
// Perspektive (Handyfoto leicht schräg) per normierter DLT, h33 = 1
export function homFit(src, dst) {
  const norm = pts => {
    let mx = 0, my = 0;
    for (const p of pts) { mx += p[0]; my += p[1]; }
    mx /= pts.length; my /= pts.length;
    let d = 0;
    for (const p of pts) d += Math.hypot(p[0] - mx, p[1] - my);
    const k = Math.SQRT2 / (d / pts.length || 1);
    return { f: p => [(p[0] - mx) * k, (p[1] - my) * k], mx, my, k };
  };
  const ns = norm(src), nd = norm(dst), n = src.length;
  const M = new Float64Array(64), v = new Float64Array(8);
  const add = (row, b) => { for (let i = 0; i < 8; i++) { v[i] += row[i] * b; for (let j = 0; j < 8; j++) M[i * 8 + j] += row[i] * row[j]; } };
  for (let i = 0; i < n; i++) {
    const [x, y] = ns.f(src[i]), [u, w] = nd.f(dst[i]);
    add([x, y, 1, 0, 0, 0, -u * x, -u * y], u);
    add([0, 0, 0, x, y, 1, -w * x, -w * y], w);
  }
  const s = solveLin(M, 8, [v]);
  if (!s) return null;
  const h = s[0];
  return (X, Y) => {
    const x = (X - ns.mx) * ns.k, y = (Y - ns.my) * ns.k, d = h[6] * x + h[7] * y + 1;
    return [(h[0] * x + h[1] * y + h[2]) / d / nd.k + nd.mx, (h[3] * x + h[4] * y + h[5]) / d / nd.k + nd.my];
  };
}
// 0 Paare: base; 1: base + Verschiebung; 2: Ähnlichkeit nach base; 3: affin;
// ab 4: Perspektive + TPS auf den Restfehlern, exakt durch alle Paare
export function fitMap(src, dst, base, withLoo?): MapFn {
  const n = src.length;
  if (n === 0) return (x, y) => affApply(base, x, y);
  if (n === 1) {
    const q = affApply(base, src[0][0], src[0][1]), m = base.slice();
    m[2] += dst[0][0] - q[0]; m[5] += dst[0][1] - q[1];
    return (x, y) => affApply(m, x, y);
  }
  if (n === 2) {
    const z0 = affApply(base, src[0][0], src[0][1]), z1 = affApply(base, src[1][0], src[1][1]);
    const dzx = z1[0] - z0[0], dzy = z1[1] - z0[1], dwx = dst[1][0] - dst[0][0], dwy = dst[1][1] - dst[0][1];
    const den = dzx * dzx + dzy * dzy;
    if (den < 1e-9) return fitMap(src.slice(0, 1), dst.slice(0, 1), base);
    const a = (dwx * dzx + dwy * dzy) / den, b = (dwy * dzx - dwx * dzy) / den;
    const Sm = [a, -b, dst[0][0] - (a * z0[0] - b * z0[1]), b, a, dst[0][1] - (b * z0[0] + a * z0[1])];
    const m = affMul(Sm, base);
    return (x, y) => affApply(m, x, y);
  }
  const A = affFit(src, dst);
  if (!A) return fitMap(src.slice(0, 2), dst.slice(0, 2), base);
  if (n === 3) return (x, y) => affApply(A, x, y);
  const H = homFit(src, dst) || ((x, y) => affApply(A, x, y));
  const t = tpsFit(src, dst.map((d, i) => { const h = H(src[i][0], src[i][1]); return [d[0] - h[0], d[1] - h[1]]; }), withLoo && n >= 5);
  if (!t) return H;
  const f = (x, y) => { const h = H(x, y), r = t(x, y); return [h[0] + r[0], h[1] + r[1]]; };
  f.loo = t.loo;
  return f;
}
