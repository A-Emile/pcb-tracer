import type { Obj, Project, Pt } from '../types';
import { pushPatches } from './edit';
import { buildMenu } from './menu';
import { anchorFrom, clone, geoCache, newId, objById, objsChanged, r1 } from './objects';
import { octx } from '../render/gl';
import { dirty } from '../render/frame';
import { S } from '../state';
import { clamp } from '../util';
import { s2w, w2s } from '../view/camera';

// ---------------------------------------------------------------- Textfelder auf der Platine (wie Text in KiCad)
// Objekt t: 'text' (gemeinsame Felder siehe objects.ts):
//   x, y: Mitte des Textkastens (Platine) + u, v (Anker im Bild img); note: der Text (mehrzeilig)
//   h: Schrifthöhe in Platinen-px (skaliert mit dem Zoom wie ein Aufdruck), rot: Drehung in Grad in Platinenkoordinaten
//      (0 = entlang der x-Achse der Platine, positiv im Uhrzeigersinn bei ungedrehter Ansicht)
//   lead: Hinweislinie an; lx, ly (Platine) + lu, lv (Anker): Zielpunkt der Linie (bleibt gespeichert, wenn die Linie aus ist)
// Gezeichnet im 2D-Overlay: Lage und Drehung kommen über w2s aus der Kamera, damit gilt jede Ansichtsdrehung/-spiegelung
// automatisch. Bei gespiegelter Ansicht bleibt der Text lesbar (nicht gespiegelt): gleicher Kasten, Schrift aufrecht.
export const TXT = { lineH: 1.25, padX: 0.35, padY: 0.16, newPx: 16, greek: 5, snap: 5, grab: 22, rotGap: 30, minFrame: 44 };
const FONT = 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
const ACC = '#4fb3ff';
const D2R = Math.PI / 180;

// Ansicht der Hauptkamera: Maßstab (Bildschirm-px je Platinen-px), Drehung (Grad am Bildschirm) und Spiegelung.
// Abgeleitet aus w2s, damit Ansichtsdrehung/-spiegelung (view/camera.ts) ohne weitere Absprache mitgilt; ohne beides: 0 / false.
export function viewXf(cam = S.cams.main, pane = S.panes[0]) {
  const o = w2s(cam, pane, 0, 0), a = w2s(cam, pane, 1, 0), b = w2s(cam, pane, 0, 1);
  const ex = [a[0] - o[0], a[1] - o[1]], ey = [b[0] - o[0], b[1] - o[1]];
  return { s: Math.hypot(ex[0], ex[1]), rot: Math.atan2(ex[1], ex[0]) / D2R, flip: ex[0] * ey[1] - ex[1] * ey[0] < 0 };
}
// Richtung der Bildschirm-Waagerechten in Platinenkoordinaten (Grad): neue Texte stehen damit gerade am Bildschirm
export function txUprightRot(cam = S.cams.main, pane = S.panes[0]) {
  const c = [pane.x + pane.w / 2, pane.y + pane.h / 2], a = s2w(cam, pane, c[0], c[1]), b = s2w(cam, pane, c[0] + 100, c[1]);
  return normRot(Math.atan2(b[1] - a[1], b[0] - a[0]) / D2R);
}
export const normRot = r => { r = r % 360; if (r < 0) r += 360; return Math.round(r * 10) / 10 % 360; };

