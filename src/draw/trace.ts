import type { Pt } from '../types';
import { loupeMove, loupeSnap, loupeStart } from '../align/loupe';
import { VSTRIDE, getVias, snapR, snapRaw } from '../align/snap';
import { stActive, stExit } from '../align/straight';
import { saveSoon } from '../db/projects';
import { edit, objRedo, objUndo } from './edit';
import { distSeg } from './hit';
import { buildMenu, selectObj } from './menu';
import { setDraw, updateDrawUI } from './mode';
import { anchorImg, closeNote } from './note';
import { netLabel, netOf, netParts, segsOf } from './nets';
import { ED, chainOf, dragCancel, drawHandles, edHover, edKey, openLine, placePad, setPadTool, tapStartAgain, trhEnd, trhMove } from './trEdit';
import { TR_PT, TR_TYPES, anchorFrom, fromBoard, newId, objById, objList, objVer, pickId, r1, toBoard } from './objects';
import { activeLayer, layerColor, layerShares, layers, objWeight } from '../layers/model';
import { octx } from '../render/gl';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { gest, setGest } from '../ui/pointer';
import { panelUI, sheetOpen, showSheet, updateViewUI } from '../ui/sheet';
import { netsOpen, showNets, updateNets } from '../ui/netsheet';
import { toast, toastLater } from '../ui/toast';
import { $ } from '../util';
import { camPan, clampCam, s2w, w2s } from '../view/camera';

// ---------------------------------------------------------------- Bahnen nachziehen (Modus „Bahnen“, Desktop X)
// Objekte in p.objs (gemeinsamer Speicher, Auswahl, Menü und Rückgängig mit Zeichnungen, siehe objects.ts):
//   node: Ecke/Abzweig { L, x, y, img, u, v }   via: { L: '*', x, y, img, u, v, d (Durchmesser) }   pad: { L | '*', x, y, img, u, v, name? }
//   seg: Bahnstück { L, a, b (Punkt-IDs), w (Breite, Platinen-px) }   net: { L: '*', name, note, ok, seeds: [Punkt-IDs] }
// Punkte haben einen Anker im Foto ihrer Lage (wie Zeichnungen): nach neuer Ausrichtung/Geradestellung bleiben sie auf dem Kupfer.
// Netze: Zusammenhang über Segmente (Union-Find), Name über net.seeds. Eine Bahn endet am Via (wie KiCad); weiter geht es
// auf der anderen Lage mit einem Tipp auf das Via. Angefangene Bahn: p.route (übersteht Neuladen).
// Winkel in Platinenkoordinaten (nach Geradestellung): frei mit Einrasten nahe 0/45/90° (±ANG_SNAP), oder 45°-Modus mit Knick.
export const TW_F = [0.6, 1, 1.7], TW_NAME = ['Schmal', 'Normal', 'Breit'], ANG_SNAP = 5, HI_DIM = 0.2;
export const TR = { hover: null as any, hoverPt: null as any, hoverJob: 0, q: Promise.resolve() as Promise<any>, lastTap: null as any, lastClick: null as any, chip: false, posture: 0, hiId: null as string | null, tool: 'bahn' };
export const fine = () => !!TR.hover || matchMedia('(pointer:fine)').matches;   // Maus im Spiel (Hinweistext)
export const trShown = () => !!S.proj && S.mode === 'main' && !lookState().hideTr;
export const trActive = () => !!S.proj && S.tr && S.mode === 'main' && !stActive();
export const route = () => (S.proj && S.proj.route) || null;
export const imgOf = L => anchorImg(L);
const isPt = o => !!o && TR_PT.includes(o.t);
export { segsOf, netOf, netLabel, trNets } from './nets';
export { trDelete } from './trEdit';

// ---- Via-Größe aus der Via-Suche des Fotos: Vorgabe für Breite (Normal ≈ 0,27 × Median-Durchmesser) und Via-Durchmesser
const viaList: Record<string, Float32Array> = {}, viaMed: Record<string, number> = {};
let viaPid = '';
export function trLoadVias() {
  if (!S.proj) return;
  if (viaPid !== S.proj.id) { viaPid = S.proj.id; for (const k in viaList) delete viaList[k]; for (const k in viaMed) delete viaMed[k]; }
  const pid = viaPid;
  for (const side of Object.keys(S.proj.sides)) if (!viaList[side]) getVias(side).then(arr => {
    if (!arr || viaPid !== pid) return;
    viaList[side] = arr;
    const r = [];
    for (let i = 0; i < arr.length; i += VSTRIDE) r.push(arr[i + 2]);
    r.sort((a, b) => a - b);
    if (r.length) viaMed[side] = 2 * r[r.length >> 1];
  });
}
export const viaD = img => viaMed[img] || 50;
export const curW = L => r1(TW_F[twIdx()] * 0.27 * viaD(imgOf(L)));
const twIdx = () => { const t = lookState().tw; return t === 0 || t === 2 ? t : 1; };
const ang45 = () => lookState().tang === 1;

export const other = (sg, id) => sg.a === id ? sg.b : sg.a;

