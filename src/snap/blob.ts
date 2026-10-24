import { solveLin } from '../core/linalg';

// Runde Fläche (Via/Lötauge), die sich farblich rundum vom Umfeld abhebt. C: RGB interleaved Uint8.
// Integralbilder je Farbkanal; score = kleinster Farbabstand Fläche ↔ einem der vier Randstreifen
export function blobScorer(C, W, H) {
  const W1 = W + 1, N1 = W1 * (H + 1), I = [new Float64Array(N1), new Float64Array(N1), new Float64Array(N1)];
  for (let ch = 0; ch < 3; ch++) {
    const J = I[ch];
    for (let y = 0; y < H; y++) {
      let s = 0; const o = (y + 1) * W1, p = y * W1, q = y * W * 3 + ch;
      for (let x = 0; x < W; x++) { s += C[q + 3 * x]; J[o + x + 1] = J[p + x + 1] + s; }
    }
  }
  const mean = (x0, y0, x1, y1, out) => {
    const n = (x1 - x0) * (y1 - y0);
    for (let ch = 0; ch < 3; ch++) { const J = I[ch]; out[ch] = (J[y1 * W1 + x1] - J[y0 * W1 + x1] - J[y1 * W1 + x0] + J[y0 * W1 + x0]) / n; }
    return out;
  };
  const d = [0, 0, 0], t = [0, 0, 0], bo = [0, 0, 0], l = [0, 0, 0], r = [0, 0, 0];
  const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  const score = (x, y, a, b, c) => {
    mean(x - a, y - a, x + a + 1, y + a + 1, d);
    mean(x - c, y - c, x + c + 1, y - b, t); mean(x - c, y + b + 1, x + c + 1, y + c + 1, bo);
    mean(x - c, y - b, x - b, y + b + 1, l); mean(x + b + 1, y - b, x + c + 1, y + b + 1, r);
    return Math.min(dist(d, t), dist(d, bo), dist(d, l), dist(d, r));
  };
  return { mean, score };
}
export function blobBoxes(rho) { const a = Math.max(1, Math.round(0.65 * rho)), b = Math.max(a + 1, Math.round(1.25 * rho)); return [a, b, Math.max(b + 2, Math.round(1.9 * rho))]; }
// Runder Rand (Via-Pad) bei (px,py): Ringkontrast-Suche über Mittelpunkte/Radien, Pad vor Loch/Glanzpunkt, dann Randpunkte + Kreisfit.
// Ringkontrast: Farbachse innen→außen aus dem mittleren Profil, je Strahl projiziert; Mittel × Anteil der Strahlen mit klarem Rand.
export const ENC_MIN = 16, RING_NA = 32, RING_D = 2, RING_TMAX = 50;
export function ringScorer(C, W, H, tmax) {
  const NA = RING_NA, D = RING_D, T = tmax + D + 1, OFF = new Int32Array(NA * T);
  for (let k = 0; k < NA; k++) { const c = Math.cos(2 * Math.PI * k / NA), s = Math.sin(2 * Math.PI * k / NA);
    for (let t = 0; t < T; t++) OFF[k * T + t] = (Math.round(t * s) * W + Math.round(t * c)) * 3; }
  const Q = new Float32Array(NA * T * 3), M = new Float32Array(T * 3);
  // füllt S[t] (t0..t1) mit dem Randwert des Kreises (x,y,t); 0 außerhalb des Bildes
  return (x, y, t0, t1, S) => {
    S.fill(0);
    const te = Math.min(t1 + D, T - 1);
    if (x < te || y < te || x >= W - te || y >= H - te) return false;
    const base = (y * W + x) * 3;
    M.fill(0);
    for (let k = 0; k < NA; k++) for (let t = Math.max(0, t0 - D); t <= te; t++) {
      const i = base + OFF[k * T + t], o = (k * T + t) * 3;
      Q[o] = C[i]; Q[o + 1] = C[i + 1]; Q[o + 2] = C[i + 2]; M[t * 3] += C[i]; M[t * 3 + 1] += C[i + 1]; M[t * 3 + 2] += C[i + 2];
    }
    for (let t = Math.max(D + 1, t0); t <= t1; t++) {
      const a = (t - D) * 3, b = (t + D) * 3, ax = (M[a] - M[b]) / NA, ay = (M[a + 1] - M[b + 1]) / NA, az = (M[a + 2] - M[b + 2]) / NA, n = Math.hypot(ax, ay, az);
      if (n < 4) continue;
      const ux = ax / n, uy = ay / n, uz = az / n, hi = 1.5 * n, lo = 0.4 * n;
      let s = 0, c = 0;
      for (let k = 0; k < NA; k++) {
        const p = (k * T + t - D) * 3, q = (k * T + t + D) * 3;
        const g = (Q[p] - Q[q]) * ux + (Q[p + 1] - Q[q + 1]) * uy + (Q[p + 2] - Q[q + 2]) * uz;
        if (g > 0) s += g < hi ? g : hi;
        if (g > lo) c++;
      }
      S[t] = s / NA * (c / NA);
    }
    return true;
  };
}
export function detectBlob(C, W, H, px, py, R, ta = 3, tb = RING_TMAX) {
  const tmax = Math.min(RING_TMAX, Math.floor((Math.min(W, H) - 1) / 2) - RING_D - 2);
  if (tmax < 6) return null;
  const sc = ringScorer(C, W, H, tmax), S = new Float32Array(tmax + 1);
  // beste (x,y,t) je Radius auf Gitter um (cx,cy) im Umkreis L, Radien t0..t1; keep(x,y,t): 0 nein, 1 ja, 2 ja und bevorzugt (→ bt.pref)
  const search = (cx, cy, L, st, t0, t1, keep?) => {
    const bt: any = [], pref = [];
    const xa = Math.round(cx - L), ya = Math.round(cy - L);
    for (let y = ya; y <= cy + L; y += st) for (let x = xa; x <= cx + L; x += st) {
      if ((x - cx) ** 2 + (y - cy) ** 2 > L * L + 1 || !sc(x, y, t0, t1, S)) continue;
      for (let t = t0; t <= t1; t++) {
        const s = S[t];
        if (!(s > 0) || (bt[t] && s <= bt[t].s && (!pref[t] || s <= pref[t].s))) continue;
        const k = keep ? keep(x, y, t) : 1;
        if (!k) continue;
        if (!bt[t] || s > bt[t].s) bt[t] = { x, y, t, s };
        if (k === 2 && (!pref[t] || s > pref[t].s)) pref[t] = bt[t].x === x && bt[t].y === y ? bt[t] : { x, y, t, s };
      }
    }
    bt.pref = pref;
    return bt;
  };
  const top = bt => bt.reduce((a, b) => b && (!a || b.s > a.s) ? b : a, null);
  const fine = (b, lo = 3, L = 2.5) => { const f = top(search(b.x, b.y, L, 1, Math.max(lo, b.t - 3), Math.min(tmax, b.t + 3))); return f && f.s >= b.s ? f : b; };
  const st = Math.max(3, Math.round(R / 7));
  // Kreise, in denen der Klickpunkt liegt, haben Vorrang; sonst Mitte bis R/2 vom Klick
  const bt0 = search(px, py, Math.max(R, 12), st, Math.max(3, Math.round(ta)), Math.min(tmax, Math.round(tb)), (x, y, t) => { const d = Math.hypot(x - px, y - py); return d <= t + 2 ? 2 : d <= 0.5 * R ? 1 : 0; });
  let best = top(bt0.pref);
  if (!best || best.s < ENC_MIN) best = top(bt0);
  if (!best) return null;
  best = fine(best, 3, Math.max(2.5, 0.6 * st));
  // Loch/Glanzpunkt in einem größeren runden Pad: der umschließende Rand gewinnt, wenn er kräftig genug ist
  for (let it = 0; it < 4; it++) {
    const t0 = Math.ceil(best.t + Math.max(3, 0.5 * best.t)), t1 = tmax;
    if (t0 > t1) break;
    // kräftigster umschließender Rand (lokales Maximum über t), Mitte so nah, dass er den bisherigen Kreis umschließt
    const b0 = best, bt = search(b0.x, b0.y, Math.min(24, 0.5 * t1), 4, t0, t1, (x, y, t) => Math.hypot(x - b0.x, y - b0.y) <= t - 0.8 * b0.t);
    let enc = null;
    for (let t = t0; t <= t1; t++) { const e = bt[t]; if (e && e.s >= Math.max(0.3 * Math.min(b0.s, 60), ENC_MIN) && !(bt[t + 1] && bt[t + 1].s > e.s) && !(bt[t - 1] && bt[t - 1].s > e.s) && (!enc || e.s > enc.s)) enc = e; }
    if (!enc) break;
    best = fine(enc, t0);
  }
  if (best.s < 12) return null;
  const fit = edgeCircle(C, W, H, best.x, best.y, best.t);
  return fit ? { x: fit.x, y: fit.y, r: fit.r, score: best.s } : { x: best.x, y: best.y, r: best.t, score: best.s };
}
// Randpunkte entlang 64 Strahlen (stärkster Abfall auf der Farbachse innen→außen nahe r), robuster Kreisfit, bis 3× nachzentriert
export function edgeCircle(C, W, H, cx, cy, r0) {
  const N = 64, W3 = W * 3, rgb = [0, 0, 0];
  const samp = (x, y) => {
    const x0 = Math.floor(x), y0 = Math.floor(y);
    if (x0 < 0 || y0 < 0 || x0 >= W - 1 || y0 >= H - 1) return false;
    const fx = x - x0, fy = y - y0, i = (y0 * W + x0) * 3, a = (1 - fx) * (1 - fy), b = fx * (1 - fy), c = (1 - fx) * fy, d = fx * fy;
    for (let ch = 0; ch < 3; ch++) rgb[ch] = C[i + ch] * a + C[i + 3 + ch] * b + C[i + W3 + ch] * c + C[i + W3 + 3 + ch] * d;
    return true;
  };
  const cs = new Float32Array(N), sn = new Float32Array(N);
  for (let k = 0; k < N; k++) { cs[k] = Math.cos(2 * Math.PI * k / N); sn[k] = Math.sin(2 * Math.PI * k / N); }
  const d = Math.max(3, 0.3 * r0), NS = Math.ceil(2 * (d + 1)) * 2 + 1, v = new Float32Array(NS), px = new Float64Array(N), py = new Float64Array(N), res = new Float64Array(N);
  let x = cx, y = cy, r = r0;
  for (let it = 0; it < 3; it++) {
    // Farbachse: Ring innen (0,65/0,8 r0) gegen außen (1,25/1,45 r0)
    const ai = [0, 0, 0], ao = [0, 0, 0];
    for (let k = 0; k < N; k++) for (const f of [0.65, 0.8, 1.25, 1.45]) {
      if (!samp(x + cs[k] * f * r0, y + sn[k] * f * r0)) continue;
      const a = f < 1 ? ai : ao; a[0] += rgb[0]; a[1] += rgb[1]; a[2] += rgb[2];
    }
    const ax = ai[0] - ao[0], ay = ai[1] - ao[1], az = ai[2] - ao[2], an = Math.hypot(ax, ay, az);
    if (an < 1) return null;
    const ux = ax / an, uy = ay / an, uz = az / an, ta = r0 - d - 1;
    let n = 0;
    for (let k = 0; k < N; k++) {
      let ok = true;
      for (let i = 0; i < NS; i++) {
        const t = ta + 0.5 * i;
        if (!samp(x + cs[k] * t, y + sn[k] * t)) { ok = false; break; }
        v[i] = rgb[0] * ux + rgb[1] * uy + rgb[2] * uz;
      }
      if (!ok) continue;
      // g(i) = v(t-1) - v(t+1), t = ta + 0,5 i, i = 2..NS-3
      let bi = -1, bg = 3;
      for (let i = 3; i < NS - 3; i++) { const g = v[i - 2] - v[i + 2]; if (g > bg) { bg = g; bi = i; } }
      if (bi < 0) continue;
      const g0 = v[bi - 3] - v[bi + 1], g2 = v[bi - 1] - v[bi + 3], q = g0 - 2 * bg + g2;
      const f = q < 0 ? Math.max(-0.5, Math.min(0.5, 0.5 * (g0 - g2) / q)) : 0, t = ta + 0.5 * (bi + f);
      px[n] = x + cs[k] * t - cx; py[n] = y + sn[k] * t - cy; n++;
    }
    // robuster Kreisfit: viermal Ausreißer (> 2,5 × Median-Abweichung) verwerfen
    let use = [], cc = null;
    for (let i = 0; i < n; i++) use.push([px[i], py[i]]);
    for (let j = 0; j < 4; j++) {
      if (use.length < 20) return null;
      cc = kasa(use); if (!cc) return null;
      for (let i = 0; i < use.length; i++) res[i] = Math.abs(Math.hypot(use[i][0] - cc.x, use[i][1] - cc.y) - cc.r);
      const med = Float64Array.from(res.subarray(0, use.length)).sort()[use.length >> 1], thr = Math.max(0.7, 2.5 * med);
      use = use.filter((p, i) => res[i] <= thr);
    }
    if (use.length < 20 || cc.r < 0.6 * r0 || cc.r > 1.5 * r0 || Math.hypot(cc.x, cc.y) > 0.4 * r0 + 2) return null;
    const mv = Math.hypot(cx + cc.x - x, cy + cc.y - y);
    x = cx + cc.x; y = cy + cc.y; r = cc.r;
    if (mv < 0.1) break;
  }
  return { x, y, r };
}
// Alle runden Flächen in einem Bildstück (Grobsuche, Schrittweite st); nur Bereich [ix0,ix1)×[iy0,iy1)
export function scanBlobs(C, W, H, radii, minScore, ix0, iy0, ix1, iy1, st = 2) {
  const { score } = blobScorer(C, W, H), out = [];
  const gw = Math.ceil((ix1 - ix0) / st), gh = Math.ceil((iy1 - iy0) / st), S = new Float32Array(gw * gh), Rr = new Float32Array(gw * gh);
  for (const rho of radii) {
    const [a, b, c] = blobBoxes(rho);
    for (let gy = 0; gy < gh; gy++) {
      const y = iy0 + gy * st;
      if (y < c || y > H - c - 1) continue;
      for (let gx = 0; gx < gw; gx++) {
        const x = ix0 + gx * st;
        if (x < c || x > W - c - 1) continue;
        const sc = score(x, y, a, b, c), i = gy * gw + gx;
        if (sc > S[i]) { S[i] = sc; Rr[i] = rho; }
      }
    }
  }
  for (let gy = 1; gy < gh - 1; gy++) for (let gx = 1; gx < gw - 1; gx++) {
    const i = gy * gw + gx, v = S[i];
    if (v < minScore) continue;
    let mx = true;
    for (let dy = -2; dy <= 2 && mx; dy++) for (let dx = -2; dx <= 2; dx++) {
      if (!dx && !dy) continue;
      const yy = gy + dy, xx = gx + dx;
      if (yy < 0 || xx < 0 || yy >= gh || xx >= gw) continue;
      const u = S[yy * gw + xx];
      if (u > v || (u === v && (dy < 0 || (dy === 0 && dx < 0)))) { mx = false; break; }
    }
    if (mx) out.push([ix0 + gx * st, iy0 + gy * st, Rr[i], v]);
  }
  return out;
}
// Feinlage eines bekannten Kandidaten: Farbkontrast prüfen, dann Fang wie beim Antippen (Pad vor Loch), erste Suche nur nahe rho
export function refineVia(C, W, H, cx, cy, rho) {
  const [a, b, c] = blobBoxes(rho), dm = [0, 0, 0], bg = [0, 0, 0];
  let nd = 0, nbg = 0;
  for (let y = Math.max(0, Math.round(cy - c)); y <= Math.min(H - 1, Math.round(cy + c)); y++)
    for (let x = Math.max(0, Math.round(cx - c)); x <= Math.min(W - 1, Math.round(cx + c)); x++) {
      const ax = Math.abs(x - cx), ay = Math.abs(y - cy), i = (y * W + x) * 3;
      if (ax <= a && ay <= a) { dm[0] += C[i]; dm[1] += C[i + 1]; dm[2] += C[i + 2]; nd++; }
      else if (Math.max(ax, ay) > b) { bg[0] += C[i]; bg[1] += C[i + 1]; bg[2] += C[i + 2]; nbg++; }
    }
  if (!nd || !nbg) return null;
  const ax = [dm[0] / nd - bg[0] / nbg, dm[1] / nd - bg[1] / nbg, dm[2] / nd - bg[2] / nbg], an = Math.hypot(...ax);
  if (an < 15) return null;
  const fit = detectBlob(C, W, H, cx, cy, Math.max(4, 0.4 * rho), 0.4 * rho, 1.6 * rho);
  if (!fit) return null;
  return { x: fit.x, y: fit.y, r: fit.r, hole: holeContrast(C, W, H, fit.x, fit.y, fit.r), z: viaZones(C, W, H, fit.x, fit.y, fit.r) };
}
// Farbzonen eines Vias: Mitte (< 0,3 r), Ring (0,45–0,85 r), Umfeld (1,25–1,7 r) und der kleinste
// Farbabstand Ring ↔ Umfeld über 8 Sektoren (Ring rundum geschlossen?). Ergebnis: [Mitte rgb, Ring rgb, Umfeld rgb, min]
export function viaZones(C, W, H, cx, cy, r) {
  const ring = Array.from({ length: 8 }, () => [0, 0, 0, 0]), out = Array.from({ length: 8 }, () => [0, 0, 0, 0]), mid = [0, 0, 0, 0];
  const R = Math.ceil(1.7 * r);
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
      const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) / r, i = (y * W + x) * 3;
      if (d < 0.3) { mid[0] += C[i]; mid[1] += C[i + 1]; mid[2] += C[i + 2]; mid[3]++; continue; }
      const acc = d > 0.45 && d < 0.85 ? ring : d > 1.25 && d < 1.7 ? out : null;
      if (!acc) continue;
      const k = ((Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) % 8) + 8) % 8, a = acc[k];
      a[0] += C[i]; a[1] += C[i + 1]; a[2] += C[i + 2]; a[3]++;
    }
  let mn = Infinity;
  const sum = l => l.reduce((s, a) => [s[0] + a[0], s[1] + a[1], s[2] + a[2], s[3] + a[3]], [0, 0, 0, 0]);
  for (let k = 0; k < 8; k++) {
    const a = ring[k], b = out[k];
    if (a[3] < 3 || b[3] < 3) { mn = 0; continue; }
    mn = Math.min(mn, Math.hypot(a[0] / a[3] - b[0] / b[3], a[1] / a[3] - b[1] / b[3], a[2] / a[3] - b[2] / b[3]));
  }
  const avg = a => a[3] ? [a[0] / a[3], a[1] / a[3], a[2] / a[3]] : [0, 0, 0];
  return [...avg(mid), ...avg(sum(ring)), ...avg(sum(out)), mn];
}
// Bohrung erkennbar? Hellster Ring (Median je 2-px-Ring ab 0,25 r) minus Median der Mitte; Glanzpunkt stört den Median kaum
export function holeContrast(C, W, H, cx, cy, r) {
  const ri = Math.max(3, 0.15 * r), nb = Math.ceil(r / 2), bins = Array.from({ length: nb }, () => []), inner = [];
  const R = Math.ceil(r);
  for (let y = Math.max(0, Math.floor(cy - R)); y <= Math.min(H - 1, Math.ceil(cy + R)); y++)
    for (let x = Math.max(0, Math.floor(cx - R)); x <= Math.min(W - 1, Math.ceil(cx + R)); x++) {
      const d = Math.hypot(x - cx, y - cy), i = (y * W + x) * 3, v = 0.299 * C[i] + 0.587 * C[i + 1] + 0.114 * C[i + 2];
      if (d < ri) inner.push(v);
      if (d >= 0.25 * r && d < r) bins[Math.min(nb - 1, Math.floor(d / 2))].push(v);
    }
  const med = a => a.sort((p, q) => p - q)[a.length >> 1];
  if (inner.length < 5) return 0;
  let ring = -Infinity;
  for (const bn of bins) if (bn.length >= 8) ring = Math.max(ring, med(bn));
  return ring - med(inner);
}
export function kasa(pts) {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, n = pts.length, bx = 0, by = 0, b1 = 0;
  for (const [x, y] of pts) {
    const z = -(x * x + y * y);
    sxx += x * x; sxy += x * y; syy += y * y; sx += x; sy += y; bx += x * z; by += y * z; b1 += z;
  }
  const s = solveLin([sxx, sxy, sx, sxy, syy, sy, sx, sy, n], 3, [[bx, by, b1]]);
  if (!s) return null;
  const [D, E, F] = s[0], x = -D / 2, y = -E / 2, rr = x * x + y * y - F;
  return rr > 0 ? { x, y, r: Math.sqrt(rr) } : null;
}
