import { tileCount } from '../core/tiles';
import { idbPutMany } from '../db/idb';
import { MAT_V, mBlur, mFam, mKmeans2, mLab, mSS, mWidthHist } from '../material/classify';
import { getDB, rgbBlock, rgbTile } from './rgb';
import { scope } from './scope';

// Stichproben-Kacheln (Stufe 0): Lab, leicht geglättet
export async function labTiles({ pid, side, w, h, list, prog }: { pid: string, side: string, w: number, h: number, list: number[][], prog?: (n: number) => void }) {
  const out = [];
  for (const [tx, ty] of list) {
    const g = await rgbTile(pid, side, w, h, tx, ty, 0);
    if (!g) continue;
    const n = g.w * g.h, L = new Float32Array(n), A = new Float32Array(n), B = new Float32Array(n);
    mLab(g.a, n, L, A, B); mBlur(L, g.w, g.h, 0.7, L); mBlur(A, g.w, g.h, 0.7, A); mBlur(B, g.w, g.h, 0.7, B);
    out.push({ W: g.w, H: g.h, L, A, B });
    if (prog) prog(out.length);
  }
  return out;
}
// Material-Modell eines Bildes (Farben Lack/Kupfer, Bahnbreite tw, Helligkeitsausgleich off, Platinenumriss out) → files `pid|mat|side`.
// Die Masken selbst rechnet die GPU je Kachel beim Anzeigen (material/gpu.ts, gleiche Schritte wie das frühere mClassify).
export async function matModel({ pid, side, w, h, L: LT }) {
  const d = await getDB(), t0 = Date.now(), tm = {}, mark = k => { tm[k] = Date.now() - t0; };
  const post = f => scope.postMessage({ type: 'matprog', side, f, t: Date.now() - t0 });
  await idbPutMany(d, 'files', [[`${pid}|mat|${side}`, null]]);
  // Masken-Kacheln älterer Versionen (MAT_V 1) entfernen, die Masken entstehen jetzt auf der GPU
  await new Promise((res, rej) => { const tx = d.transaction('tiles', 'readwrite'); tx.objectStore('tiles').delete(IDBKeyRange.bound(`${pid}|${side}|m`, `${pid}|${side}|m￿`)); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  mark('del');
  // 1) Übersicht (Stufe c, ≤ 1600 px): Lackfarbton = häufigster Farbton ohne sehr dunkle Pixel
  let c = 0;
  while (c < LT && Math.max(Math.ceil(w / 2 ** c), Math.ceil(h / 2 ** c)) > 1600) c++;
  const cw = Math.ceil(w / 2 ** c), ch = Math.ceil(h / 2 ** c), cn = cw * ch;
  const cL = new Float32Array(cn), cA = new Float32Array(cn), cB = new Float32Array(cn);
  mLab(await rgbBlock(pid, side, w, h, c, 0, 0, cw, ch), cn, cL, cA, cB);
  post(0.1); mark('lab');
  // Lackfarben sind nie warm (Holz, Haut, Kupfer, Kabel liegen bei 10…85°); Wand/Papier (sehr hell) zählen nicht.
  // Bunte Pixel wiegen nach Buntheit; reicht das nicht (schwarze oder abgeschliffene Platine), zählt jedes Pixel gleich.
  const Hh = new Float32Array(64 * 64);
  for (let pass = 0; pass < 2; pass++) {
    let tot = 0;
    for (let i = 0; i < cn; i++) {
      const l = cL[i], a = cA[i], b = cB[i];
      if (l <= 15 || l >= 82) continue;
      const C = Math.sqrt(a * a + b * b);
      if (C > 8) { const hu = Math.atan2(b, a) * 57.29578; if (hu > 10 && hu < 85) continue; }
      const wgt = pass ? 1 : C < 6 ? 0 : Math.min(C, 40) / 40;
      const ia = Math.floor((a + 64) / 2), ib = Math.floor((b + 64) / 2);
      if (wgt && ia >= 0 && ia < 64 && ib >= 0 && ib < 64) { Hh[ia * 64 + ib] += wgt; tot += wgt; }
    }
    if (tot > 0.05 * cn) break;
    Hh.fill(0);
  }
  mBlur(Hh, 64, 64, 1.5, Hh);
  let hb = 0; for (let i = 1; i < 4096; i++) if (Hh[i] > Hh[hb]) hb = i;
  const a0 = -64 + 2 * (Math.floor(hb / 64) + 0.5), b0 = -64 + 2 * (hb % 64 + 0.5), C0 = Math.hypot(a0, b0), nr = Math.max(14, 0.8 * C0 + 6);
  const nearC = new Uint8Array(cn);
  // nur Lackfarbton in Lack-Helligkeit (sonst zählt bei unbuntem Lack weißes Papier mit und verfälscht den Helligkeitsausgleich)
  for (let i = 0; i < cn; i++) nearC[i] = Math.hypot(cA[i] - a0, cB[i] - b0) < nr && cL[i] > 12 && cL[i] < 75 ? 1 : 0;
  mark('hist');
  // 2) Stichproben in voller Auflösung (Kacheln mit viel Lackfarbe): 2 Häufungen Lack / Kupfer unter Lack, Bahnbreite
  const [nx0, ny0] = tileCount(w, h, 0), f0 = 512 / 2 ** c, cand = [];
  for (let ty = 0; ty < ny0; ty++) for (let tx = 0; tx < nx0; tx++) {
    let s = 0, k = 0;
    for (let y = Math.floor(ty * f0); y < Math.min(ch, Math.floor((ty + 1) * f0)); y++) for (let x = Math.floor(tx * f0); x < Math.min(cw, Math.floor((tx + 1) * f0)); x++) { const i = y * cw + x; k++; if (nearC[i] && cL[i] > 12 && cL[i] < 70) s++; }
    if (k) cand.push([s / k, tx, ty]);
  }
  cand.sort((p, q) => q[0] - p[0]);
  const pick = cand.filter((q, i) => i < 6 || q[0] > 0.5).slice(0, 12);
  // die zweite Hälfte rechnet ein Hilfs-Worker (gleicher Code) parallel; geht das nicht, alles hier
  const k2 = pick.length >= 4 ? Math.ceil(pick.length / 2) : pick.length, list = pick.map(([, tx, ty]) => [tx, ty]);
  let help = null;
  if (k2 < pick.length) try {
    const hw = new Worker(self.location.href, { type: 'module' }); // derselbe Modul-Worker (analysis.worker.ts) als Helfer
    help = new Promise((res, rej) => {
      hw.onmessage = e => { if (e.data.type === 'labtiles') { hw.terminate(); res(e.data.tiles); } else if (e.data.type === 'error') { hw.terminate(); rej(new Error(e.data.message)); } };
      hw.onerror = e => { hw.terminate(); rej(new Error(e.message || 'Hilfs-Worker')); };
      setTimeout(() => { hw.terminate(); rej(new Error('Hilfs-Worker antwortet nicht')); }, 15000);
    });
    hw.postMessage({ type: 'labtiles', pid, side, w, h, list: list.slice(k2) });
  } catch { help = null; }
  const tiles = await labTiles({ pid, side, w, h, list: help ? list.slice(0, k2) : list, prog: n => post(0.1 + 0.4 * n / pick.length) });
  if (help) tiles.push(...await help.catch(() => labTiles({ pid, side, w, h, list: list.slice(k2) })));
  mark('tiles');
  let nS = 0, nBare = 0, nAll = 0, Lsum = 0;
  const X = new Float32Array(3 * tiles.reduce((s, T) => s + Math.ceil(T.W / 2) * Math.ceil(T.H / 2), 1)), nr2 = nr * nr;
  for (const T of tiles) for (let y = 0; y < T.H; y += 2) for (let x = 0; x < T.W; x += 2) {
    const i = y * T.W + x, l = T.L[i], a = T.A[i], b = T.B[i], da = a - a0, db = b - b0;
    nAll++;
    if (da * da + db * db < nr2 && l > 12 && l < 70) { X[3 * nS] = l; X[3 * nS + 1] = a; X[3 * nS + 2] = b; nS++; Lsum += l; }
    if (a > 0 && a * a + b * b > 100 && b > 0.267949 * a && b < 5.671282 * a) nBare++; // Farbton 15…80°
  }
  // k-means auf höchstens 40000 gleichmäßig ausgedünnten Stichproben (Zentren praktisch gleich, viel schneller)
  let Xk = X, nk = nS;
  if (nS > 40000) { const st = nS / 40000; nk = 40000; Xk = new Float32Array(3 * nk); for (let i = 0; i < nk; i++) { const j = 3 * Math.floor(i * st); Xk[3 * i] = X[j]; Xk[3 * i + 1] = X[j + 1]; Xk[3 * i + 2] = X[j + 2]; } }
  const km = nS > 50 ? mKmeans2(Xk, nk) : [[30, a0, b0], [45, a0, b0]];
  post(0.6); mark('km');
  const M: any = { a0, b0, C0, lack: km[0], cu: km[1], Lnear: nS ? Lsum / nS : 40, bare: nAll > 0 && nBare / nAll > 0.15 };
  const sep = Math.hypot(M.cu[0] - M.lack[0], M.cu[1] - M.lack[1], M.cu[2] - M.lack[2]);
  // Bahnbreite: Kupfer der Stichproben, Kammwerte der Abstandstransformation, häufigster Wert
  const hist = new Float32Array(160), [l0, l1, l2] = M.lack, d0 = M.cu[0] - l0, d1 = M.cu[1] - l1, d2 = M.cu[2] - l2, dd = d0 * d0 + d1 * d1 + d2 * d2 || 1, F04 = -49 * Math.log(0.4);
  for (const T of tiles) {
    const n = T.W * T.H, bin = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (M.bare) { const Cc = Math.hypot(T.A[i], T.B[i]), hu = Math.atan2(T.B[i], T.A[i]) * 57.29578; bin[i] = Cc > 10 && hu > 15 && hu < 80 && T.L[i] > M.lack[0] ? 1 : 0; }
      else { const x0 = T.L[i] - l0, x1 = T.A[i] - l1, x2 = T.B[i] - l2, t = (x0 * d0 + x1 * d1 + x2 * d2) / dd, tc = t < -0.4 ? -0.4 : t > 1.4 ? 1.4 : t, e0 = 0.5 * (x0 - tc * d0), e1 = x1 - tc * d1, e2 = x2 - tc * d2;
        bin[i] = t > 0.5 && e0 * e0 + e1 * e1 + e2 * e2 < F04 ? 1 : 0; }
    }
    mWidthHist(bin, T.W, T.H, hist);
  }
  let hm = 0;
  for (let k = 6, kmax = Math.min(158, Math.max(w, h) / 120); k < kmax; k++) { const v = hist[k - 1] + 2 * hist[k] + hist[k + 1]; if (v > hm) { hm = v; M.hk = k; } }
  // Breite = 2·Kammwert − 1; die Radien des Prototyps sind auf tw ≈ 0,53 · Bahnbreite abgestimmt (grünes Foto: 17 px → 9)
  const width = hm > 100 ? M.hk - 1 : Math.max(w, h) / 480, tw = Math.min(40, Math.max(2.5, 0.53 * width));
  M.width = width;
  const a = Math.min(LT, Math.max(0, Math.floor(Math.log2(tw / 2.8)))), twc = tw / 2 ** c;
  post(0.7); mark('width');
  // 3) Helligkeitsausgleich (grob, wie im Prototyp in 2 Durchgängen) und Platinenumriss auf Stufe c
  const e = 0.02, tmp = new Float32Array(cn), wv = new Float32Array(cn);
  for (let i = 0; i < cn; i++) { tmp[i] = cL[i] * nearC[i]; wv[i] = nearC[i]; }
  mBlur(tmp, cw, ch, 40 * twc, tmp); mBlur(wv, cw, ch, 40 * twc, wv);
  for (let i = 0; i < cn; i++) {
    const lc = cL[i] - ((tmp[i] + e * M.Lnear) / (wv[i] + e) - M.Lnear), f = mFam(M, lc, cA[i], cB[i]);
    wv[i] = f * (1 - mSS(0.2, 0.5, mFam.t)); tmp[i] = cL[i] * wv[i];
  }
  mBlur(tmp, cw, ch, 15 * twc, tmp); mBlur(wv, cw, ch, 15 * twc, wv);
  const off = new Float32Array(cn);
  for (let i = 0; i < cn; i++) off[i] = (tmp[i] + e * M.lack[0]) / (wv[i] + e) - M.lack[0];
  mark('ill');
  // Platine = alles, was vom Bildrand aus nicht über „Nicht-Platine“ erreichbar ist; davon die größte Fläche
  const bs = tmp;
  for (let i = 0; i < cn; i++) {
    const l = cL[i] - off[i];
    let v = mFam(M, l, cA[i], cB[i]);
    if (M.bare) { const Cc = Math.hypot(cA[i], cB[i]), hu = Math.atan2(cB[i], cA[i]) * 57.29578; v = Math.max(v, mSS(6, 12, Cc) * mSS(15, 30, hu) * (1 - mSS(75, 90, hu)) * (1 - mSS(75, 88, l))); } // Papier ist heller als Kupfer
    bs[i] = v;
  }
  mBlur(bs, cw, ch, 1, bs);
  // Hintergrund nur über breite Wege (Öffnung mit Radius rr): schmale Lücken zwischen Steckern/Bauteilen am Rand bleiben Platine
  const rr = 5, pas = new Uint8Array(cn), pe = new Uint8Array(cn), sq = (src, dst, er) => { // Quadrat-Erosion (er) bzw. -Dilatation (Rand = er)
    const t = new Uint8Array(cn), n = 2 * rr + 1, ob = er ? 1 : 0, cnt = new Int32Array(cw);
    for (let y = 0, o = 0; y < ch; y++, o += cw) {
      let s = ob * rr; for (let k = 0; k <= rr; k++) s += k < cw ? src[o + k] : ob;
      for (let x = 0; x < cw; x++) { t[o + x] = er ? (s === n ? 1 : 0) : (s > 0 ? 1 : 0); const xp = x + rr + 1, xm = x - rr; s += (xp < cw ? src[o + xp] : ob) - (xm >= 0 ? src[o + xm] : ob); }
    }
    for (let x = 0; x < cw; x++) { let s = ob * rr; for (let k = 0; k <= rr; k++) s += k < ch ? t[k * cw + x] : ob; cnt[x] = s; }
    for (let y = 0, o = 0; y < ch; y++, o += cw) {
      const yp = y + rr + 1, ym = y - rr;
      for (let x = 0; x < cw; x++) { const s = cnt[x]; dst[o + x] = er ? (s === n ? 1 : 0) : (s > 0 ? 1 : 0); cnt[x] = s + (yp < ch ? t[yp * cw + x] : ob) - (ym >= 0 ? t[ym * cw + x] : ob); }
    }
  };
  for (let i = 0; i < cn; i++) pas[i] = bs[i] < 0.3 ? 1 : 0;
  sq(pas, pe, true);
  const lab = new Int32Array(cn), q = new Int32Array(cn);
  let qh = 0, qt = 0;
  const seed = i => { if (!lab[i] && pe[i]) { lab[i] = -1; q[qt++] = i; } };
  for (let x = 0; x < cw; x++) { seed(x); seed((ch - 1) * cw + x); }
  for (let y = 0; y < ch; y++) { seed(y * cw); seed(y * cw + cw - 1); }
  while (qh < qt) { const i = q[qh++], x = i % cw; if (x > 0) seed(i - 1); if (x < cw - 1) seed(i + 1); if (i >= cw) seed(i - cw); if (i + cw < cn) seed(i + cw); }
  for (let i = 0; i < cn; i++) pe[i] = lab[i] === -1 ? 1 : 0;
  sq(pe, pe, false);
  for (let i = 0; i < cn; i++) lab[i] = pe[i] && pas[i] ? -1 : 0;
  let best = 0, bestN = 0, nl = 0;
  for (let s0 = 0; s0 < cn; s0++) {
    if (lab[s0]) continue;
    nl++; lab[s0] = nl; qh = qt = 0; q[qt++] = s0;
    while (qh < qt) {
      const i = q[qh++], x = i % cw;
      if (x > 0 && !lab[i - 1]) { lab[i - 1] = nl; q[qt++] = i - 1; }
      if (x < cw - 1 && !lab[i + 1]) { lab[i + 1] = nl; q[qt++] = i + 1; }
      if (i >= cw && !lab[i - cw]) { lab[i - cw] = nl; q[qt++] = i - cw; }
      if (i + cw < cn && !lab[i + cw]) { lab[i + cw] = nl; q[qt++] = i + cw; }
    }
    if (qt > bestN) { bestN = qt; best = nl; }
  }
  const boardFrac = bestN / cn, outlineOk = boardFrac > 0.04;
  for (let i = 0; i < cn; i++) wv[i] = !outlineOk || lab[i] === best ? 1 : 0;
  mBlur(wv, cw, ch, 1, wv);
  const oc = new OffscreenCanvas(cw, ch), ox = oc.getContext('2d'), oi = ox.createImageData(cw, ch);
  for (let i = 0; i < cn; i++) { const v = Math.round(255 * mSS(0.15, 0.55, wv[i])); oi.data[4 * i] = oi.data[4 * i + 1] = oi.data[4 * i + 2] = v; oi.data[4 * i + 3] = 255; }
  ox.putImageData(oi, 0, 0);
  mark('outline');
  const outBlob = await oc.convertToBlob({ type: 'image/png' });
  mark('png');
  // unbunter Lack (schwarz, weiß) deckt das Kupfer fast ganz ab: Ergebnis unsicher
  const weak = !M.bare && (sep < 5 || nS < 2000 || M.C0 < 5);
  const meta = { v: MAT_V, a, tw, c, cw, ch, out: outBlob, off, bare: M.bare, weak, outlineOk, boardFrac, sep, model: M, ms: Date.now() - t0, tm };
  await idbPutMany(d, 'files', [[`${pid}|mat|${side}`, meta]]);
  return meta;
}