// ---- Fang: eigene Vias/Pads (alle Lagen), eigene Ecken/Enden, Foto-Vias (Via-Suche), eigene Segmente (Abzweig), Rundes im Foto
// Ergebnis { x, y (Platine), kind: 'via'|'pad'|'node'|'pvia'|'seg'|'blob'|'free', id?, d? }
export function trSnapSync(wx, wy, R, excl?: string, others = true) {
  const act = activeLayer(), ls = objList();
  let best = null, bd = Infinity;
  for (const o of ls) if ((o.t === 'via' || (o.t === 'pad' && (o.L === '*' || o.L === act))) && o.id !== excl) {
    const d = Math.hypot(o.x - wx, o.y - wy);
    if (d <= Math.max(R, (o.d || 0) / 2) && d < bd) { bd = d; best = { x: o.x, y: o.y, kind: o.t, id: o.id }; }
  }
  if (best) return best;
  for (const o of ls) if (o.t === 'node' && o.L === act && o.id !== excl) {
    const d = Math.hypot(o.x - wx, o.y - wy), sw = segsOf(o.id).reduce((m, s) => Math.max(m, s.w / 2), 0);
    if (d <= Math.max(R, sw) && d < bd) { bd = d; best = { x: o.x, y: o.y, kind: 'node', id: o.id }; }
  }
  if (best) return best;
  // eigenes Segment (Abzweig) unter dem Punkt
  let sg = null, ds = Infinity;
  for (const o of ls) if (o.t === 'seg' && o.L === act && o.a !== excl && o.b !== excl) {
    const a = objById(o.a), b = objById(o.b);
    if (!a || !b) continue;
    const d = distSeg(wx, wy, a.x, a.y, b.x, b.y);
    if (d <= o.w / 2 + R * 0.5 && d < ds) {
      const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l)) : 0;
      ds = d; sg = { x: a.x + t * dx, y: a.y + t * dy, kind: 'seg', id: o.id, on: d <= o.w / 2 };
    }
  }
  // Foto-Vias: zuerst die Via-Suche des Fotos dieser Lage, dann die der anderen Fotos (ein Via ist auf beiden Seiten zu sehen;
  // die Suche findet nicht jedes). other: Mitte stammt vom anderen Foto, trSnap prüft sie dann auf diesem Foto nach.
  // Liegt der Punkt auf einer eigenen Bahn, gewinnt das Foto-Via nur nahe seiner Mitte (sonst Abzweig).
  const img = imgOf(act), ownVias = ls.filter(o => (o.t === 'via' || (o.t === 'pad' && o.L === '*')) && o.id !== excl);
  for (const side of [img, ...(others ? Object.keys(viaList).filter(k => k !== img) : [])]) {
    const V = viaList[side];
    if (!V) continue;
    const [u, v] = fromBoard(side, wx, wy);
    let bi = -1;
    for (let i = 0; i < V.length; i += VSTRIDE) {
      const d = Math.hypot(V[i] - u, V[i + 1] - v);
      if (!(d <= (sg && sg.on ? 0.5 * V[i + 2] : 0.85 * V[i + 2] + R * 0.5) && d < bd)) continue;
      // schon als eigenes Via nachgezogen (auch leicht versetzt, z. B. vom anderen Foto): nicht noch einmal
      const p = toBoard(side, V[i], V[i + 1]);
      if (ownVias.some(o => Math.hypot(o.x - p[0], o.y - p[1]) <= Math.max(o.d / 2, V[i + 2]))) continue;
      bd = d; bi = i;
    }
    if (bi >= 0) {
      const [x, y] = toBoard(side, V[bi], V[bi + 1]), q = toBoard(side, V[bi] + V[bi + 2], V[bi + 1]);
      return { x, y, kind: 'pvia', d: 2 * Math.hypot(q[0] - x, q[1] - y), other: side !== img };
    }
  }
  if (sg) best = sg;
  return best;
}
// mit Fang im Foto (Rundes: Lötauge/Pad), wenn sonst nichts greift
export async function trSnap(wx, wy, R, excl?: string) {
  const s = trSnapSync(wx, wy, R, excl), img = imgOf(activeLayer());
  if (s && s.other) {   // Via vom anderen Foto: nur wenn es auch auf diesem Foto rund zu sehen ist; Mitte und Größe von hier
    const [u, v] = fromBoard(img, s.x, s.y), hit = S.proj.sides[img] ? await snapRaw(img, u, v, Math.max(R, s.d / 2)) : null;
    if (hit && hit.r >= 0.5 * s.d / 2 && Math.hypot(hit.x - u, hit.y - v) <= Math.max(R, s.d / 2)) {
      const [x, y] = toBoard(img, hit.x, hit.y), q = toBoard(img, hit.x + hit.r, hit.y);
      return { x, y, kind: 'pvia', d: 2 * Math.hypot(q[0] - x, q[1] - y) };
    }
    const t = trSnapSync(wx, wy, R, excl, false);
    if (t) return t;
  } else if (s) return s;
  const [u, v] = fromBoard(img, wx, wy);
  const hit = S.proj.sides[img] ? await snapRaw(img, u, v, R) : null;
  // nur deutlich Rundes (Lötauge/Pad, mindestens 2/3 des Via-Radius), sonst greift die Bahn selbst (Ecke, Ende) als „rund“
  if (hit && Math.hypot(hit.x - u, hit.y - v) <= R && hit.r >= 0.33 * viaD(img)) { const [x, y] = toBoard(img, hit.x, hit.y); return { x, y, kind: 'blob' }; }
  return { x: wx, y: wy, kind: 'free' };
}
const snapFn = (w, R) => trSnap(w[0], w[1], R, route() ? route().last : undefined);