// ---- Maße: Zeilenbreiten einmal je Text bei 100 px Schrift, danach linear
const meas = new WeakMap<object, { s: string; lines: string[]; w: number[]; wmax: number }>();
export function txMeasure(o) {
  const s = o.note || '';
  let m = meas.get(o);
  if (m && m.s === s) return m;
  octx.save(); octx.font = '600 100px ' + FONT;
  const lines = s.split('\n'), w = lines.map(l => octx.measureText(l).width);
  octx.restore();
  m = { s, lines, w, wmax: Math.max(0, ...w) };
  meas.set(o, m);
  return m;
}
// Kastengröße in Platinen-px (leerer Text: Platz für den Cursor)
export function txSize(o): [number, number] {
  const m = txMeasure(o), h = o.h;
  return [Math.max(m.wmax / 100 * h, 0.5 * h) + 2 * TXT.padX * h, m.lines.length * TXT.lineH * h + 2 * TXT.padY * h];
}
// Ecken des Kastens (Platine) und ggf. Ziel der Linie, für objGeo (Hüllrechteck, Treffervorprüfung, Sichtbarkeit)
export function txBoardPts(o): Pt[] {
  const [W, H] = txSize(o), r = o.rot * D2R, c = Math.cos(r), s = Math.sin(r), out: Pt[] = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push([o.x + c * a * W / 2 - s * b * H / 2, o.y + s * a * W / 2 + c * b * H / 2]);
  if (o.lead && Number.isFinite(o.lx)) out.push([o.lx, o.ly]);
  return out;
}

// ---- Rahmen am Bildschirm: Mitte C, Schriftrichtung (ux, uy), Zeilenrichtung (−uy, ux), Größe in px
// Gespiegelte Ansicht: von den beiden Lesrichtungen des Kastens die aufrechtere (beim Drehen festgehalten, sonst springt der Griff).
let upLock = null;
export function txFrame(o, cam = S.cams.main, pane = S.panes[0], flip?: boolean) {
  const C = w2s(cam, pane, o.x, o.y), r = o.rot * D2R, d = w2s(cam, pane, o.x + Math.cos(r), o.y + Math.sin(r));
  let ux = d[0] - C[0], uy = d[1] - C[1];
  const k = Math.hypot(ux, uy) || 1e-9;
  ux /= k; uy /= k;
  let sg = 1;
  if (flip ?? viewXf(cam, pane).flip) {
    sg = upLock && upLock.id === o.id ? upLock.sg : ux < -1e-6 || (Math.abs(ux) <= 1e-6 && uy > 0) ? -1 : 1;
    ux *= sg; uy *= sg;
  }
  const [W, H] = txSize(o);
  return { C, ux, uy, k, sg, w: W * k, h: H * k, px: o.h * k };
}
type Frame = ReturnType<typeof txFrame>;
const toScr = (F: Frame, a, b): Pt => [F.C[0] + F.ux * a - F.uy * b, F.C[1] + F.uy * a + F.ux * b];
const toLoc = (F: Frame, x, y): Pt => { const dx = x - F.C[0], dy = y - F.C[1]; return [dx * F.ux + dy * F.uy, -dx * F.uy + dy * F.ux]; };
// Griff-Rahmen: mindestens TXT.minFrame groß, damit Griffe auch an kleinem Text greifbar bleiben
const selHalf = (F: Frame) => [Math.max(F.w / 2 + 5, TXT.minFrame / 2), Math.max(F.h / 2 + 5, TXT.minFrame / 2)];
// Ziel der Linie und Ansatz am Kasten (nächster Randpunkt; null = Ziel liegt im Kasten)
export function txLead(o, F: Frame, cam = S.cams.main, pane = S.panes[0]): [Pt, Pt | null] | null {
  if (!o.lead || !Number.isFinite(o.lx)) return null;
  const T = w2s(cam, pane, o.lx, o.ly), [a, b] = toLoc(F, T[0], T[1]);
  const ca = clamp(a, -F.w / 2, F.w / 2), cb = clamp(b, -F.h / 2, F.h / 2);
  return [T, ca === a && cb === b ? null : toScr(F, ca, cb)];
}
// Bildschirmpunkte, die das Objekt samt Griffen belegt (Menü-Platz, Sichtbar-Halten beim Tippen)
export function txScreenPts(o, cam = S.cams.main, pane = S.panes[0]): Pt[] {
  const F = txFrame(o, cam, pane), [hw, hh] = selHalf(F), out: Pt[] = [];
  for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) out.push(toScr(F, a * hw, b * hh));
  out.push(toScr(F, 0, -hh - TXT.rotGap - 8));
  const L = txLead(o, F, cam, pane);
  if (L) out.push(L[0]);
  return out;
}

