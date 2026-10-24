import { rebuildAlign } from './align';
import { BD, cornersFix, fromB, lineFix, toB } from './board';
import { loupeMove, loupeStart } from './loupe';
import { saveSoon } from '../db/projects';
import { selectObj } from '../draw/menu';
import { setDraw } from '../draw/mode';
import { octx } from '../render/gl';
import { dirty } from '../render/frame';
import { S } from '../state';
import { gest, setGest } from '../ui/pointer';
import { panelUI, sheetOpen, showSheet } from '../ui/sheet';
import { toast } from '../ui/toast';
import { $ } from '../util';
import { camAt, clampCam, s2w, w2s } from '../view/camera';
import { animOrient, orient } from '../view/orient';

// ---------------------------------------------------------------- Platine gerade stellen (Menü ⋯ → „Gerade stellen“)
// Linie: entlang einer geraden Bahn/Kante ziehen → die Platine dreht sich, bis die Linie waagrecht bzw. senkrecht liegt.
//   Danach lassen sich die Enden (mit Lupe) nachziehen; das ersetzt den letzten Schritt statt ihn zu stapeln.
// 4 Ecken: die Ecken der Platine antippen → Perspektive entzerrt auf ein Rechteck.
// Ergebnis: p.straight (align/board.ts); Rückgängig je Schritt, Zurücksetzen = wie importiert.
export const ST = { on: false, corners: null as number[][] | null, line: null as any, undo: [] as any[] };
const HANDLE = 26;
export const stActive = () => ST.on && S.mode === 'main';
const fine = () => matchMedia('(pointer:fine)').matches;

export function stEnter() {
  if (S.mode !== 'main') return;
  setDraw(false); selectObj(null);
  if (sheetOpen() && !panelUI()) showSheet(false);
  ST.on = true; ST.corners = null; ST.line = null; ST.undo = [];
  updateStUI(); dirty();
}
export function stExit() {
  if (!ST.on) return;
  ST.on = false; ST.corners = null; ST.line = null; S.loupe = null;
  if (gest && String(gest.kind).startsWith('st')) setGest(null);
  updateStUI(); dirty();
}