// ---- Winkel (Platinenkoordinaten): frei mit Einrasten nahe 0/45/90°; 45°-Modus: gerades Stück, dann 45° (/ dreht die Reihenfolge)
export function angleFix(A: Pt, P: Pt): Pt {
  const dx = P[0] - A[0], dy = P[1] - A[1];
  if (Math.hypot(dx, dy) < 1e-6) return P;
  const q = Math.PI / 4, th = Math.atan2(dy, dx), k = Math.round(th / q);
  if (Math.abs(th - k * q) > ANG_SNAP * Math.PI / 180) return P;
  const c = Math.cos(k * q), s = Math.sin(k * q), t = dx * c + dy * s;
  return [A[0] + c * t, A[1] + s * t];
}
export function bend(A: Pt, P: Pt): Pt | null {
  const dx = P[0] - A[0], dy = P[1] - A[1], ax = Math.abs(dx), ay = Math.abs(dy), sx = Math.sign(dx), sy = Math.sign(dy), m = Math.min(ax, ay);
  if (ax < 0.5 || ay < 0.5 || Math.abs(ax - ay) < 0.5) return null;
  if (TR.posture === 0) return ax > ay ? [A[0] + sx * (ax - ay), A[1]] : [A[0], A[1] + sy * (ay - ax)];
  return [A[0] + sx * m, A[1] + sy * m];
}
// Weg vom letzten Punkt zum Ziel (für Gummiband und Setzen): [Knick?, Ziel]
function pathTo(A: Pt, pt): Pt[] {
  let P: Pt = [pt.x, pt.y];
  if (ang45()) { const K = bend(A, P); return K ? [K, P] : [P]; }
  if (pt.kind === 'free') P = angleFix(A, P);
  return [P];
}

// ---- Ändern (jeder Schritt ein Rückgängig-Schritt; Schritte des laufenden Zugs sind markiert: route, prev)
export function newPt(t, L, x, y, extra: any = {}) {
  const img = imgOf(L === '*' ? activeLayer() : L), o: any = { id: newId(), t, L, img, x: r1(x), y: r1(y), ...extra };
  anchorFrom(o);
  return o;
}
function addSeg(e, a, b, L, w) {
  if (a === b || segsOf(a).some(s => other(s, a) === b && s.L === L)) return;
  e.put({ id: newId(), t: 'seg', L, a, b, w: r1(w) });
}
export function splitSeg(e, sgId, x, y) {
  const sg = objById(sgId), n = newPt('node', sg.L, x, y);
  e.put(n);
  e.put({ id: newId(), t: 'seg', L: sg.L, a: n.id, b: sg.b, w: sg.w });
  e.mod(sg.id, s => { s.b = n.id; });
  return n.id;
}
// Ziel in einen Punkt verwandeln: { id, end } (end: die Bahn endet hier: eigener Punkt, Segment, Via)
function resolve(e, pt, L): { id: string; end: boolean } {
  if (pt.id && isPt(objById(pt.id))) return { id: pt.id, end: true };
  if (pt.kind === 'seg') return { id: splitSeg(e, pt.id, pt.x, pt.y), end: true };
  if (pt.kind === 'pvia') { const v = newPt('via', '*', pt.x, pt.y, { d: r1(pt.d) }); e.put(v); return { id: v.id, end: true }; }
  const n = newPt('node', L, pt.x, pt.y);
  e.put(n);
  return { id: n.id, end: false };
}
const tag = (pa, rid, prev) => { pa.route = rid; pa.prev = prev; return pa; };
export const queue = (fn: () => any) => { TR.q = TR.q.then(fn).catch(e => console.error(e)); return TR.q; };

// Bahn beginnen am Fangpunkt (auf der aktiven Lage)
export function trStart(pt) {
  if (!S.proj || route()) return;
  const L = activeLayer(), rid = newId();
  let id = pt.id && isPt(objById(pt.id)) ? pt.id : null, pa = null;
  if (!id) pa = edit(e => { id = resolve(e, pt, L).id; });
  if (pa && pa.length) tag(pa, rid, null);
  // Weiterziehen an einem Ende: Breite des vorhandenen Stücks
  const s0 = segsOf(id).find(s => s.L === L);
  S.proj.route = { L, last: id, w: s0 ? s0.w : curW(L), rid, n: 0 };
  if (pickId()) selectObj(null);
  saveSoon(); updateTrUI(); dirty();
}
// Ecke setzen bzw. am Ziel anschließen und beenden
export function trPlace(pt) {
  const R = route(), A = R && objById(R.last);
  if (!R) return;
  if (!A) { S.proj.route = null; updateTrUI(); return; }
  hideChip();
  if (pt.id === R.last) return;
  const path = pathTo([A.x, A.y], pt), P = path[path.length - 1];
  if (!pt.id && Math.hypot(P[0] - A.x, P[1] - A.y) * S.cams.main.s < 3) return;   // zu kurz
  let res = null;
  const pa = edit(e => {
    let from = R.last;
    if (path.length > 1) { const k = newPt('node', R.L, path[0][0], path[0][1]); e.put(k); addSeg(e, from, k.id, R.L, R.w); from = k.id; }
    res = resolve(e, { ...pt, x: P[0], y: P[1] }, R.L);
    addSeg(e, from, res.id, R.L, R.w);
  });
  tag(pa, R.rid, R.last);
  R.n = (R.n || 0) + 1;
  if (res.end) { const t = objById(res.id); trFinish(t && t.t === 'via' ? 'via' : 'join'); return; }
  R.last = res.id;
  saveSoon(); updateTrUI(); dirty();
}
// Bahn beenden; ohne ein einziges Stück verschwindet der neu gesetzte Startpunkt spurlos
export function trFinish(why?: string) {
  const R = route();
  if (!R) return;
  S.proj.route = null;
  TR.lastTap = TR.lastClick = null;
  const top = S.oundo[S.oundo.length - 1];
  if (!R.n) { if (top && top.route === R.rid && top.prev == null) objUndo(true); }
  else nameChip(R.last, why === 'via' ? 'Am Via beendet' : '');
  saveSoon(); updateTrUI(); buildMenu(); dirty();
}
// letzte Ecke zurück (↶, Rücktaste); ohne Verlauf (nach Neuladen) das letzte Stück von Hand
export function trBack() {
  const R = route();
  if (!R) return false;
  TR.lastTap = TR.lastClick = null;   // nächster Klick an derselben Stelle ist kein Doppelklick
  const top = S.oundo[S.oundo.length - 1];
  if (top && top.route === R.rid) {
    if (top.prev == null) { S.proj.route = null; objUndo(true); }
    else { R.last = top.prev; R.n = Math.max(0, (R.n || 1) - 1); objUndo(true); if (!objById(R.last)) S.proj.route = null; }
  } else {
    const ss = segsOf(R.last).filter(s => s.L === R.L), n = objById(R.last);
    if (ss.length !== 1) { trFinish(); return true; }
    const sg = ss[0], o = other(sg, R.last);
    edit(e => { e.del(sg.id); if (n && n.t === 'node' && segsOf(n.id).length === 1) e.del(n.id); });
    R.last = o; R.n = Math.max(0, (R.n || 1) - 1);
  }
  saveSoon(); updateTrUI(); dirty();
  return true;
}
// Via an der letzten Ecke (Desktop: am Mauszeiger, falls der woanders steht) und beenden
export function trVia() {
  if (!route()) return;
  queue(async () => {
    let R = route();
    const hp = TR.hover ? TR.hoverPt : null, A = objById(R.last);
    if (hp && A && Math.hypot(hp.x - A.x, hp.y - A.y) * S.cams.main.s > 4) { trPlace(hp); R = route(); if (!R) return; }
    const n = objById(R.last);
    if (n && n.t === 'node') {
      const pa = edit(e => e.mod(n.id, o => { o.t = 'via'; o.L = '*'; o.d = r1(viaD(o.img)); }));
      tag(pa, R.rid, R.last); R.n = (R.n || 0) + 1;
    }
    trFinish('via');
  });
}
// nach Rückgängig: angefangene Bahn ohne Endpunkt aufgeben
export function trCheck() { const R = route(); if (R && !objById(R.last)) { S.proj.route = null; } updateTrUI(); }