// ---- Treffertest (Bildschirm): Abstand zum Kasten bzw. zur Linie, 0 = innen
export function txDist(o, x, y, distSeg) {
  const F = txFrame(o), [a, b] = toLoc(F, x, y);
  let d = Math.hypot(Math.max(0, Math.abs(a) - F.w / 2 - 4), Math.max(0, Math.abs(b) - F.h / 2 - 4));
  const L = txLead(o, F);
  if (L) { const E = L[1] || F.C; d = Math.min(d, distSeg(x, y, L[0][0], L[0][1], E[0], E[1]), Math.max(0, Math.hypot(x - L[0][0], y - L[0][1]) - 6)); }
  return d;
}
// Griff unter dem Finger am ausgewählten Text: 'rot' | 'lead' | 'scale' | 'move' | null
export function txHandleAt(o, x, y, slop = TXT.grab) {
  const F = txFrame(o), [hw, hh] = selHalf(F), [a, b] = toLoc(F, x, y);
  const cand: [string, number][] = [['rot', Math.hypot(a, b + hh + TXT.rotGap)]];
  for (const [sa, sb] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) cand.push(['scale', Math.hypot(a - sa * hw, b - sb * hh) + 2]);
  const L = txLead(o, F);
  if (L) cand.push(['lead', Math.hypot(x - L[0][0], y - L[0][1]) - 1]);
  cand.sort((p, q) => p[1] - q[1]);
  if (cand[0][1] <= slop) return cand[0][0];
  if (Math.abs(a) <= hw + 4 && Math.abs(b) <= hh + 4) return 'move';
  return null;
}
// Punkt nahe am Text (für 2-Finger-Gesten auf dem ausgewählten Text)
export function txNear(o, x, y, m) { const F = txFrame(o), [hw, hh] = selHalf(F), [a, b] = toLoc(F, x, y); return Math.abs(a) <= hw + m && Math.abs(b) <= hh + m; }