// neue Geradestellung übernehmen; der Rohpunkt am Bildschirmpunkt piv bleibt dort stehen. rot: Drehung in Grad (für die Animation)
function apply(h, piv, rot = 0) {
  const p = S.proj, cam = S.cams.main, pane = S.panes[0];
  const raw = fromB(...s2w(cam, pane, piv[0], piv[1]) as [number, number]);
  if (h) p.straight = h.map(v => +v.toPrecision(12)); else delete p.straight;
  rebuildAlign();
  const keep = () => { const b = toB(raw[0], raw[1]); camAt(cam, pane, b[0], b[1], piv[0], piv[1]); };
  keep();
  // Drehung sichtbar machen: Ansicht kurz um −rot mitdrehen, dann zurück (nur Darstellung)
  if (Math.abs(rot) > 0.05) { const o = orient(); animOrient(o.a - rot, o.a, o.f, keep, 260); }
  clampCam('main'); saveSoon(); updateStUI(); dirty();
}
const pushUndo = () => { ST.undo.push(S.proj.straight ? S.proj.straight.slice() : null); if (ST.undo.length > 50) ST.undo.shift(); };
function applyLine() {
  const L = ST.line, r = lineFix(L.h0, L.q1, L.q2);
  const a = toB(L.q1[0], L.q1[1]), b = toB(L.q2[0], L.q2[1]), cam = S.cams.main, pane = S.panes[0];
  const m = w2s(cam, pane, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
  // Drehung gegenüber dem jetzigen Stand (beim Nachziehen ist der letzte Schritt schon angewandt)
  const cur = BD.h || null, now = lineFix(cur, L.q1, L.q2);
  L.deg = r.deg;
  apply(r.h, m, now.deg);
}
function applyCorners() {
  const raw = ST.corners, h = cornersFix(BD.h, raw);
  ST.corners = null;
  if (!h) { toast('Diese 4 Punkte ergeben kein Rechteck', 3000); updateStUI(); dirty(); return; }
  pushUndo(); ST.line = null;
  const pane = S.panes[0];
  apply(h, [pane.x + pane.w / 2, pane.y + pane.h / 2]);
  toast('Perspektive entzerrt', 1800);
}

// ---- Gesten (aus ui/gestures.ts): ein Finger/linke Maustaste; zwei Finger zoomen/verschieben wie sonst
function handleAt(x, y) {
  const L = ST.line;
  if (!L || ST.corners) return -1;
  const cam = S.cams.main, pane = S.panes[0];
  for (const [i, q] of [[1, L.q1], [2, L.q2]] as any) {
    const b = toB(q[0], q[1]), s = w2s(cam, pane, b[0], b[1]);
    if (Math.hypot(s[0] - x, s[1] - y) < HANDLE) return i;
  }
  return -1;
}
export function stDown(pane, x, y, mouse) {
  const cam = S.cams.main;
  if (ST.corners) {
    setGest({ kind: 'stc', pane, moved: false, mouse, x0: x, y0: y });
    if (!mouse) loupeStart(pane, x, y, x, y, true, true);
    dirty(); return;
  }
  const hi = handleAt(x, y);
  if (hi > 0) {
    const L = ST.line, b = toB(...(hi === 1 ? L.q1 : L.q2) as [number, number]), s = w2s(cam, pane, b[0], b[1]);
    setGest({ kind: 'sth', pane, moved: false, hi });
    loupeStart(pane, x, y, s[0], s[1], !mouse, true);
    dirty(); return;
  }
  setGest({ kind: 'stl', pane, moved: false, a: s2w(cam, pane, x, y), b: null });
}
export function stMove(x, y) {
  const g = gest, cam = S.cams.main;
  if (g.kind === 'stc') { if (S.loupe) loupeMove(x, y); else g.x = x, g.y = y; dirty(); return; }
  if (g.kind === 'sth') {
    loupeMove(x, y);
    const L = ST.line, w = s2w(cam, g.pane, S.loupe.x, S.loupe.y), q = fromB(w[0], w[1]);
    if (g.hi === 1) L.q1 = q; else L.q2 = q;
    dirty(); return;
  }
  if (g.kind === 'stl') {
    if (!g.moved) return;
    if (!S.loupe) { const s = w2s(cam, g.pane, g.a[0], g.a[1]); loupeStart(g.pane, s[0], s[1], s[0], s[1], false, true); loupeMove(x, y); }
    else loupeMove(x, y);
    g.b = s2w(cam, g.pane, S.loupe.x, S.loupe.y);
    dirty();
  }
}
export function stEnd(g, cancel) {
  const cam = S.cams.main, L0 = S.loupe;
  S.loupe = null;
  if (cancel) { dirty(); return; }
  if (g.kind === 'stc') {
    if (g.moved && g.mouse) { dirty(); return; }
    const [x, y] = L0 ? [L0.x, L0.y] : [g.x ?? g.x0, g.y ?? g.y0];
    if (x == null) { dirty(); return; }
    const w = s2w(cam, g.pane, x, y);
    ST.corners.push(fromB(w[0], w[1]));
    if (ST.corners.length === 4) applyCorners(); else { updateStUI(); dirty(); }
    return;
  }
  if (g.kind === 'sth') { if (g.moved) applyLine(); else dirty(); return; }
  if (g.kind === 'stl') {
    if (!g.b) { dirty(); return; }
    const a = w2s(cam, g.pane, g.a[0], g.a[1]), b = w2s(cam, g.pane, g.b[0], g.b[1]);
    if (Math.hypot(b[0] - a[0], b[1] - a[1]) < 30) { dirty(); return; }
    pushUndo();
    ST.line = { q1: fromB(g.a[0], g.a[1]), q2: fromB(g.b[0], g.b[1]), h0: BD.h ? BD.h.slice() : null };
    applyLine();
  }
}
// zweiter Finger: laufende Geste abbrechen (dann zoomen/verschieben)
export function stCancel() { if (gest && String(gest.kind).startsWith('st')) { S.loupe = null; setGest(null); dirty(); } }

// ---- Anzeige: Linie mit Enden bzw. gesetzte Ecken (Overlay, Bildschirmkoordinaten)
export function drawStraight(pane, cam) {
  if (!stActive()) return;
  const g = gest, P = (b) => w2s(cam, pane, b[0], b[1]);
  octx.save();
  const seg = (a, b, live) => {
    octx.lineCap = 'round';
    octx.lineWidth = 4; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke();
    octx.lineWidth = 2; octx.strokeStyle = live ? '#ffd43b' : '#4fb3ff'; octx.beginPath(); octx.moveTo(a[0], a[1]); octx.lineTo(b[0], b[1]); octx.stroke();
    if (!pane.loupe) for (const p of [a, b]) {
      octx.lineWidth = 2; octx.fillStyle = 'rgba(0,0,0,.35)'; octx.beginPath(); octx.arc(p[0], p[1], 9, 0, 7); octx.fill(); octx.stroke();
    }
  };
  if (g && g.kind === 'stl' && g.b) seg(P(g.a), P(g.b), true);
  else if (ST.line && !ST.corners) seg(P(toB(ST.line.q1[0], ST.line.q1[1])), P(toB(ST.line.q2[0], ST.line.q2[1])), g && g.kind === 'sth');
  if (ST.corners && ST.corners.length) {
    const S2 = ST.corners.map(q => P(toB(q[0], q[1])));
    // Umriss im Umlauf (Reihenfolge des Antippens egal), Nummern bleiben die des Antippens
    const mx = S2.reduce((a, p) => a + p[0], 0) / S2.length, my = S2.reduce((a, p) => a + p[1], 0) / S2.length;
    const ring = S2.slice().sort((a, b) => Math.atan2(a[1] - my, a[0] - mx) - Math.atan2(b[1] - my, b[0] - mx));
    octx.setLineDash([6, 5]); octx.lineWidth = 1.5; octx.strokeStyle = 'rgba(255,212,59,.9)';
    octx.beginPath(); ring.forEach((s, i) => i ? octx.lineTo(s[0], s[1]) : octx.moveTo(s[0], s[1])); if (ring.length > 2) octx.closePath(); octx.stroke(); octx.setLineDash([]);
    S2.forEach((s, i) => {
      octx.lineWidth = 2.5; octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.beginPath(); octx.arc(s[0], s[1], 8, 0, 7); octx.stroke();
      octx.strokeStyle = '#ffd43b'; octx.beginPath(); octx.arc(s[0], s[1], 6.5, 0, 7); octx.stroke();
      if (!pane.loupe) { octx.font = '600 12px system-ui,sans-serif'; octx.fillStyle = '#ffd43b'; octx.textBaseline = 'middle'; octx.fillText(String(i + 1), s[0] + 11, s[1] - 10); }
    });
  }
  octx.restore();
}

// ---- Leiste
export function updateStUI() {
  if (!S.proj) return;
  const on = stActive();
  $('#barStraight').hidden = !on;
  if (S.mode === 'main') $('#barMain').hidden = on;
  if (!on) return;
  const tip = fine() ? 'anklicken' : 'antippen';
  let t;
  if (ST.corners) t = `Ecke <b>${ST.corners.length + 1}</b> von 4 der Platine ${tip}`;
  else if (ST.line) t = `Um ${Math.abs(ST.line.deg).toFixed(1).replace('.', ',')}° gedreht · Enden ziehen zum Nachjustieren`;
  else t = 'Linie entlang einer geraden Bahn oder Kante ziehen';
  $('#sStatus').innerHTML = t;
  $('#sCorners').classList.toggle('on', !!ST.corners);
  $('#sCorners').setAttribute('aria-pressed', !!ST.corners);
  $('#sUndo').disabled = !(ST.corners && ST.corners.length) && !ST.undo.length;
  $('#sReset').hidden = !BD.h;
}
export function initStraight() {
  $('#mStraight').onclick = () => { $('#sheetMenu').hidden = true; stEnter(); };
  $('#sDone').onclick = () => stExit();
  $('#sCorners').onclick = () => { ST.corners = ST.corners ? null : []; ST.line = null; updateStUI(); dirty(); };
  $('#sUndo').onclick = () => {
    if (ST.corners && ST.corners.length) { ST.corners.pop(); updateStUI(); dirty(); return; }
    if (!ST.undo.length) return;
    const h = ST.undo.pop(), pane = S.panes[0];
    ST.line = null;
    apply(h, [pane.x + pane.w / 2, pane.y + pane.h / 2]);
  };
  $('#sReset').onclick = () => {
    if (!BD.h) return;
    pushUndo(); ST.line = null; ST.corners = null;
    const pane = S.panes[0];
    apply(null, [pane.x + pane.w / 2, pane.y + pane.h / 2]);
  };
}
