import type { Project, Pt } from '../types';
import { fromB, toB } from '../align/board';
import { saveSoon } from '../db/projects';
import { activeLayer, layerMode, layers, shownLayer } from '../layers/model';
import { txBoardPts } from './text';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';

// ---------------------------------------------------------------- Objekte (gemeinsam: Zeichnungen und Notizen, später Bahnen, Vias, Netze)
// Objektspeicher im Projekt: p.objs = { [id]: obj } (flache Map). Jedes Objekt: { id, t: Typ, L: Lagen-ID, … }.
//   L: 'front' | 'back' bleiben die Außenlagen, Innenlagen später 'i…'.
//   Koordinaten: Platinenkoordinaten (Pixel des Referenzbilds 'front') plus Anker im Bild, auf dem gezeichnet wurde (img + Rohpixel):
//     text: { x, y, img, u, v, note (Text), h, rot, lead, lx, ly, lu, lv, color }   (Textfeld, Format siehe text.ts)
//     ink: { pts:[[x,y],…], img, uv:[[u,v],…], color, arrow }   (Freihand; note bleibt leer, Beschriftung ist ein eigener Text)
//   Frühere Notiz-Nadeln (pin) und Strich-Notizen werden beim Öffnen zu Textfeldern (migrateTexts in text.ts).
//   Maßgeblich ist der Anker: nach jeder Änderung der Ausrichtung (rebuildAlign) werden x,y aus dem Anker neu berechnet,
//   so wandert eine Zeichnung auf der Rückseite mit dem Foto mit, auf dem sie gemacht wurde. Referenzbild = Identität,
//   bzw. die Geradestellung p.straight (align/board.ts).
// Pro Projekt außerdem p.look.hideObjs (Gezeichnetes ausblenden, H) und p.look.pen (Stiftfarbe).
// Auswahl: S.pick (Set von IDs). Rückgängig: edit(fn) zeichnet Patches [id, vorher, nachher] auf (S.oundo; Ausrichten hat S.undo).
export const PENS = ['#ff4b4b', '#ffd43b', '#3ddc84', '#4fb3ff', '#ffffff'], PEN_NAME = ['Rot', 'Gelb', 'Grün', 'Blau', 'Weiß'];
export const HIT = 24, HOLD_MS = 380;
export const OBJ_TYPES = ['ink', 'text'];
// Bahnen (draw/trace.ts): Punkte mit Anker (node Ecke/Abzweig, via, pad) und Segmente zwischen zwei Punkten
export const TR_PT = ['node', 'via', 'pad'], TR_TYPES = ['node', 'via', 'pad', 'seg'];
export const objMap = () => S.proj.objs;
export const objList = () => Object.values(S.proj.objs);
export const objById = id => id ? S.proj.objs[id] || null : null;
export const objsShown = () => S.mode === 'main' && !lookState().hideObjs;
export const pickId = () => S.pick.size === 1 ? [...S.pick][0] : null;
export const curPen = () => lookState().pen || PENS[0];
// Bild ↔ Platinenkoordinaten. Rückwärts: Startwert aus der Gegenabbildung S.inv, dann Newton auf die Anzeige-Abbildung,
// damit ein gezeichneter Punkt genau dort bleibt, wo der Finger war (Rundreise < 0,01 px).
// (Platine = Geradestellung ∘ Rohpixel oben, siehe align/board.ts)
export function toBoard(img, u, v) { if (img === 'front') return toB(u, v); const f = S.fwd(u, v); return toB(f[0], f[1]); }
export function fromBoard(img, x, y) {
  if (img === 'front') return fromB(x, y);
  const F = (u, v) => { const f = S.fwd(u, v); return toB(f[0], f[1]); }, q = fromB(x, y);
  let r = S.inv(q[0], q[1]);
  for (let it = 0; it < 6; it++) {
    const f = F(r[0], r[1]), ex = x - f[0], ey = y - f[1];
    if (Math.hypot(ex, ey) < 0.005) break;
    const fx = F(r[0] + 1, r[1]), fy = F(r[0], r[1] + 1);
    const a = fx[0] - f[0], c = fx[1] - f[1], b = fy[0] - f[0], d = fy[1] - f[1], det = a * d - b * c;
    if (!det) break;
    r = [r[0] + (d * ex - b * ey) / det, r[1] + (a * ey - c * ex) / det];
  }
  return r;
}
export const r1 = v => Math.round(v * 10) / 10;
// x,y eines Objekts aus seinem Anker neu berechnen
export function reanchor(o) {
  if (o.t === 'pin' || o.t === 'text' || TR_PT.includes(o.t)) { const [x, y] = toBoard(o.img, o.u, o.v); o.x = r1(x); o.y = r1(y); }
  if (o.t === 'text' && Number.isFinite(o.lu)) { const [x, y] = toBoard(o.img, o.lu, o.lv); o.lx = r1(x); o.ly = r1(y); }
  else if (o.uv) o.pts = o.uv.map(([u, v]) => toBoard(o.img, u, v).map(r1));
  geoCache.delete(o);
}
export function objsReanchor() { if (S.proj && S.proj.objs) { for (const o of objList()) reanchor(o); objVer++; } }
// Anker aus Platinenkoordinaten setzen (neues Objekt, Verschieben)
export function anchorFrom(o) {
  if (o.t === 'pin' || o.t === 'text' || TR_PT.includes(o.t)) { const [u, v] = fromBoard(o.img, o.x, o.y); o.u = r1(u); o.v = r1(v); }
  if (o.t === 'text') { if (Number.isFinite(o.lx)) { const [u, v] = fromBoard(o.img, o.lx, o.ly); o.lu = r1(u); o.lv = r1(v); } }
  else if (o.t === 'ink') o.uv = o.pts.map(([x, y]) => fromBoard(o.img, x, y).map(r1));
}
// Geometrie fürs Zeichnen, je Objekt zwischengespeichert bis zur nächsten Änderung
export const geoCache = new WeakMap();
export function smoothPath(P, path = new Path2D()) {
  path.moveTo(P[0][0], P[0][1]);
  if (P.length === 1) path.lineTo(P[0][0] + 0.01, P[0][1]);
  for (let i = 1; i < P.length - 1; i++) path.quadraticCurveTo(P[i][0], P[i][1], (P[i][0] + P[i + 1][0]) / 2, (P[i][1] + P[i + 1][1]) / 2);
  if (P.length > 1) path.lineTo(P[P.length - 1][0], P[P.length - 1][1]);
  return path;
}
export function objGeo(o): { pts: Pt[]; bb: number[] } {
  if (o.t === 'seg') {   // Segment: Lage der Endpunkte (nicht zwischengespeichert, die Punkte können sich ändern)
    const a = objById(o.a), b = objById(o.b), pts: Pt[] = a && b ? [[a.x, a.y], [b.x, b.y]] : [];
    return { pts, bb: pts.length ? [Math.min(a.x, b.x), Math.min(a.y, b.y), Math.max(a.x, b.x), Math.max(a.y, b.y)] : [0, 0, 0, 0] };
  }
  let g = geoCache.get(o);
  if (g) return g;
  const pts = o.t === 'text' ? txBoardPts(o) : o.t === 'pin' || TR_PT.includes(o.t) ? [[o.x, o.y]] : o.pts || [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of pts) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  g = { pts, bb: [x0, y0, x1, y1] };
  geoCache.set(o, g);
  return g;
}
export let objVer = 0;
// alles, was die Sichtbarkeit der Objekte bestimmt (Lagen, Augen, Modus, Halten)
export const objVisKey = () => shownLayer() + '|' + activeLayer() + '|' + layerMode() + '|' + (S.hold ? 1 : 0) + '|' + layers().map(L => (L.on ? 1 : 0) + ':' + Math.round(L.op * 50)).join('') + '|' + Math.round(S.t * 50);
export function objsChanged() { objVer++; dirty(); saveSoon(); }
// nur den Stand weiterzählen (abgeleitete Daten wie Netze und Linien neu berechnen), ohne Speichern; z. B. beim Ziehen
export function objBump() { objVer++; }
export const clone = o => o == null ? null : JSON.parse(JSON.stringify(o));