// ---- Zeichnen
export function drawText(o, F: Frame, wt: number, lead: [Pt, Pt | null] | null) {
  if (F.w < 3 && !lead) return;
  octx.save();
  octx.globalAlpha = wt;
  if (lead) {
    const [T, E] = lead;
    octx.lineCap = 'round';
    if (E) {
      octx.beginPath(); octx.moveTo(E[0], E[1]); octx.lineTo(T[0], T[1]);
      octx.lineWidth = 3.5; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.stroke();
      octx.lineWidth = 1.5; octx.strokeStyle = o.color; octx.stroke();
    }
    octx.beginPath(); octx.arc(T[0], T[1], 3, 0, 7);
    octx.fillStyle = o.color; octx.fill(); octx.lineWidth = 1.2; octx.strokeStyle = 'rgba(0,0,0,.75)'; octx.stroke();
  }
  if (F.w >= 3) {
    octx.transform(F.ux, F.uy, -F.uy, F.ux, F.C[0], F.C[1]);
    const w = F.w, h = F.h;
    octx.beginPath(); octx.roundRect(-w / 2, -h / 2, w, h, Math.min(F.px * 0.28, h / 2));
    if (F.px < TXT.greek) { octx.fillStyle = 'rgba(12,14,18,.55)'; octx.fill(); octx.globalAlpha = wt * 0.5; octx.lineWidth = 1; octx.strokeStyle = o.color; octx.stroke(); }
    else {
      octx.fillStyle = 'rgba(12,14,18,.66)'; octx.fill();
      octx.font = '600 ' + (Math.round(F.px * 4) / 4) + 'px ' + FONT; octx.textBaseline = 'middle'; octx.textAlign = 'left'; octx.fillStyle = o.color;
      const m = txMeasure(o), lh = TXT.lineH * F.px, x0 = -w / 2 + TXT.padX * F.px, y0 = -h / 2 + TXT.padY * F.px + lh / 2;
      for (let i = 0; i < m.lines.length; i++) if (m.lines[i]) octx.fillText(m.lines[i], x0, y0 + i * lh + F.px * 0.04);
    }
  }
  octx.restore();
}
// Auswahl: Rahmen, Eckgriffe (Größe), Drehgriff oben, Zielgriff der Linie. Beim Tippen: gestrichelter Rahmen und Cursor.
export function drawTextSel(o, F: Frame, lead: [Pt, Pt | null] | null, editing: boolean) {
  const [hw, hh] = selHalf(F);
  octx.save();
  octx.transform(F.ux, F.uy, -F.uy, F.ux, F.C[0], F.C[1]);
  octx.lineWidth = 1.5; octx.strokeStyle = ACC;
  if (editing) {
    octx.setLineDash([5, 4]); octx.strokeRect(-hw, -hh, 2 * hw, 2 * hh); octx.setLineDash([]);
    const m = txMeasure(o), n = m.lines.length - 1, px = Math.max(F.px, 2), lh = TXT.lineH * px;
    const cx = -F.w / 2 + TXT.padX * px + m.w[n] / 100 * px + 1, cy = -F.h / 2 + TXT.padY * px + lh / 2 + n * lh;
    octx.fillStyle = '#fff'; octx.fillRect(cx, cy - px * 0.55, Math.max(1.5, px * 0.08), px * 1.1);
  } else {
    octx.strokeRect(-hw, -hh, 2 * hw, 2 * hh);
    const ry = -hh - TXT.rotGap;
    octx.beginPath(); octx.moveTo(0, -hh); octx.lineTo(0, ry + 7); octx.stroke();
    octx.beginPath(); octx.arc(0, ry, 7, 0, 7); octx.fillStyle = '#fff'; octx.fill(); octx.lineWidth = 2; octx.stroke();
    // Drehpfeil im Griff
    octx.beginPath(); octx.arc(0, ry, 3.2, -Math.PI * 0.9, Math.PI * 0.4); octx.lineWidth = 1.4; octx.stroke();
    octx.lineWidth = 1.5;
    for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      octx.fillStyle = '#fff'; octx.fillRect(a * hw - 5, b * hh - 5, 10, 10); octx.strokeRect(a * hw - 5, b * hh - 5, 10, 10);
    }
  }
  octx.restore();
  if (lead && !editing) {
    const T = lead[0];
    octx.beginPath(); octx.arc(T[0], T[1], 7, 0, 7); octx.fillStyle = 'rgba(255,255,255,.9)'; octx.fill();
    octx.lineWidth = 2; octx.strokeStyle = ACC; octx.stroke();
    octx.beginPath(); octx.arc(T[0], T[1], 2.5, 0, 7); octx.fillStyle = o.color; octx.fill();
  }
}