// ---- Netz benennen (Eingabezeile unten); Name hängt am net-Objekt des Netzes (nets.ts)
export function openNetName(id) {
  const c = netOf(id);
  if (!c || !c.net) return;
  const nid = c.net.id;
  openLine(c.net.name || '', netLabel(c) + ': Name, z. B. VBAT', v => setNetField(nid, 'name', v));
}
export function setNetName(seed, name) { const c = netOf(seed); if (c && c.net) setNetField(c.net.id, 'name', name); }
export function setNetField(netId, k, v) {
  const n = objById(netId);
  if (!n || n[k] === v) return;
  edit(e => e.mod(netId, o => { o[k] = v; }));
  buildMenu();
}
// Zwei benannte Netze wurden verbunden: Warnung mit Rückgängig und Zusammenlegen (behält den Namen des älteren Netzes)
export function trConflict([a, b]) {
  const t = $('#toast');
  t.innerHTML = '';
  const sp = document.createElement('span'); sp.textContent = 'Verbindet ' + a.name + ' mit ' + b.name;
  const mk = (txt, fn) => { const x = document.createElement('button'); x.textContent = txt; x.className = 'tbtn'; x.onclick = () => { t.classList.remove('show', 'undo', 'warn'); fn(); }; return x; };
  const row = document.createElement('span'); row.className = 'trow';
  row.append(mk('Rückgängig', () => objUndo()), mk('Zusammenlegen', () => mergeNets(a.id, b.id)));
  t.append(sp, row); t.classList.add('show', 'undo', 'warn');
  toastLater(() => t.classList.remove('show', 'undo', 'warn'), 9000);
}
export function mergeNets(aId, bId) {
  const a = objById(aId), b = objById(bId);
  if (!a || !b) return;
  edit(e => {
    e.mod(aId, n => { n.seeds = [...new Set(n.seeds.concat(b.seeds))]; n.note = [n.note, b.note].filter(Boolean).join(' / '); n.ok = !!(n.ok && b.ok); });
    e.del(bId);
  });
  toast('Zusammengelegt: ' + a.name, 1800);
  buildMenu(); dirty();
}
// Meldung nach dem Beenden: „Netz 7 · Namen geben“ (nur bei Netzen ohne Namen; ignorieren schadet nicht)
function nameChip(id, msg) {
  const c = netOf(id);
  if (!c || c.name) { if (msg) toast(msg, 1800); return; }
  const t = $('#toast');
  t.innerHTML = ''; if (msg) t.append(msg + ' ');
  const b = document.createElement('button'); b.textContent = netLabel(c) + ' · Namen geben';
  b.style.cssText = 'min-height:40px;margin-left:4px;color:var(--accent);background:transparent;border-color:transparent';
  b.onclick = () => { t.classList.remove('show', 'undo'); openNetName(id); };
  t.append(b); t.classList.add('show', 'undo'); TR.chip = true;
  toastLater(() => { TR.chip = false; t.classList.remove('show', 'undo'); }, 5000);
}

