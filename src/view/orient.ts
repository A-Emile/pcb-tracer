import { saveSoon } from '../db/projects';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { $ } from '../util';
import { camAt, clampCam, s2w, vm } from './camera';

// ---------------------------------------------------------------- Ansicht drehen und spiegeln (nur Darstellung, pro Projekt in p.look.orient)
// Tasten wie KiCad: R = 90° gegen den Uhrzeigersinn, Umschalt+R = im Uhrzeigersinn, F = spiegeln (Ansicht von unten).
// Zwei Finger drehen frei, aber erst bei eindeutiger, anhaltender Drehabsicht (siehe pinchRot); nahe 0/90/180/270° rastet es ein,
// beim Loslassen im Umkreis von ROT_END (damit beim Schieben/Zoomen nie eine kleine Schräglage stehen bleibt).
export const ROT_START = 20, ROT_FAST = 40, ROT_HOLD = 150, ROT_SNAP = 7, ROT_END = 15;
export const orient = () => lookState().orient || { a: 0, f: false };
const norm = a => ((a % 360) + 360) % 360;
export const snapAngle = (a, tol = ROT_SNAP) => { const k = Math.round(a / 90) * 90; return Math.abs(a - k) <= tol ? norm(k) : norm(a); };
let anim = 0;

// Winkel/Spiegelung setzen; pivot = Bildschirmpunkt, der in jedem Fenster an seiner Stelle bleibt (sonst die Fenstermitte)
export function setOrient(a, f, pivot?) {
  const lk = lookState(), keep = S.panes.map(p => {
    const sx = pivot ? pivot[0] : p.x + p.w / 2, sy = pivot ? pivot[1] : p.y + p.h / 2, cam = S.cams[p.id];
    return cam ? [p, cam, s2w(cam, p, sx, sy), sx, sy] : null;
  });
  if (!norm(a) && !f) delete lk.orient; else lk.orient = { a: norm(a), f: !!f };
  for (const k of keep) if (k) { const [p, cam, w, sx, sy] = k; camAt(cam, p, w[0], w[1], sx, sy); }
  updateOrientUI(); dirty();
}
export function orientDone() {
  for (const p of S.panes) clampCam(p.id);
  updateOrientUI(); dirty(); saveSoon();
}
// sanft drehen von a0 nach a1 (kürzester Weg), Spiegelung f; after(): je Bild (z. B. Drehpunkt nachführen)
export function animOrient(a0, a1, f, after?, T = 180, pivot?) {
  cancelAnimationFrame(anim);
  let d = norm(a1 - a0); if (d > 180) d -= 360;
  const t0 = performance.now();
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / T), e = 1 - (1 - k) ** 3;
    setOrient(a0 + d * e, f, pivot); if (after) after();
    if (k < 1) anim = requestAnimationFrame(step); else { anim = 0; setOrient(a1, f, pivot); if (after) after(); orientDone(); }
  };
  step();
}
// am Bildschirm um 90° drehen (dir +1 = im Uhrzeigersinn); schief gedreht geht es zum nächsten geraden Winkel in dieser Richtung.
// Gespiegelt dreht der Winkel andersherum, damit es am Bildschirm in die gewünschte Richtung geht.
export function rotateView(dir) {
  const o = orient(), s = (o.f ? -1 : 1) * Math.sign(dir), q = o.a / 90, r = Math.round(q);
  const a1 = Math.abs(q - r) < 1e-6 ? (r + s) * 90 : (s > 0 ? Math.ceil(q) : Math.floor(q)) * 90;
  animOrient(o.a, a1, o.f);
}
export function flipView() { const o = orient(); setOrient(o.a, !o.f); orientDone(); }
export function resetView() { const o = orient(); if (!o.a && !o.f) return; setOrient(o.a, false); animOrient(o.a, 0, false); }

// Mausrad mit Umschalt: frei drehen um den Mauszeiger, Einrasten wie bei der Geste (roher Winkel wird mitgeführt)
let wheelRaw = null, wheelT = 0;
export function wheelRotate(x, y, delta) {
  const o = orient(), now = performance.now();
  if (wheelRaw == null || now - wheelT > 600) wheelRaw = o.a;
  wheelT = now;
  wheelRaw += (o.f ? 1 : -1) * Math.max(-100, Math.min(100, delta)) * 0.05;
  setOrient(snapAngle(wheelRaw, 3), o.f, [x, y]);
  clearTimeout((wheelRotate as any).t); (wheelRotate as any).t = setTimeout(orientDone, 300);
}

