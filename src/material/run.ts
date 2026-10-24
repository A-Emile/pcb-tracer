import { newWorker } from '../worker/client';
import { idbGet } from '../db/idb';
import { saveSoon } from '../db/projects';
import { layerById, layerName } from '../layers/model';
import { MAT_V } from './classify';
import { MG, mgFreeSide, mgSide } from './gpu';
import { MAT, MATG, MAT_WD, matAny, matLook, matOn } from './state';
import { gl } from '../render/gl';
import { dirty } from '../render/frame';
import { S } from '../state';
import { updateViewUI } from '../ui/sheet';
import { $ } from '../util';

export function matReset() {
  for (const k in MAT.work) MAT.work[k].terminate();
  for (const t of Object.values(MAT.out)) gl.deleteTexture(t);
  for (const g of Object.values(MATG)) mgFreeSide(g);
  MAT.meta = {}; MAT.out = {}; MAT.work = {}; MAT.prog = {}; MAT.err = {}; MAT.seen = {}; MAT.retry = {};
  for (const k in MATG) delete MATG[k];
}
export async function matReady(side, meta) {
  const p = S.proj, bmp = await createImageBitmap(meta.out, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  if (S.proj !== p) { bmp.close(); return; }
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, bmp); bmp.close();
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  if (MAT.out[side]) gl.deleteTexture(MAT.out[side]);
  if (MATG[side]) mgFreeSide(MATG[side]);
  MAT.meta[side] = meta; MAT.out[side] = t; MATG[side] = mgSide(side, meta);
  MAT.tMeta[side] = performance.now();
  updateMatUI(); dirty();
}
// Beim Öffnen: fertiges Modell aus dem Speicher (ältere MAT_V werden neu gerechnet, matModel löscht dann deren Masken-Kacheln); rechnen nur, wenn schon gewünscht (nach Import oder früher eingeschaltet)
export async function matOpen(p) {
  for (const side of Object.keys(p.sides)) {
    const m = await idbGet(S.db, 'files', `${p.id}|mat|${side}`).catch(() => null);
    if (S.proj !== p) return;
    if (m && m.v === MAT_V) await matReady(side, m);
  }
  if (S.proj === p && (p.matAuto || matAny())) matEnsure();
}
export function matEnsure() {
  const p = S.proj;
  if (!p) return;
  if (!p.matAuto) { p.matAuto = true; saveSoon(); }
  for (const side of Object.keys(p.sides)) {
    if (MAT.meta[side] || MAT.work[side] || MAT.err[side]) continue;
    const wk = MAT.work[side] = newWorker(), pid = p.id, sd = p.sides[side];
    MAT.prog[side] = 0; MAT.seen[side] = performance.now(); if (!MAT.t0) MAT.t0 = performance.now();
    const stop = () => { wk.terminate(); if (MAT.work[side] === wk) delete MAT.work[side]; };
    wk.onmessageerror = () => { stop(); MAT.err[side] = 'Nachricht unlesbar'; updateMatUI(); };
    wk.onmessage = e => {
      const m = e.data;
      MAT.seen[side] = performance.now();
      if (!S.proj || S.proj.id !== pid) { stop(); return; }
      if (m.type === 'matprog') { MAT.prog[side] = m.f; updateMatUI(); }
      else if (m.type === 'mat') { stop(); MAT.prog[side] = 1; matReady(side, m.meta); }
      else if (m.type === 'error') { stop(); MAT.err[side] = m.message; updateMatUI(); }
    };
    wk.onerror = e => { stop(); MAT.err[side] = e.message || 'Fehler'; updateMatUI(); };
    wk.postMessage({ type: 'mat', pid, side, w: sd.w, h: sd.h, L: sd.L });
  }
  updateMatUI();
}
// Wächter: meldet sich ein Worker MAT_WD ms nicht (still beendet, abgestürzt), wird er beendet und einmal neu gestartet, danach Fehler.
// Im Hintergrund eingefrorene Seiten/Worker zählen nicht: beim Zurückkehren neu anfangen zu zählen.
function matWatch() {
  for (const sd of Object.keys(MAT.work)) {
    if (performance.now() - (MAT.seen[sd] || 0) < MAT_WD) continue;
    MAT.work[sd].terminate(); delete MAT.work[sd];
    MAT.retry[sd] = (MAT.retry[sd] || 0) + 1;
    if (MAT.retry[sd] > 1) MAT.err[sd] = 'keine Antwort';
    matEnsure();
  }
}
export function setMat(k, v) {
  const m = matLook();
  if (k === 'pour' && !m.cu) return;
  m[k] = v;
  if (v) { MAT.err = {}; MAT.retry = {}; matEnsure(); } // erneutes Einschalten = neuer Versuch nach Fehler
  updateViewUI(); dirty(); saveSoon();
}
// Schalter und eine Zeile Hinweis (Fortschritt, unsichere Erkennung)
export function updateMatUI() {
  if (!S.proj) return;
  const m = matLook();
  for (const row of document.querySelectorAll<HTMLElement>('#vMat .tg')) {
    const k = row.dataset.k, on = !!m[k], dis = k === 'pour' && !m.cu, b = row.querySelector<HTMLButtonElement>('.tog');
    b.setAttribute('aria-checked', on); b.disabled = dis; row.classList.toggle('dis', dis);
  }
  const sides = Object.keys(S.proj.sides), work = sides.filter(sd => MAT.work[sd]), note = $('#mNote');
  // Fortschritt: Modell (Worker) 0…20 %, danach Masken-Kacheln auf der GPU (nur solange eine Material-Ansicht an ist)
  const fr = sd => MAT.meta[sd] ? (MATG[sd] ? 0.2 + 0.8 * MATG[sd].n / MATG[sd].done.length : 0.2) : 0.2 * (MAT.prog[sd] || 0);
  const gpuBusy = matOn() && MG.ok !== false && sides.some(sd => MATG[sd] && MATG[sd].n < MATG[sd].done.length);
  let t = '';
  if (work.length || gpuBusy) t = 'Platine wird erkannt … ' + Math.round(100 * sides.reduce((a, sd) => a + fr(sd), 0) / sides.length) + ' %';
  else if (matAny()) {
    const name = sd => layerName(layerById(sd) || { id: sd });
    const err = sides.filter(sd => MAT.err[sd]), weak = sides.filter(sd => MAT.meta[sd] && MAT.meta[sd].weak);
    const noOut = m.bg && !m.cu ? sides.filter(sd => MAT.meta[sd] && !MAT.meta[sd].outlineOk) : [];
    if (MG.ok === false) t = 'Erkennung auf diesem Gerät nicht möglich (GPU)';
    else if (err.length) t = 'Erkennung fehlgeschlagen (' + err.map(name).join(', ') + '), Schalter erneut tippen';
    else if (weak.length && (m.cu || m.silk)) t = (weak.length === sides.length ? 'Kupfer' : name(weak[0]) + ': Kupfer') + ' kaum erkennbar, Ergebnis unsicher';
    else if (noOut.length) t = 'Platinenrand nicht gefunden';
  }
  note.textContent = t; note.hidden = !t;
}

// Schalter im Sheet verdrahten
export function initMatUI() {
  for (const row of document.querySelectorAll<HTMLElement>('#vMat .tg')) row.addEventListener('click', () => { const k = row.dataset.k; setMat(k, !matLook()[k]); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') for (const sd of Object.keys(MAT.work)) MAT.seen[sd] = performance.now(); });
  setInterval(matWatch, 2000);
}