// ---- Auswahl/Hervorheben: ausgewähltes Bahnobjekt (oder ` am Desktop) hebt sein Netz hervor, alles andere gedämpft
// hervorgehoben: alle Teile des Netzes (net-Objekt), als Mengen { key, segs, pts }; TR.hiId = Objekt- oder Netz-ID
let hiC = { k: '', v: null as any };
export const hiNet = () => {
  const p = pickId(), o = objById(p), id = o && TR_TYPES.includes(o.t) ? p : TR.hiId;
  if (!id) return null;
  const k = id + '|' + objVer;
  if (hiC.k === k) return hiC.v;
  const q = objById(id), net = q && q.t === 'net' ? q : (netOf(id) || {} as any).net, c = netOf(id);
  const parts = net ? netParts(net.id) : c ? [c] : [];
  let v = null;
  if (parts.length) {
    v = { key: net ? net.id : parts[0].key, segs: new Set<string>(), pts: new Set<string>(), net };
    for (const x of parts) { for (const s of x.segs) v.segs.add(s); for (const s of x.pts) v.pts.add(s); }
  }
  hiC = { k, v };
  return v;
};
export function trSelect(id) { TR.hiId = null; ED.whole = null; hideChip(); selectObj(id); }
const hideChip = () => { if (TR.chip) { TR.chip = false; $('#toast').classList.remove('show', 'undo'); } };
export function trClearHi() { TR.hiId = null; if (pickId()) selectObj(null); dirty(); }

// ---- Treffer am Bildschirm (Hauptfenster): Vias/Pads vor Ecken vor Segmenten; Ecken/Segmente nur auf der aktiven Lage
export function trHit(x, y) {
  if (!trShown()) return null;
  const cam = S.cams.main, pane = S.panes[0], act = activeLayer(), sh = layerShares();
  let best = null, bs = Infinity;
  for (const o of objList()) {
    let sc = Infinity;
    if (o.t === 'via' || (o.t === 'pad' && (o.L === '*' || o.L === act))) {
      const s = w2s(cam, pane, o.x, o.y), r = Math.max(5, (o.d || 0) / 2 * cam.s), d = Math.hypot(s[0] - x, s[1] - y);
      if (d <= r + 10) sc = Math.max(0, d - r) - 30;
    } else if (o.t === 'node' && o.L === act) {
      const s = w2s(cam, pane, o.x, o.y), d = Math.hypot(s[0] - x, s[1] - y), hw = segsOf(o.id).reduce((m, q) => Math.max(m, q.w / 2), 0) * cam.s;
      if (d <= Math.max(10, hw + 6)) sc = d - 15;
    } else if (o.t === 'seg' && o.L === act && objWeight(o, sh) > 0) {
      const a = objById(o.a), b = objById(o.b);
      if (!a || !b) continue;
      const A = w2s(cam, pane, a.x, a.y), B = w2s(cam, pane, b.x, b.y), hw = Math.max(1, o.w / 2 * cam.s), d = distSeg(x, y, A[0], A[1], B[0], B[1]);
      if (d <= hw + 10) sc = Math.max(0, d - hw);
    }
    if (sc < bs) { bs = sc; best = o; }
  }
  return best;
}

// ---- Modus
export function setTrace(on) {
  on = !!on && !!S.proj && S.mode === 'main';
  if (S.note) closeNote();
  if (S.tr === on) { updateTrUI(); return; }
  if (on) {
    if (S.draw) setDraw(false);
    if (stActive()) stExit();
    lookState().hideTr = false;
    if (sheetOpen() && !panelUI()) showSheet(false);
    trLoadVias();
    toast(fine() ? 'Klick setzt Ecke, Doppelklick beendet' : 'Finger auflegen, loslassen setzt Ecke', 3000);
  } else {
    if (route()) trFinish();
    dragCancel(); TR.tool = 'bahn';
    S.loupe = null; TR.hover = TR.hoverPt = null;
    $('#toast').classList.remove('show');
  }
  S.tr = on; TR.hiId = null;
  selectObj(null);
  updateTrUI(); updateDrawUI(); updateViewUI(); dirty(); saveSoon();
}
export function setTrHidden(h) {
  if (h && S.tr) setTrace(false);
  lookState().hideTr = !!h; TR.hiId = null; selectObj(null);
  updateViewUI(); dirty(); saveSoon();
}
export function cycleWidth(d) {
  const lk = lookState(), i = (twIdx() + d + 3) % 3;
  lk.tw = i;
  const R = route();
  if (R) R.w = curW(R.L);
  toast('Breite: ' + TW_NAME[i], 1200);
  updateTrUI(); dirty(); saveSoon();
}
export function toggleAngle() {
  const lk = lookState(); lk.tang = ang45() ? 0 : 1;
  toast(ang45() ? 'Winkel: nur 45°' : 'Winkel: frei', 1200);
  updateTrUI(); dirty(); saveSoon();
}
export function updateTrUI() {
  if (!S.proj) return;
  updateNets();
  const on = !!S.tr && S.mode === 'main', R = route();
  $('#grpTrace').hidden = !on;
  if (!on) return;
  $('#tVia').hidden = !R; $('#tPad').hidden = !!R;
  const pad = TR.tool === 'pad' && !R;
  $('#tPad').classList.toggle('on', pad); $('#tPad').setAttribute('aria-pressed', String(pad));
  $('#tUndo').disabled = !R && !S.oundo.length;
  $('#tUndo').setAttribute('aria-label', R ? 'Letzte Ecke zurück' : 'Rückgängig');
  const i = twIdx();
  $('#tWidth').innerHTML = `<i class="tw" style="height:${[2, 4, 7][i]}px"></i>${TW_NAME[i]}`;
  $('#tAng').textContent = ang45() ? '∠ 45°' : '∠ frei';
  $('#tDone').textContent = R ? 'Ende' : 'Fertig';
  $('#tDone').setAttribute('aria-label', R ? 'Bahn beenden' : 'Bahnen beenden');
}
export function initTraceUI() {
  $('#btnTrace').onclick = () => setTrace(true);
  $('#tDone').onclick = () => { if (route()) queue(() => trFinish()); else setTrace(false); };
  $('#tUndo').onclick = () => { if (route()) queue(() => trBack()); else objUndo(); };
  $('#tVia').onclick = () => trVia();
  $('#tPad').onclick = () => setPadTool(TR.tool !== 'pad');
  $('#tWidth').onclick = () => cycleWidth(1);
  $('#tAng').onclick = () => toggleAngle();
  $('#vTrEye').onclick = () => setTrHidden(!lookState().hideTr);
}