// Zwei-Finger-Drehen, aufgerufen aus der Pinch-Geste (ui/gestures.ts): g = laufende Geste, ang = Winkel der Fingerlinie (rad),
// mx, my = Fingermitte (Drehpunkt beim Einrasten). Drehen beginnt erst, wenn die Fingerlinie mindestens ROT_HOLD ms lang über
// ROT_START gedreht bleibt (oder sofort über ROT_FAST); kurzes Wackeln beim Schieben/Zoomen dreht also nichts. Beim Zoomen
// (Fingerabstand ändert sich stark) liegt die Schwelle höher. Ab dem Start holt die Ansicht die Schwelle sanft auf (kein Sprung).
export function pinchRotStart(g, ang, d0?) { g.angL = ang; g.rotTot = 0; g.rotOn = false; g.a0 = orient().a; g.rotT = 0; g.d0r = d0 || 0; }
export function pinchRot(g, ang, mx?, my?, dist?) {
  let d = (ang - g.angL) * 180 / Math.PI;
  d = ((d + 540) % 360) - 180;
  g.angL = ang; g.rotTot += d;
  if (mx != null) g.mid = [mx, my];
  if (!g.rotOn) {
    const zoom = g.d0r && dist ? Math.abs(Math.log(dist / g.d0r)) : 0, th = ROT_START + 15 * Math.min(1, zoom / 0.7), now = performance.now();
    if (Math.abs(g.rotTot) > th) { if (!g.rotT) g.rotT = now; } else g.rotT = 0;
    if (Math.abs(g.rotTot) > Math.max(ROT_FAST, th + 10) || (g.rotT && now - g.rotT >= ROT_HOLD)) { g.rotOn = true; g.rotBase = g.rotTot; }
    else return;
  } else g.rotBase *= 0.85;   // danach holt die Ansicht die Schwelle sanft auf: Ansicht dreht so weit wie die Finger
  const o = orient(), raw = g.a0 + (o.f ? -1 : 1) * (g.rotTot - g.rotBase), a = snapAngle(raw);
  if (a !== o.a) { const lk = lookState(); lk.orient = { a, f: o.f }; updateOrientUI(); }
}
// Loslassen: ohne Drehabsicht bleibt der Winkel exakt wie vorher; sonst im Umkreis ROT_END auf den nächsten geraden Winkel
export function pinchRotEnd(g) {
  if (!g || !g.rotOn) return;
  const o = orient(), a1 = snapAngle(o.a, ROT_END);
  if (a1 !== o.a) animOrient(o.a, a1, o.f, undefined, 140, g.mid);
  else { if (!o.a && !o.f) delete lookState().orient; orientDone(); }
}

// Kompass oben rechts (nur wenn gedreht/gespiegelt; antippen = zurück auf 0°) und Zeile im Sheet „Ansicht“
export function updateOrientUI() {
  if (!S.proj) return;
  const o = orient(), m = vm().m, c = $('#compass'), off = !o.a && !o.f;
  c.hidden = off;
  if (!off) {
    c.querySelector('svg').style.transform = `matrix(${m[0]},${m[2]},${m[1]},${m[3]},0,0)`;
    c.setAttribute('aria-label', `Ansicht zurücksetzen (${Math.round(o.a)}°${o.f ? ', gespiegelt' : ''})`);
  }
  const ang = $('#vAng');
  if (ang) ang.textContent = o.a ? ` ${Math.round(o.a)}°` : '';
  const fb = $('#vFlip');
  if (fb) { fb.classList.toggle('on', !!o.f); fb.setAttribute('aria-pressed', !!o.f); }
}
export function initOrient() {
  $('#compass').onclick = () => resetView();
  $('#vRotL').onclick = () => rotateView(-1);
  $('#vRotR').onclick = () => rotateView(1);
  $('#vFlip').onclick = () => flipView();
}