export const newId = () => 'o' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);

// Objektspeicher anlegen; unbekannte Typen bleiben unangetastet (spätere Versionen), kaputte eigene Einträge fallen weg
export function migrateObjs(p: Project) {
  let ch = false;
  if (!p.objs || typeof p.objs !== 'object' || Array.isArray(p.objs)) { p.objs = {}; ch = true; }
  const fin = q => Array.isArray(q) && q.length === 2 && q.every(Number.isFinite);
  for (const [id, o] of Object.entries(p.objs)) {
    const bad = !o || o.id !== id || typeof o.L !== 'string' || (o.t === 'pin' && !(p.sides[o.img] && [o.u, o.v, o.x, o.y].every(Number.isFinite)))
      || (o.t === 'text' && !(p.sides[o.img] && [o.u, o.v, o.x, o.y, o.h, o.rot].every(Number.isFinite) && o.h > 0 && typeof o.note === 'string'))
      || (o.t === 'ink' && !(p.sides[o.img] && Array.isArray(o.uv) && o.uv.length && o.uv.every(fin) && Array.isArray(o.pts) && o.pts.length === o.uv.length));
    const pt = TR_PT.includes(o.t) && !(p.sides[o.img] && [o.u, o.v, o.x, o.y].every(Number.isFinite) && (o.t !== 'via' || o.d > 0));
    const net = o.t === 'net' && !(typeof o.name === 'string' && Array.isArray(o.seeds) && (o.num == null || Number.isFinite(o.num)));
    if (bad || pt || net) { delete p.objs[id]; ch = true; continue; }
    if (o.t === 'text' && o.lead && ![o.lx, o.ly, o.lu, o.lv].every(Number.isFinite)) { o.lead = false; ch = true; }
  }
  // Segmente brauchen beide Endpunkte auf derselben Lage bzw. ein Via (sonst fällt das Segment weg)
  for (const [id, o] of Object.entries(p.objs)) {
    if (o.t !== 'seg') continue;
    const a = p.objs[o.a], b = p.objs[o.b], ok = (q: any) => q && TR_PT.includes(q.t);
    if (!(ok(a) && ok(b) && o.a !== o.b && o.w > 0)) { delete p.objs[id]; ch = true; }
  }
  if (p.route && !(p.route.last && p.objs[p.route.last] && typeof p.route.L === 'string' && p.route.w > 0)) { p.route = null; ch = true; }
  if (p.look && p.look.pen && !PENS.includes(p.look.pen)) { p.look.pen = PENS[0]; ch = true; }
  return ch;
}