// ---- Gesten im Modus Bahnen (aus ui/gestures.ts). Finger: Lupe, Loslassen setzt; kurzer Tipp auf Eigenes wählt aus bzw. startet
// am Via/Ende; Doppeltipp beendet. Maus: Klick setzt, Ziehen schiebt, Doppelklick beendet, Mauszeiger zeigt Gummiband und Fang.
export function trDown(pane, x, y, mouse) {
  if (mouse) { setGest({ kind: 'trm', pane, moved: false, x0: x, y0: y }); return; }
  TR.hover = TR.hoverPt = null;   // Finger: kein Mauszeiger-Gummiband
  setGest({ kind: 'trt', pane, moved: false, x0: x, y0: y, t0: performance.now() });
  loupeStart(pane, x, y, x, y, true, false, snapFn);
}
export function trMove(x, y, dx, dy) {
  const g = gest;
  if (g.kind === 'trh') { trhMove(x, y); return; }
  if (g.kind === 'trt') { if (S.loupe) loupeMove(x, y); return; }
  if (g.kind === 'trm' && g.moved) { camPan(S.cams.main, dx, dy); clampCam('main'); dirty(); }
}
export function trCancel() { if (gest && String(gest.kind).startsWith('tr')) { if (gest.kind === 'trh') dragCancel(); S.loupe = null; S.preview = null; setGest(null); dirty(); } }
export function trEnd(g, cancel) {
  const cam = S.cams.main, now = performance.now();
  if (g.kind === 'trh') { trhEnd(g, cancel); return; }
  if (g.kind === 'trm') {
    if (cancel || g.moved) return;
    const x = g.x0, y = g.y0, lc = TR.lastClick;
    if (TR.tool === 'pad' && !route()) { const w = s2w(cam, g.pane, x, y); queue(async () => placePad(await trSnap(w[0], w[1], snapR(cam.s)))); return; }
    if (tapStartAgain(x, y)) { TR.lastClick = null; return; }
    TR.lastClick = { t: now, x, y };
    if (lc && now - lc.t < 400 && Math.hypot(x - lc.x, y - lc.y) < 8) { TR.lastClick = null; queue(() => trFinish()); return; }
    const w = s2w(cam, g.pane, x, y), R = snapR(cam.s);
    if (!route()) { const h = trHit(x, y); if (h && h.t === 'via') viaHint(h); }
    queue(async () => { const pt = await trSnap(w[0], w[1], R, route() ? route().last : undefined); if (route()) trPlace(pt); else trStart(pt); });
    return;
  }
  const L = S.loupe;
  S.loupe = null; S.preview = null; dirty();
  if (L) clearTimeout(L.timer);
  if (cancel || !L) return;
  const tap = !g.moved && now - g.t0 < 250;
  if (TR.tool === 'pad' && !route()) { const p = loupeSnap(L, true); queue(async () => placePad(await p)); return; }
  if (tap && tapStartAgain(g.x0, g.y0)) { TR.lastTap = null; return; }
  if (tap) {
    const lt = TR.lastTap;
    TR.lastTap = { t: now, x: g.x0, y: g.y0 };
    if (route() && lt && now - lt.t < 350 && Math.hypot(g.x0 - lt.x, g.y0 - lt.y) < 30) { TR.lastTap = null; queue(() => trFinish()); return; }
    if (!route() && tapIdle(g.x0, g.y0)) return;
  } else TR.lastTap = null;
  const ptP = loupeSnap(L, true);
  queue(async () => { const pt = await ptP; if (!pt) return; if (route()) trPlace(pt); else trStart(pt); });
}
// kurzer Tipp ohne laufende Bahn: Via → Bahn von dort; freies Ende → weiter; Bahn/Ecke → auswählen; Leere bei Auswahl → abwählen
function tapIdle(x, y) {
  const h = trHit(x, y);
  if (h && h.t === 'via') { viaHint(h); queue(() => trStart({ x: h.x, y: h.y, kind: 'via', id: h.id })); return true; }
  if (h && (h.t === 'node' || h.t === 'pad') && segsOf(h.id).length <= 1) { queue(() => trStart({ x: h.x, y: h.y, kind: h.t, id: h.id })); return true; }
  if (h) { trSelect(h.id); return true; }
  if (pickId() || TR.hiId) { trClearHi(); return true; }
  return false;
}
// am Via: liegt auf der aktiven Lage schon eine Bahn daran, geht es vermutlich auf der anderen weiter
function viaHint(v) {
  const act = activeLayer(), ss = segsOf(v.id);
  if (layers().length > 1 && ss.some(s => s.L === act) && !ss.some(s => s.L !== act)) toast('Lage wechseln mit ⇄', 2000);
}
// Maus über der Platine: Gummiband und Fang-Vorschau
export function trHover(x, y) {
  if (x != null && edHover(x, y)) return;
  if (ED.drag) { if (TR.hoverPt) { TR.hoverPt = null; dirty(); } return; }
  if (x == null || !S.proj || S.mode !== 'main' || !S.cams.main) { if (TR.hover) { TR.hover = TR.hoverPt = null; dirty(); } return; }
  const cam = S.cams.main, w = s2w(cam, S.panes[0], x, y), R = snapR(cam.s), excl = route() ? route().last : undefined;
  TR.hover = { x, y, w };   // auch außerhalb des Modus gemerkt: X beginnt am Mauszeiger
  if (!trActive()) { if (TR.hoverPt) { TR.hoverPt = null; dirty(); } return; }
  TR.hoverPt = trSnapSync(w[0], w[1], R, excl) || { x: w[0], y: w[1], kind: 'free' };
  const job = ++TR.hoverJob;
  if (TR.hoverPt.kind === 'free') setTimeout(() => {
    if (job !== TR.hoverJob) return;
    trSnap(w[0], w[1], R, excl).then(pt => { if (job === TR.hoverJob && TR.hover) { TR.hoverPt = pt; dirty(); } });
  }, 80);
  dirty();
}
// Tasten im Modus Bahnen (KiCad): X, V, W, Rücktaste, Esc/Ende, /, Umschalt+Leertaste, `, Strg+Z. true = erledigt
export function trKey(e) {
  const k = e.key, plain = !e.ctrlKey && !e.metaKey && !e.altKey;
  if (edKey(e, k, plain)) return true;
  if ((k === 'n' || k === 'N') && plain && !e.repeat) { e.preventDefault(); showNets(!netsOpen()); return true; }
  if (((k === 'y' || k === 'Y') && (e.ctrlKey || e.metaKey) && !e.shiftKey) || ((k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey) && e.shiftKey)) {
    e.preventDefault(); if (!route()) objRedo(); return true;
  }
  if ((k === '`' || e.code === 'Backquote') && plain && !e.repeat && trShown()) {
    const h = TR.hover && trHit(TR.hover.x, TR.hover.y);
    if (h) { TR.hiId = h.id; if (pickId()) selectObj(null); } else TR.hiId = null;
    dirty(); return true;
  }
  if ((k === 'x' || k === 'X') && plain && !e.repeat && S.mode === 'main' && !stActive()) {
    e.preventDefault();
    if (!S.tr) setTrace(true);
    if (!route() && TR.hover) { const h = TR.hover; queue(async () => { const pt = await trSnap(h.w[0], h.w[1], snapR(S.cams.main.s)); trStart(pt); }); }
    return true;
  }
  if (!trActive()) return false;
  const R = route();
  if (R && k === 'Backspace') { e.preventDefault(); queue(() => trBack()); return true; }
  if (R && (k === 'Escape' || k === 'End')) { e.preventDefault(); queue(() => trFinish()); return true; }
  if (R && (k === 'v' || k === 'V') && plain && !e.repeat) { e.preventDefault(); trVia(); return true; }
  if (R && k === '/' && plain) { TR.posture ^= 1; dirty(); return true; }
  if ((k === 'w' || k === 'W') && plain && !e.repeat) { cycleWidth(e.shiftKey ? -1 : 1); return true; }
  if (k === ' ' && e.shiftKey && plain) { e.preventDefault(); toggleAngle(); return true; }
  if (R && (k === 'z' || k === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); queue(() => trBack()); return true; }
  return false;
}