// ---- Gesten am ausgewählten Text. Während der Geste wird das Objekt direkt verändert; ein Rückgängig-Schritt am Ende.
export let txBusy = false;
const snapRot = r => { const q = Math.round(r / 45) * 45, d = r - q; return normRot(Math.abs(d) <= TXT.snap ? q : r); };
const hLimits = k => [6 / k, 400 / k];   // Schrift am Bildschirm 6…400 px beim Ziehen
const keep = o => ({ x: o.x, y: o.y, h: o.h, rot: o.rot, lx: o.lx, ly: o.ly });
// Geste beginnen (g: laufende Geste aus ui/pointer); part siehe txHandleAt
export function txGestStart(g, o, part, x, y) {
  const F = txFrame(o);
  Object.assign(g, { kind: 'tx', o, part, p0: [x, y], o0: keep(o), F0: F, before: g.before || clone(o) });
  if (part === 'lead') { const L = txLead(o, F); g.loff = L ? [L[0][0] - x, L[0][1] - y] : [0, 0]; }
  upLock = { id: o.id, sg: F.sg };
}
export function txGestMove(g, x, y) {
  if (!g.moved) return;
  const o = g.o, o0 = g.o0, cam = S.cams.main, pane = S.panes[0];
  if (!txBusy) { txBusy = true; buildMenu(); }
  if (g.part === 'move') {
    const w = s2w(cam, pane, x, y), w0 = s2w(cam, pane, g.p0[0], g.p0[1]);
    o.x = o0.x + w[0] - w0[0]; o.y = o0.y + w[1] - w0[1];
  } else if (g.part === 'scale') {
    const C = g.F0.C, d0 = Math.max(8, Math.hypot(g.p0[0] - C[0], g.p0[1] - C[1])), [a, b] = hLimits(g.F0.k);
    o.h = clamp(o0.h * Math.hypot(x - C[0], y - C[1]) / d0, Math.min(a, o0.h), Math.max(b, o0.h));
  } else if (g.part === 'rot') {
    const w = s2w(cam, pane, x, y), w0 = s2w(cam, pane, g.p0[0], g.p0[1]);
    const da = Math.atan2(w[1] - o0.y, w[0] - o0.x) - Math.atan2(w0[1] - o0.y, w0[0] - o0.x);
    o.rot = snapRot(o0.rot + da / D2R);
  } else if (g.part === 'lead') {
    const w = s2w(cam, pane, x + g.loff[0], y + g.loff[1]);
    o.lx = w[0]; o.ly = w[1];
  }
  geoCache.delete(o); dirty();
}
// 2 Finger auf dem ausgewählten Text: Größe, Drehung und Lage folgen den Fingern
export function txPinchStart(pane, o, a, b, before) {
  const F = txFrame(o);
  upLock = { id: o.id, sg: F.sg };
  txBusy = true; buildMenu();
  return { kind: 'tpinch', pane, o, before: before || clone(o), o0: keep(o), F0: F, flip: viewXf().flip,
    d0: Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)), a0: Math.atan2(b.y - a.y, b.x - a.x), m0: [(a.x + b.x) / 2, (a.y + b.y) / 2], moved: true };
}
export function txPinchMove(g, a, b) {
  const o = g.o, o0 = g.o0, F0 = g.F0, cam = S.cams.main, pane = S.panes[0];
  const k = Math.max(10, Math.hypot(b.x - a.x, b.y - a.y)) / g.d0, [lo, hi] = hLimits(F0.k);
  const h = clamp(o0.h * k, Math.min(lo, o0.h), Math.max(hi, o0.h)), kk = h / o0.h;
  const da = Math.atan2(b.y - a.y, b.x - a.x) - g.a0, rot = snapRot(o0.rot + (g.flip ? -da : da) / D2R);
  const sda = (g.flip ? -1 : 1) * (rot - o0.rot) * D2R;     // tatsächlich angewandte Drehung (nach Einrasten) am Bildschirm
  const m = [(a.x + b.x) / 2, (a.y + b.y) / 2], vx = F0.C[0] - g.m0[0], vy = F0.C[1] - g.m0[1];
  const c = Math.cos(sda), s = Math.sin(sda), C = [m[0] + kk * (c * vx - s * vy), m[1] + kk * (s * vx + c * vy)];
  const w = s2w(cam, pane, C[0], C[1]);
  o.h = h; o.rot = rot; o.x = w[0]; o.y = w[1];
  geoCache.delete(o); dirty();
}
// Ende: true = es war nur ein Tipp (nichts verändert)
export function txGestEnd(g, cancel) {
  const o = g.o, was = txBusy;
  txBusy = false; upLock = null;
  if (cancel) { if (g.before && objById(o.id) === o) { Object.assign(o, clone(g.before)); geoCache.delete(o); } buildMenu(); dirty(); return false; }
  if (!g.moved) { if (was) buildMenu(); return true; }
  txCommit(o, g.before);
  return false;
}
// Werte runden, Anker neu setzen, Rückgängig-Schritt (nur wenn sich etwas geändert hat)
export function txCommit(o, before) {
  o.x = r1(o.x); o.y = r1(o.y); o.h = Math.round(o.h * 100) / 100; o.rot = normRot(o.rot);
  if (Number.isFinite(o.lx)) { o.lx = r1(o.lx); o.ly = r1(o.ly); }
  anchorFrom(o); geoCache.delete(o);
  const after = clone(o);
  if (JSON.stringify(after) !== JSON.stringify(before)) pushPatches([[o.id, before, after]]);
  objsChanged(); buildMenu();
}

