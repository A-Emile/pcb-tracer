
// ---------------------------------------------------------------- Material: Kupfer, Flächen, Druck, Platinengrund (Hilfsfunktionen des Modells im Worker)
// Weiche Klassen pro Pixel (Port des Prototyps durchsicht/classify.py). Das Modell (Farben, Bahnbreite, Ausgleich, Umriss) rechnet
// der Worker einmal pro Bild (worker/matModel.ts), die Masken je Kachel die GPU (material/gpu.ts): R = Kupfer (Bahn, Pad, Via), G = Kupferfläche, B = Bestückungsdruck,
// Rest (Lack, Träger, Bauteile) = 1 − R − G − B. Außerhalb der Platine: eine grobe Maske pro Bild (Flutfüllung vom Bildrand).
// tw = Maß der Bahnbreite in Pixeln (0,53 · gemessene Breite aus Abstandstransformation, Einheit des Prototyps); gerechnet wird in Stufe a mit tw/2^a ≈ 2,8…5,6.
export const MAT_V = 2; // 2: Masken auf der GPU (material/gpu.ts, nicht mehr gespeichert), gespeichert nur Modell + off + Umriss
export function mSS(e0, e1, x) { const t = (x - e0) / (e1 - e0); return t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t); }
// sRGB (interleaved RGB) → CIE-Lab (L 0..100), wie OpenCV
export function mLab(C, n, L, A, B) {
  let g = mLab.lut;
  if (!g) { g = mLab.lut = new Float32Array(256); for (let i = 0; i < 256; i++) { const c = i / 255; g[i] = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; } }
  // Kubikwurzel über Tabelle (4096 Stufen, linear dazwischen; Fehler < 0,01 in L), etwa 3× schneller als Math.cbrt
  let F = mLab.flut;
  if (!F) { F = mLab.flut = new Float32Array(4098); for (let i = 0; i < 4098; i++) { const t = i / 4096; F[i] = t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 0.137931; } }
  const f = t => { const x = (t < 0 ? 0 : t > 1 ? 1 : t) * 4096, i = x | 0; return F[i] + (F[i + 1] - F[i]) * (x - i); };
  for (let i = 0, k = 0; i < n; i++, k += 3) {
    const r = g[C[k]], gg = g[C[k + 1]], b = g[C[k + 2]];
    const fx = f((0.412453 * r + 0.357580 * gg + 0.180423 * b) / 0.950456), fy = f(0.212671 * r + 0.715160 * gg + 0.072169 * b), fz = f((0.019334 * r + 0.119193 * gg + 0.950227 * b) / 1.088754);
    L[i] = 116 * fy - 16; A[i] = 500 * (fx - fy); B[i] = 200 * (fy - fz);
  }
}
export declare namespace mLab { let lut: Float32Array; let flut: Float32Array; }   // Zwischenspeicher sRGB → linear, Kubikwurzel (nur Typ)
// Gauß-Unschärfe, getrennt in x und y, Rand = nächster Wert. Klein: echter Kern, groß: 3 Kastenfilter. dst darf src sein.
export function mBlur(src, W, H, sig, dst?) {
  if (!dst) dst = new Float32Array(W * H);
  if (!(sig > 0.25)) { if (dst !== src) dst.set(src); return dst; }
  const M = Math.max(W, H), a = new Float32Array(M), b = new Float32Array(M), c = new Float32Array(M);
  let pass;
  if (sig < 1.2) {
    const r = Math.ceil(3 * sig), k = new Float32Array(2 * r + 1); let s = 0;
    for (let i = -r; i <= r; i++) s += k[i + r] = Math.exp(-i * i / (2 * sig * sig));
    for (let i = 0; i <= 2 * r; i++) k[i] /= s;
    pass = len => {
      for (let i = 0; i < len; i++) {
        let v = 0;
        if (i >= r && i + r < len) for (let j = 0, q = i - r; j <= 2 * r; j++, q++) v += k[j] * a[q];
        else for (let j = -r; j <= r; j++) { const q = i + j; v += k[j + r] * a[q < 0 ? 0 : q >= len ? len - 1 : q]; }
        b[i] = v;
      }
      return b;
    };
  } else {
    const wI = Math.sqrt(4 * sig * sig + 1); let wl = Math.floor(wI); if (wl % 2 === 0) wl--;
    const m = Math.round((12 * sig * sig - 3 * wl * wl - 12 * wl - 9) / (-4 * wl - 4)), sizes = [0, 1, 2].map(i => i < m ? wl : wl + 2);
    const box = (x, y, len, r) => {
      const inv = 1 / (2 * r + 1); let s = x[0] * (r + 1);
      for (let i = 1; i <= r; i++) s += x[i < len ? i : len - 1];
      for (let i = 0; i < len; i++) { y[i] = s * inv; const ip = i + r + 1, im = i - r; s += x[ip < len ? ip : len - 1] - x[im > 0 ? im : 0]; }
    };
    pass = len => { box(a, b, len, (sizes[0] - 1) >> 1); box(b, c, len, (sizes[1] - 1) >> 1); box(c, b, len, (sizes[2] - 1) >> 1); return b; };
  }
  for (let y = 0; y < H; y++) { const o = y * W; for (let i = 0; i < W; i++) a[i] = src[o + i]; const r = pass(W); for (let i = 0; i < W; i++) dst[o + i] = r[i]; }
  for (let x = 0; x < W; x++) { for (let i = 0, o = x; i < H; i++, o += W) a[i] = dst[o]; const r = pass(H); for (let i = 0, o = x; i < H; i++, o += W) dst[o] = r[i]; }
  return dst;
}
// Lackfamilie: Abstand zur Strecke „leerer Lack“ → „Kupfer unter Lack“ (Lab), t = Lage auf der Strecke
export function mFam(M, L, a, b) {
  const l = M.lack, d0 = M.cu[0] - l[0], d1 = M.cu[1] - l[1], d2 = M.cu[2] - l[2], dd = d0 * d0 + d1 * d1 + d2 * d2 || 1;
  const x0 = L - l[0], x1 = a - l[1], x2 = b - l[2], t = (x0 * d0 + x1 * d1 + x2 * d2) / dd, tc = t < -0.4 ? -0.4 : t > 1.4 ? 1.4 : t;
  const e0 = 0.5 * (x0 - tc * d0), e1 = x1 - tc * d1, e2 = x2 - tc * d2;
  mFam.t = t;
  return Math.exp(-(e0 * e0 + e1 * e1 + e2 * e2) / 49);
}
export declare namespace mFam { let t: number; }   // Lage t des letzten Aufrufs (nur Typ)
// Typische Bahnbreite: Abstandstransformation (Chamfer 3-4) des Kupfers, Häufigkeit der Kammwerte (halbe Breite) in ½-px-Schritten
export function mWidthHist(bin, W, H, hist) {
  const D = new Float32Array(W * H), INF = 1e9;
  for (let i = 0; i < W * H; i++) D[i] = bin[i] ? INF : 0;
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const i = y * W + x; if (!D[i]) continue;
    let v = D[i];
    if (x > 0) v = Math.min(v, D[i - 1] + 3); else v = Math.min(v, 3);
    if (y > 0) { v = Math.min(v, D[i - W] + 3); if (x > 0) v = Math.min(v, D[i - W - 1] + 4); if (x < W - 1) v = Math.min(v, D[i - W + 1] + 4); } else v = Math.min(v, 3);
    D[i] = v;
  }
  for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
    const i = y * W + x; if (!D[i]) continue;
    let v = D[i];
    if (x < W - 1) v = Math.min(v, D[i + 1] + 3); else v = Math.min(v, 3);
    if (y < H - 1) { v = Math.min(v, D[i + W] + 3); if (x < W - 1) v = Math.min(v, D[i + W + 1] + 4); if (x > 0) v = Math.min(v, D[i + W - 1] + 4); } else v = Math.min(v, 3);
    D[i] = v;
  }
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    const i = y * W + x, v = D[i];
    if (v < 4.5) continue;
    if (v < D[i - 1] || v < D[i + 1] || v < D[i - W] || v < D[i + W] || v < D[i - W - 1] || v < D[i - W + 1] || v < D[i + W - 1] || v < D[i + W + 1]) continue;
    const k = Math.round(v / 3 * 2);
    if (k < hist.length) hist[k] += Math.sqrt(k);
  }
}
export function mKmeans2(X, n) {
  const Ls = new Float32Array(n); let ma = 0, mb = 0;
  for (let i = 0; i < n; i++) { Ls[i] = X[3 * i]; ma += X[3 * i + 1]; mb += X[3 * i + 2]; }
  Ls.sort();
  let c = [[Ls[Math.floor(n * 0.25)], ma / n, mb / n], [Ls[Math.floor(n * 0.75)], ma / n, mb / n]];
  for (let it = 0; it < 25; it++) {
    const s = [[0, 0, 0, 0], [0, 0, 0, 0]];
    for (let i = 0; i < n; i++) {
      const L = X[3 * i], a = X[3 * i + 1], b = X[3 * i + 2];
      const d0 = (L - c[0][0]) ** 2 + (a - c[0][1]) ** 2 + (b - c[0][2]) ** 2, d1 = (L - c[1][0]) ** 2 + (a - c[1][1]) ** 2 + (b - c[1][2]) ** 2;
      const q = s[d0 <= d1 ? 0 : 1]; q[0] += L; q[1] += a; q[2] += b; q[3]++;
    }
    c = c.map((o, k) => s[k][3] ? [s[k][0] / s[k][3], s[k][1] / s[k][3], s[k][2] / s[k][3]] : o);
  }
  return c.sort((p, q) => p[0] - q[0]);
}
// Die Klassifizierung je Pixel (früher mClassify hier im Worker) läuft als Shader-Durchgänge auf der GPU: material/gpu.ts.