// ---- Darstellung
// Segmente für die WebGL-Linien: [Segment, Gewicht, Gruppe] (0 gedämpft, 1 voll, 2 hervorgehoben/ausgewählt)
export function trDrawList() {
  if (!trShown()) return [];
  const sh = layerShares(), hn = hiNet(), sel = pickId(), so = objById(sel), out = [];
  const wh = so && so.t === 'seg' && ED.whole === sel ? new Set(chainOf(sel).segs.map(q => q.id)) : null;
  for (const o of objList()) {
    if (o.t !== 'seg') continue;
    const inHi = hn && hn.segs.has(o.id);
    let w = inHi ? 1 : objWeight(o, sh);   // hervorgehobenes Netz auf allen Lagen voll, der Rest gedämpft
    if (hn && !inHi) w *= HI_DIM;
    if (!w) continue;
    out.push([o, w, inHi || o.id === sel || (wh && wh.has(o.id)) ? 2 : w >= 1 ? 1 : 0]);
  }
  return out;
}
export const trVisKey = () => { const h = hiNet(); return (lookState().hideTr ? 1 : 0) + '|' + (h ? h.key : '') + '|' + layers().map(L => L.color).join(); };
// Ziel des Gummibands: Lupe (Finger) bzw. Mauszeiger
function target() {
  const L = S.loupe;
  if (L && gest && gest.kind === 'trt') {
    const w = s2w(S.cams.main, L.pane, L.x, L.y), pv = S.preview;
    return pv && pv.pane === 'main' && pv.at[0] === L.x && pv.at[1] === L.y ? pv.pt : { x: w[0], y: w[1], kind: 'free' };
  }
  return TR.hover ? TR.hoverPt : null;
}
function padLabel(t, x, y, a) {
  octx.font = '600 12px system-ui,sans-serif'; octx.textBaseline = 'middle';
  const w = octx.measureText(t).width;
  octx.globalAlpha = Math.max(0.35, a);
  octx.fillStyle = 'rgba(0,0,0,.72)'; octx.fillRect(x, y - 9, w + 8, 18);
  octx.fillStyle = '#fff'; octx.fillText(t, x + 4, y);
  octx.globalAlpha = 1;
}
export function drawTrace(pane, cam) {
  if (!trShown()) return;
  const hn = hiNet(), sel = pickId(), lc = layers(), cTop = layerColor(lc.length ? lc[0].id : 'front'), cBot = layerColor(lc.length ? lc[lc.length - 1].id : 'back');
  const sh = layerShares(), W = pane.x + pane.w, H = pane.y + pane.h;
  octx.save();
  // Vias: Ring in beiden Lagenfarben (Halbkreise), dunkles Loch; Pads: Quadrat in Lagenfarbe
  for (const o of objList()) {
    if (o.t !== 'via' && o.t !== 'pad') continue;
    const s = w2s(cam, pane, o.x, o.y), r = Math.max(o.t === 'via' ? 4 : 3, (o.d || viaD(o.img) * 0.8) / 2 * cam.s);
    if (s[0] < pane.x - r || s[0] > W + r || s[1] < pane.y - r || s[1] > H + r) continue;
    const inHi = hn && hn.pts.has(o.id);
    let a = inHi ? 1 : o.t === 'pad' ? objWeight(o, sh) : 1;
    if (!a) continue;
    if (hn && !inHi) a *= HI_DIM;
    octx.globalAlpha = a * (pane.loupe ? 0.6 : 0.9);
    if (o.t === 'via') {
      octx.fillStyle = cTop; octx.beginPath(); octx.arc(s[0], s[1], r, Math.PI, 2 * Math.PI); octx.fill();
      octx.fillStyle = cBot; octx.beginPath(); octx.arc(s[0], s[1], r, 0, Math.PI); octx.fill();
      octx.fillStyle = '#101317'; octx.beginPath(); octx.arc(s[0], s[1], r * 0.42, 0, 7); octx.fill();
      octx.lineWidth = 1; octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.beginPath(); octx.arc(s[0], s[1], r + 0.5, 0, 7); octx.stroke();
    } else {
      octx.fillStyle = o.L === '*' ? cTop : layerColor(o.L); octx.fillRect(s[0] - r, s[1] - r, 2 * r, 2 * r);
      if (o.L === '*') { octx.fillStyle = cBot; octx.fillRect(s[0] - r, s[1], 2 * r, r); octx.fillStyle = '#101317'; octx.beginPath(); octx.arc(s[0], s[1], r * 0.36, 0, 7); octx.fill(); }   // durchgehend: beide Lagenfarben, Loch
      octx.lineWidth = 1; octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.strokeRect(s[0] - r, s[1] - r, 2 * r, 2 * r);
    }
    if (o.t === 'pad' && o.name && !pane.loupe && r >= 7) padLabel(o.name, s[0] + r + 4, s[1] - r - 6, a);   // rechts oberhalb: die Bahn am Pad bleibt frei
    if (o.id === sel || (inHi && !pane.loupe)) {
      octx.globalAlpha = 1; octx.lineWidth = 2; octx.strokeStyle = '#fff'; octx.beginPath();
      if (o.t === 'pad') octx.rect(s[0] - r - 3, s[1] - r - 3, 2 * r + 6, 2 * r + 6); else octx.arc(s[0], s[1], r + 3, 0, 7);
      octx.stroke();
    }
  }
  octx.globalAlpha = 1;
  drawHandles(pane, cam);   // Griffe am Ausgewählten (trEdit.ts)
  // laufende Bahn: letzter Punkt, Gummiband, Fang
  const R = route(), A = R && objById(R.last), T = trActive() ? target() : null;
  if (A) {
    const a = w2s(cam, pane, A.x, A.y), col = layerColor(R.L);
    if (T && T.id !== R.last) {
      const path = pathTo([A.x, A.y], T), P = [a, ...path.map(p => w2s(cam, pane, p[0], p[1]))];
      octx.lineCap = 'round'; octx.lineJoin = 'round';
      const pth = () => { octx.beginPath(); P.forEach((p, i) => i ? octx.lineTo(p[0], p[1]) : octx.moveTo(p[0], p[1])); };
      if (!pane.loupe) {   // in der Lupe nur die Mittellinie, damit das Kupfer unter dem Fadenkreuz frei bleibt
        pth(); octx.lineWidth = Math.max(1, R.w * cam.s) + 2; octx.strokeStyle = 'rgba(0,0,0,.45)'; octx.stroke();
        pth(); octx.lineWidth = Math.max(1, R.w * cam.s); octx.strokeStyle = col; octx.globalAlpha = 0.55; octx.stroke(); octx.globalAlpha = 1;
      }
      pth(); octx.setLineDash([4, 4]); octx.lineWidth = 1; octx.strokeStyle = '#fff'; octx.stroke(); octx.setLineDash([]);
    }
    octx.lineWidth = 2; octx.strokeStyle = '#fff'; octx.fillStyle = col;
    octx.beginPath(); octx.arc(a[0], a[1], pane.loupe ? 3 : 5, 0, 7); octx.fill(); octx.stroke();
  }
  if (T && T.kind !== 'free' && (A || trActive())) {
    const s = w2s(cam, pane, T.x, T.y), o = objById(T.id), r = T.kind === 'pvia' ? T.d / 2 : o && (o.t === 'via' || o.t === 'pad') ? (o.d || 20) / 2 : T.kind === 'blob' ? 10 : 6;
    const rad = Math.max(pane.loupe ? 5 : 8, r * cam.s + 3);
    octx.setLineDash(T.kind === 'blob' ? [4, 3] : []);
    octx.lineWidth = 3.5; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.beginPath(); octx.arc(s[0], s[1], rad, 0, 7); octx.stroke();
    octx.lineWidth = 2; octx.strokeStyle = '#fff'; octx.beginPath(); octx.arc(s[0], s[1], rad, 0, 7); octx.stroke();
    octx.setLineDash([]);
  }
  octx.restore();
}