// ---- Neuer Text: Mitte am Bildschirmpunkt, Schrift TXT.newPx groß, gerade am Bildschirm
export function txNew(x, y, L, img, color, lead?: Pt): Obj {
  const cam = S.cams.main, pane = S.panes[0], w = s2w(cam, pane, x, y), k = viewXf(cam, pane).s;
  const o: Obj = { id: newId(), t: 'text', L, img, color, note: '', x: r1(w[0]), y: r1(w[1]), h: Math.round(TXT.newPx / k * 100) / 100, rot: txUprightRot(cam, pane), lead: !!lead };
  if (lead) { o.lx = r1(lead[0]); o.ly = r1(lead[1]); }
  anchorFrom(o);
  return o;
}
// Linie an: ohne gespeichertes Ziel links unterhalb des Kastens (in Leserichtung)
export function txDefaultLead(o) {
  const [W, H] = txSize(o), r = o.rot * D2R, c = Math.cos(r), s = Math.sin(r), a = -W / 2 - o.h * 1.5, b = H / 2 + o.h * 1.5;
  return [r1(o.x + c * a - s * b), r1(o.y + s * a + c * b)];
}

// ---- Bis 2026-10-24: Notiz-Nadeln (t: 'pin', Spitze x/y, Text note) und Notizen an Strichen (ink.note).
// Daraus werden Textfelder: Nadelspitze bzw. Strichende = Ziel der Hinweislinie, Text rechts oberhalb davon (wie die alte
// Beschriftung). Größe: 14 px bei der zuletzt gespeicherten Zoomstufe. Nadeln behalten ihre ID. Braucht die fertige
// Ausrichtung (Anker der Rückseite) und die Hauptkamera, daher Aufruf nach rebuildAlign/layout in openProject.
export function migrateTexts(p: Project) {
  let ch = false;
  if (!p.objs || !Object.values(p.objs).some(o => o.t === 'pin' || (o.t === 'ink' && o.note))) return false;
  // Hauptansicht (im Ausrichte-Modus fehlt sie: gespeicherter Zoom, ungedreht)
  const cam = S.mode === 'main' && S.cams.main, pane = S.panes[0];
  const k = cam ? viewXf(cam, pane).s : p.view && p.view.s > 0 ? p.view.s : 0.25, h = Math.round(clamp(14 / k, 0.5, 2000) * 100) / 100;
  const rot = cam ? txUprightRot(cam, pane) : 0;
  // Bildschirm-Richtungen rechts/oben in Platinenkoordinaten (Einheitsvektoren)
  let R = [1, 0], U = [0, -1];
  if (cam) { const c0 = s2w(cam, pane, 0, 0), rx = s2w(cam, pane, 1, 0), uy = s2w(cam, pane, 0, -1); R = [(rx[0] - c0[0]) * k, (rx[1] - c0[1]) * k]; U = [(uy[0] - c0[0]) * k, (uy[1] - c0[1]) * k]; }
  const place = (o, tx, ty) => {
    const [W] = txSize(o), dr = 0.9 * h + W / 2, du = 1.6 * h;
    o.x = r1(tx + R[0] * dr + U[0] * du); o.y = r1(ty + R[1] * dr + U[1] * du);
    anchorFrom(o);
  };
  for (const o of Object.values(p.objs)) {
    if (o.t === 'pin') {
      const tx = o.x, ty = o.y;
      Object.assign(o, { t: 'text', h, rot, lead: true, lx: tx, ly: ty, lu: o.u, lv: o.v, note: o.note || '' });
      if (!o.note.trim()) o.note = 'Markierung';
      place(o, tx, ty);
      geoCache.delete(o); ch = true;
    } else if (o.t === 'ink' && o.note && Array.isArray(o.pts) && o.pts.length) {
      const e = o.pts[o.pts.length - 1];
      const t: Obj = { id: newId(), t: 'text', L: o.L, img: o.img, color: o.color, note: o.note, x: 0, y: 0, h, rot, lead: true, lx: e[0], ly: e[1] };
      place(t, e[0], e[1]);
      p.objs[t.id] = t; o.note = ''; ch = true;
    }
  }
  return ch;
}
