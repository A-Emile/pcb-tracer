import type { Pt } from '../types';
import { loupeMove, loupeSnap, loupeStart } from '../align/loupe';
import { VSTRIDE, getVias, snapRaw } from '../align/snap';
import { stActive, stExit } from '../align/straight';
import { saveSoon } from '../db/projects';
import { edit, objRedo, objUndo } from './edit';
import { distSeg } from './hit';
import { buildMenu, selectObj } from './menu';
import { setDraw, updateDrawUI } from './mode';
import { anchorImg, closeNote } from './note';
import { netLabel, netOf, netParts, segsOf, trNets } from './nets';
import { ED, chainOf, dragCancel, drawHandles, edHover, edKey, openLine, placePad, setPadTool, tapStartAgain, trhEnd, trhMove } from './trEdit';
import { TR_PT, TR_TYPES, anchorFrom, fromBoard, newId, objById, objList, objVer, pickId, r1, toBoard } from './objects';
import { activeLayer, layerColor, layerShares, layers, objWeight } from '../layers/model';
import { octx } from '../render/gl';
import { dirty } from '../render/frame';
import { DPR, S, lookState } from '../state';
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
// Netze: Zusammenhang über Segmente (Union-Find), Name über net.seeds. Vias entstehen nur bewusst (wie KiCad): [Via]/V an der
// letzten Ecke (beendet die Bahn), „Via“ im Menü einer Ecke, oder als Abzweig-Ende beim Verlegen einer Bahn auf eine andere Lage.
// Ein Foto-Via ist nur ein Einrastpunkt für eine normale Ecke; die Bahn endet erst auf einem eigenen Via/Pad/Ende/Segment.
// Weiter auf der anderen Lage mit einem Tipp auf das Via. Angefangene Bahn: p.route (übersteht Neuladen).
// Winkel in Platinenkoordinaten (nach Geradestellung): frei mit Einrasten nahe 0/45/90° (±ANG_SNAP, die Ecke wandert dabei höchstens
// etwa eine Bahnbreite), oder 45°-Modus mit Knick.
// Fang (Einrasten): Rand des Ziels höchstens FANG Bildschirm-px (in der Lupe: Lupen-px) vom Fadenkreuz, und nur wenn eindeutig
// (zweitbestes Ziel mindestens FANG/2 weiter weg), sonst bleibt der Punkt genau am Fadenkreuz. „Fang aus“ (Leiste, Desktop:
// Umschalt halten): nur noch direkte Treffer auf eigene Objekte (Punkt liegt darauf), keine Foto-Vias.
export const TW_F = [0.6, 1, 1.7], TW_NAME = ['Schmal', 'Normal', 'Breit'], ANG_SNAP = 5, HI_DIM = 0.2, FANG = 10;
// Vias: d = Durchmesser des Kupferrings (Platinen-px). VIA_CU = Kupferring / Durchmesser aus der Via-Suche (die Suche misst bis
// zum äußeren, unscharfen Rand); Größe in Stufen (look.vs), Bohrung VIA_DRILL × d. dv: 2 = Größe nach dieser Regel (ältere werden beim Öffnen umgerechnet)
export const VIA_CU = 0.7, VIA_DRILL = 0.45, VS_F = [0.75, 1, 1.3], VS_NAME = ['Klein', 'Normal', 'Groß'];
export const TR = { hover: null as any, hoverPt: null as any, hoverJob: 0, q: Promise.resolve() as Promise<any>, lastTap: null as any, lastClick: null as any, chip: false, posture: 0, hiId: null as string | null, tool: 'bahn', shift: false };
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
export const viaD = img => viaMed[img] || 50;   // Durchmesser laut Via-Suche (Bezug für Breiten)
export const curW = L => r1(TW_F[twIdx()] * 0.27 * viaD(imgOf(L)));
const twIdx = () => { const t = lookState().tw; return t === 0 || t === 2 ? t : 1; };
export const vsIdx = () => { const t = lookState().vs; return t === 0 || t === 2 ? t : 1; };
export const viaCu = (img, i = vsIdx()) => r1(VIA_CU * VS_F[i] * viaD(img));   // Kupferring eines neuen Vias
export const padD = img => r1(VIA_CU * viaD(img));
export const fangOff = () => !!lookState().nofang || TR.shift;
export const fangR = (s: number) => FANG / Math.max(s, 1e-3);   // Fang in Platinen-px bei Maßstab s (Lupe bzw. Fenster)
// ältere Stände (Via/Pad-Durchmesser aus der Via-Suche) auf Kupferring-Größe bringen; ohne Rückgängig, true = geändert
export function viaMigrate(p) {
  let ch = false;
  for (const o of Object.values(p.objs || {}) as any[]) if ((o.t === 'via' || o.t === 'pad') && o.dv !== 2) { o.d = r1((o.d || 50) * VIA_CU); o.dv = 2; ch = true; }
  return ch;
}
const ang45 = () => lookState().tang === 1;

export const other = (sg, id) => sg.a === id ? sg.b : sg.a;

// ---- Fang: eigene Vias/Pads (alle Lagen), eigene Ecken/Enden, eigene Segmente (Abzweig), Foto-Vias (Via-Suche, nur als Ecke)
// Ergebnis { x, y (Platine), kind: 'via'|'pad'|'node'|'pvia'|'seg', id?, d? } oder null (frei: Punkt bleibt am Fadenkreuz).
// R = Fang in Platinen-px (fangR; für Abzweige auf Segmente nur die Hälfte). Bewertet wird der Abstand zum Rand des Ziels (0 = Punkt liegt darauf); eingerastet wird nur,
// wenn das beste Ziel eindeutig ist. Ein Segment, das an einem Kandidaten-Punkt endet, und ein Foto-Via unter einem eigenen
// Objekt zählen nicht als zweites Ziel (es ist dieselbe Stelle).
export function trSnapSync(wx, wy, R, excl?: string, others = true) {
  const act = activeLayer(), ls = objList(), off = fangOff(), M = off ? 0 : R, C = [];
  for (const o of ls) {
    if (o.id === excl) continue;
    if (o.t === 'via' || (o.t === 'pad' && (o.L === '*' || o.L === act))) {
      const dc = Math.hypot(o.x - wx, o.y - wy), e = Math.max(0, dc - (o.d || 0) / 2);
      if (e <= M) C.push({ e, dc, pt: { x: o.x, y: o.y, kind: o.t, id: o.id } });
    } else if (o.t === 'node' && o.L === act) {
      const dc = Math.hypot(o.x - wx, o.y - wy), e = Math.max(0, dc - segsOf(o.id).reduce((m, s) => Math.max(m, s.w / 2), 0));
      if (e <= M) C.push({ e, dc, pt: { x: o.x, y: o.y, kind: 'node', id: o.id } });
    }
  }
  const pts = new Set(C.map(c => c.pt.id)), own = [];
  for (const o of ls) if (o.t === 'seg' && o.L === act && o.a !== excl && o.b !== excl) {
    const a = objById(o.a), b = objById(o.b);
    if (!a || !b) continue;
    own.push([o, a, b]);
    if (pts.has(o.a) || pts.has(o.b)) continue;
    const d = distSeg(wx, wy, a.x, a.y, b.x, b.y), e = Math.max(0, d - o.w / 2);
    if (e > 0.5 * M) continue;   // Abzweig verbindet zwei Netze: nur bei (fast) direktem Treffer
    const dx = b.x - a.x, dy = b.y - a.y, l = dx * dx + dy * dy, t = l ? Math.max(0, Math.min(1, ((wx - a.x) * dx + (wy - a.y) * dy) / l)) : 0;
    C.push({ e, dc: d, pt: { x: a.x + t * dx, y: a.y + t * dy, kind: 'seg', id: o.id, on: d <= o.w / 2 } });
  }
  // Foto-Vias: Via-Suche des Fotos dieser Lage, dazu die der anderen Fotos (ein Via ist auf beiden Seiten zu sehen, die Suche
  // findet nicht jedes); other: Mitte vom anderen Foto, trSnap prüft sie auf diesem Foto nach
  if (!off) {
    const img = imgOf(act), ownPts = ls.filter(o => (o.t === 'via' || o.t === 'pad' || (o.t === 'node' && o.L === act)) && o.id !== excl);
    for (const side of [img, ...(others ? Object.keys(viaList).filter(k => k !== img) : [])]) {
      const V = viaList[side];
      if (!V) continue;
      const [u, v] = fromBoard(side, wx, wy);
      for (let i = 0; i < V.length; i += VSTRIDE) {
        if (Math.hypot(V[i] - u, V[i + 1] - v) > V[i + 2] + 2 * M + 8) continue;   // grob (Bildmaßstab ≈ Platine)
        const p = toBoard(side, V[i], V[i + 1]), q = toBoard(side, V[i] + V[i + 2], V[i + 1]), rc = VIA_CU * Math.hypot(q[0] - p[0], q[1] - p[1]);
        const dc = Math.hypot(p[0] - wx, p[1] - wy), e = Math.max(0, dc - rc);
        if (e > M) continue;
        // schon nachgezogen (eigenes Via/Pad/Ecke darauf) oder eine eigene Bahn läuft hindurch: dieselbe Stelle, das Eigene gilt
        if (ownPts.some(o => Math.hypot(o.x - p[0], o.y - p[1]) <= Math.max((o.d || 0) / 2, rc))) continue;
        if (own.some(([o, a, b]) => distSeg(p[0], p[1], a.x, a.y, b.x, b.y) <= rc)) continue;
        if (C.some(c => c.pt.kind === 'pvia' && Math.hypot(c.pt.x - p[0], c.pt.y - p[1]) <= rc)) continue;   // dasselbe Via vom anderen Foto
        C.push({ e, dc, pt: { x: p[0], y: p[1], kind: 'pvia', d: 2 * rc, other: side !== img } });
      }
    }
  }
  if (!C.length) return null;
  C.sort((a, b) => a.e - b.e || a.dc - b.dc);
  if (C.length > 1 && C[1].e - C[0].e < 0.5 * R) return null;   // nicht eindeutig: frei
  return C[0].pt;
}
// mit Nachprüfung eines Foto-Vias vom anderen Foto; blob: zusätzlich Rundes im Foto (Lötauge/Pad, nur Werkzeug Pad)
export async function trSnap(wx, wy, R, excl?: string, blob = false) {
  let s = trSnapSync(wx, wy, R, excl);
  const img = imgOf(activeLayer());
  if (s && s.other) {   // Via vom anderen Foto: nur wenn es auch auf diesem Foto rund zu sehen ist; Mitte und Größe von hier
    const rd = s.d / 2 / VIA_CU, [u, v] = fromBoard(img, s.x, s.y), hit = S.proj.sides[img] ? await snapRaw(img, u, v, Math.max(R, rd)) : null;
    if (hit && hit.r >= 0.5 * rd && Math.hypot(hit.x - u, hit.y - v) <= Math.max(R, rd)) {
      const [x, y] = toBoard(img, hit.x, hit.y), q = toBoard(img, hit.x + hit.r, hit.y);
      return { x, y, kind: 'pvia', d: 2 * VIA_CU * Math.hypot(q[0] - x, q[1] - y) };
    }
    s = trSnapSync(wx, wy, R, excl, false);
  }
  if (s) return s;
  if (blob && !fangOff()) {
    const [u, v] = fromBoard(img, wx, wy), Rb = Math.max(R, 0.3 * viaD(img)), hit = S.proj.sides[img] ? await snapRaw(img, u, v, Rb) : null;
    if (hit && Math.hypot(hit.x - u, hit.y - v) <= Rb && hit.r >= 0.33 * viaD(img)) { const [x, y] = toBoard(img, hit.x, hit.y); return { x, y, kind: 'blob' }; }
  }
  return { x: wx, y: wy, kind: 'free' };
}
// Fang für die Lupe (s = Lupenmaßstab): im Werkzeug Pad auch Rundes im Foto
const snapFn = (w, _R, s) => trSnap(w[0], w[1], fangR(s), route() ? route().last : undefined, TR.tool === 'pad' && !route());

// ---- Winkel (Platinenkoordinaten): frei mit Einrasten nahe 0/45/90°; 45°-Modus: gerades Stück, dann 45° (/ dreht die Reihenfolge)
export function angleFix(A: Pt, P: Pt, cap = Infinity): Pt {
  const dx = P[0] - A[0], dy = P[1] - A[1];
  if (Math.hypot(dx, dy) < 1e-6) return P;
  const q = Math.PI / 4, th = Math.atan2(dy, dx), k = Math.round(th / q);
  if (Math.abs(th - k * q) > ANG_SNAP * Math.PI / 180) return P;
  const c = Math.cos(k * q), s = Math.sin(k * q), t = dx * c + dy * s;
  if (Math.abs(dx * s - dy * c) > cap) return P;   // Ecke würde zu weit vom Finger wandern (von der Kupferbahn herunter)
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
  if (pt.kind === 'free') { const R = route(); P = angleFix(A, P, Math.max(R ? 0.75 * R.w : 0, 4 / S.cams.main.s)); }
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
// Ziel in einen Punkt verwandeln: { id, end } (end: die Bahn endet hier: eigener Punkt, Segment, Via). Foto-Via und freie Stelle: neue Ecke
function resolve(e, pt, L): { id: string; end: boolean } {
  if (pt.id && isPt(objById(pt.id))) return { id: pt.id, end: true };
  if (pt.kind === 'seg') return { id: splitSeg(e, pt.id, pt.x, pt.y), end: true };
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
      const pa = edit(e => e.mod(n.id, o => { o.t = 'via'; o.L = '*'; o.d = viaCu(o.img); o.dv = 2; }));
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
export function toggleFang() {
  const lk = lookState(); lk.nofang = !lk.nofang;
  toast(lk.nofang ? 'Fang aus: Punkte bleiben am Fadenkreuz' : 'Fang an', 1400);
  if (S.loupe) { S.loupe.job = null; S.preview = null; }
  if (TR.hover) trHover(TR.hover.x, TR.hover.y);
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
  const fo = !!lookState().nofang;
  $('#tFang').classList.toggle('off', fo); $('#tFang').setAttribute('aria-pressed', String(!fo));
  $('#tFang').setAttribute('aria-label', fo ? 'Einrasten aus' : 'Einrasten an');
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
  $('#tFang').onclick = () => toggleFang();
  // Desktop: Umschalt halten = vorübergehend ohne Fang (wie in vielen CAD-Programmen); Vorschau am Mauszeiger sofort neu
  const sh = (on: boolean) => { if (TR.shift === on) return; TR.shift = on; if (TR.hover) trHover(TR.hover.x, TR.hover.y); };
  addEventListener('keydown', e => { if (e.key === 'Shift') sh(true); });
  addEventListener('keyup', e => { if (e.key === 'Shift') sh(false); });
  addEventListener('blur', () => sh(false));
  $('#vTrEye').onclick = () => setTrHidden(!lookState().hideTr);
  $('#vNN').addEventListener('click', () => { const lk = lookState(); if (lk.hideTr) return; lk.hideNN = !lk.hideNN; updateViewUI(); dirty(); saveSoon(); });
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
    if (TR.tool === 'pad' && !route()) { const w = s2w(cam, g.pane, x, y); queue(async () => placePad(await trSnap(w[0], w[1], fangR(cam.s), undefined, true))); return; }
    if (tapStartAgain(x, y)) { TR.lastClick = null; return; }
    TR.lastClick = { t: now, x, y };
    if (lc && now - lc.t < 400 && Math.hypot(x - lc.x, y - lc.y) < 8) { TR.lastClick = null; queue(() => trFinish()); return; }
    const w = s2w(cam, g.pane, x, y), R = fangR(cam.s);
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
    // kurzer Tipp direkt neben der letzten Ecke: erster Tipp eines Doppeltipps, kein Mini-Stück
    const R0 = route(), P0 = R0 && objById(R0.last);
    if (P0) { const q = w2s(cam, g.pane, P0.x, P0.y); if (Math.hypot(q[0] - g.x0, q[1] - g.y0) < 16) return; }
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
  const cam = S.cams.main, w = s2w(cam, S.panes[0], x, y), R = fangR(cam.s), excl = route() ? route().last : undefined;
  TR.hover = { x, y, w };   // auch außerhalb des Modus gemerkt: X beginnt am Mauszeiger
  if (!trActive()) { if (TR.hoverPt) { TR.hoverPt = null; dirty(); } return; }
  TR.hoverPt = trSnapSync(w[0], w[1], R, excl) || { x: w[0], y: w[1], kind: 'free' };
  const job = ++TR.hoverJob;
  if (TR.hoverPt.other) setTimeout(() => {
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
    if (!route() && TR.hover) { const h = TR.hover; queue(async () => { const pt = await trSnap(h.w[0], h.w[1], fangR(S.cams.main.s)); trStart(pt); }); }
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
// Fang-Vorschau: Ring um das Ziel, in der Lupe zusätzlich eine Linie vom Fadenkreuz zur Mitte (wohin der Punkt springt);
// in der Lupe bei „Fang aus“ ein Hinweis unten. Auch beim Ziehen eines Punkts (trEdit.ts)
export function snapMark(pane, cam, T) {
  if (pane.loupe && fangOff()) {
    octx.font = '600 11px system-ui,sans-serif'; octx.textBaseline = 'middle'; octx.textAlign = 'left';
    octx.fillStyle = 'rgba(0,0,0,.7)'; octx.fillRect(pane.x + 2, pane.y + pane.h - 18, 54, 16);
    octx.fillStyle = '#fff'; octx.fillText('Fang aus', pane.x + 6, pane.y + pane.h - 10);
  }
  if (!T || T.kind === 'free') return;
  const s = w2s(cam, pane, T.x, T.y), o = objById(T.id), r = T.kind === 'pvia' ? T.d / 2 : o && (o.t === 'via' || o.t === 'pad') ? (o.d || 20) / 2 : T.kind === 'blob' ? 10 : 6;
  const rad = Math.max(pane.loupe ? 6 : 8, r * cam.s + 3);
  octx.save();
  if (pane.loupe) {
    const cx = pane.x + pane.w / 2, cy = pane.y + pane.h / 2, d = Math.hypot(s[0] - cx, s[1] - cy);
    if (d > rad * 0.3 + 2) {
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.55)'; octx.beginPath(); octx.moveTo(cx, cy); octx.lineTo(s[0], s[1]); octx.stroke();
      octx.lineWidth = 1.5; octx.strokeStyle = '#ffe14d'; octx.beginPath(); octx.moveTo(cx, cy); octx.lineTo(s[0], s[1]); octx.stroke();
    }
  }
  octx.setLineDash(T.kind === 'blob' ? [4, 3] : []);
  octx.lineWidth = 3.5; octx.strokeStyle = 'rgba(0,0,0,.6)'; octx.beginPath(); octx.arc(s[0], s[1], rad, 0, 7); octx.stroke();
  octx.lineWidth = 2; octx.strokeStyle = pane.loupe ? '#ffe14d' : '#fff'; octx.beginPath(); octx.arc(s[0], s[1], rad, 0, 7); octx.stroke();
  octx.setLineDash([]);
  octx.fillStyle = pane.loupe ? '#ffe14d' : '#fff'; octx.beginPath(); octx.arc(s[0], s[1], 2, 0, 7); octx.fill();
  octx.restore();
}
function padLabel(t, x, y, a) {
  octx.font = '600 12px system-ui,sans-serif'; octx.textBaseline = 'middle';
  const w = octx.measureText(t).width;
  octx.globalAlpha = Math.max(0.35, a);
  octx.fillStyle = 'rgba(0,0,0,.72)'; octx.fillRect(x, y - 9, w + 8, 18);
  octx.fillStyle = '#fff'; octx.fillText(t, x + 4, y);
  octx.globalAlpha = 1;
  return [x, y - 9, x + w + 8, y + 9];
}
// ---- Netznamen entlang der Bahnen (wie KiCad): benannte Netze, Text in Bahnrichtung (am Bildschirm berechnet, darum auch bei
// gedrehter/gespiegelter Ansicht lesbar), ab etwa 2,5 px Bahnbreite am Bildschirm, nur auf Stücken, die lang genug sind; lange Stücke
// alle ~NN_REP px wiederholt. Längste Stücke zuerst; ein Name, der einen anderen (oder einen Pad-Namen) überdecken würde, entfällt,
// ebenso derselbe Name näher als NN_GAP px. Unbenannte Netze bekommen keinen Namen („Netz 7“ sagt am Foto nichts).
const NN_REP = 340, NN_GAP = 200, twCache = new Map<string, number>();
// Strecke P–Q auf das Rechteck beschneiden (Liang–Barsky); null = außerhalb
function clipSeg(P, Q, x0, y0, x1, y1): [number[], number[]] | null {
  const dx = Q[0] - P[0], dy = Q[1] - P[1];
  let t0 = 0, t1 = 1;
  for (const [p, q] of [[-dx, P[0] - x0], [dx, x1 - P[0]], [-dy, P[1] - y0], [dy, y1 - P[1]]]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[P[0] + t0 * dx, P[1] + t0 * dy], [P[0] + t1 * dx, P[1] + t1 * dy]];
}
function drawNetNames(pane, cam, taken: number[][]) {
  if (lookState().hideNN) return;
  const hn = hiNet(), sh = layerShares(), act = activeLayer(), X0 = pane.x, Y0 = pane.y, X1 = pane.x + pane.w, Y1 = pane.y + pane.h, items = [];
  for (const c of trNets()) {
    if (!c.name) continue;
    for (const sid of c.segs) {
      const o = objById(sid), a = o && objById(o.a), b = o && objById(o.b);
      if (!a || !b || o.w * cam.s < 2.5) continue;
      const inHi = hn && hn.segs.has(o.id);
      let wt = inHi ? 1 : objWeight(o, sh);
      if (hn && !inHi) wt *= HI_DIM;
      if (wt < 0.15) continue;
      const P = w2s(cam, pane, a.x, a.y), Q = w2s(cam, pane, b.x, b.y), cl = clipSeg(P, Q, X0 + 4, Y0 + 4, X1 - 4, Y1 - 4);
      if (!cl) continue;   // nur der sichtbare Teil zählt (lange Bahnen über den Rand hinaus bekommen ihren Namen im Bild)
      const [A, B] = cl, len = Math.hypot(B[0] - A[0], B[1] - A[1]);
      if (len < 40) continue;
      items.push({ name: c.name, A, B, len, wt, fs: Math.max(11, Math.min(14, o.w * cam.s * 0.8)), pri: (o.L === act ? 1 : 0) + (inHi ? 2 : 0) });
    }
  }
  if (!items.length) return;
  items.sort((p, q) => q.pri - p.pri || q.len - p.len);
  const done: any[] = [], hit = (r, q) => r[0] < q[2] && r[2] > q[0] && r[1] < q[3] && r[3] > q[1];
  octx.save();
  octx.textAlign = 'center'; octx.textBaseline = 'middle'; octx.lineJoin = 'round';
  for (const it of items) {
    const font = '600 ' + it.fs.toFixed(1) + 'px system-ui,sans-serif', key = it.fs.toFixed(1) + '|' + it.name;
    let tw = twCache.get(key);
    if (tw == null) { octx.font = font; tw = octx.measureText(it.name).width; if (twCache.size > 500) twCache.clear(); twCache.set(key, tw); }
    if (it.len < tw + 2 * it.fs) continue;
    let ang = Math.atan2(it.B[1] - it.A[1], it.B[0] - it.A[0]);
    if (ang > Math.PI / 2 + 1e-3) ang -= Math.PI; else if (ang < -Math.PI / 2 - 1e-3) ang += Math.PI;   // nie kopfüber
    const n = Math.max(1, Math.floor(it.len / NN_REP)), c = Math.cos(ang), s = Math.sin(ang), hw = tw / 2 + 4, hh = it.fs / 2 + 2;
    const ex = Math.abs(c) * hw + Math.abs(s) * hh, ey = Math.abs(s) * hw + Math.abs(c) * hh;
    for (let k = 0; k < n; k++) {
      const t = (k + 0.5) / n, x = it.A[0] + (it.B[0] - it.A[0]) * t, y = it.A[1] + (it.B[1] - it.A[1]) * t;
      if (x - ex < X0 || x + ex > X1 || y - ey < Y0 || y + ey > Y1) continue;
      const r = [x - ex, y - ey, x + ex, y + ey];
      if (taken.some(q => hit(r, q)) || done.some(d => hit(r, d.r) || (d.name === it.name && Math.hypot(d.x - x, d.y - y) < NN_GAP))) continue;
      done.push({ r, name: it.name, x, y }); taken.push(r);
      octx.setTransform(DPR * c, DPR * s, -DPR * s, DPR * c, DPR * x, DPR * y);
      octx.font = font; octx.globalAlpha = it.wt;
      octx.lineWidth = 3; octx.strokeStyle = 'rgba(0,0,0,.8)'; octx.strokeText(it.name, 0, 0.5);
      octx.fillStyle = '#fff'; octx.fillText(it.name, 0, 0.5);
    }
  }
  octx.restore();
}
export function drawTrace(pane, cam) {
  if (!trShown()) return;
  const hn = hiNet(), sel = pickId(), lc = layers(), cTop = layerColor(lc.length ? lc[0].id : 'front'), cBot = layerColor(lc.length ? lc[lc.length - 1].id : 'back');
  const sh = layerShares(), W = pane.x + pane.w, H = pane.y + pane.h;
  octx.save();
  const labels = [];   // belegte Flächen der Pad-Namen (Netznamen weichen aus)
  // Vias in Kupferring-Größe: Ring in beiden Lagenfarben (Halbkreise), Bohrung angedeutet, dünne Kontur; am Bildschirm mindestens
  // 3 px Radius (Übersicht), Bohrung erst ab 5 px. Pads: Quadrat in Lagenfarbe
  for (const o of objList()) {
    if (o.t !== 'via' && o.t !== 'pad') continue;
    const s = w2s(cam, pane, o.x, o.y), r = Math.max(3, (o.d || (o.t === 'via' ? viaCu(o.img) : padD(o.img))) / 2 * cam.s);
    if (s[0] < pane.x - r || s[0] > W + r || s[1] < pane.y - r || s[1] > H + r) continue;
    const inHi = hn && hn.pts.has(o.id);
    let a = inHi ? 1 : o.t === 'pad' ? objWeight(o, sh) : 1;
    if (!a) continue;
    if (hn && !inHi) a *= HI_DIM;
    octx.globalAlpha = a * (pane.loupe ? 0.55 : 0.85);
    if (o.t === 'via') {
      octx.fillStyle = cTop; octx.beginPath(); octx.arc(s[0], s[1], r, Math.PI, 2 * Math.PI); octx.fill();
      octx.fillStyle = cBot; octx.beginPath(); octx.arc(s[0], s[1], r, 0, Math.PI); octx.fill();
      if (r >= 5) { octx.fillStyle = '#101317'; octx.beginPath(); octx.arc(s[0], s[1], r * VIA_DRILL, 0, 7); octx.fill(); }
      octx.globalAlpha = a * 0.6; octx.lineWidth = 1; octx.strokeStyle = '#000'; octx.beginPath(); octx.arc(s[0], s[1], r + 0.5, 0, 7); octx.stroke();
    } else {
      octx.fillStyle = o.L === '*' ? cTop : layerColor(o.L); octx.fillRect(s[0] - r, s[1] - r, 2 * r, 2 * r);
      if (o.L === '*') { octx.fillStyle = cBot; octx.fillRect(s[0] - r, s[1], 2 * r, r); octx.fillStyle = '#101317'; octx.beginPath(); octx.arc(s[0], s[1], r * 0.36, 0, 7); octx.fill(); }   // durchgehend: beide Lagenfarben, Loch
      octx.lineWidth = 1; octx.strokeStyle = 'rgba(0,0,0,.7)'; octx.strokeRect(s[0] - r, s[1] - r, 2 * r, 2 * r);
    }
    if (o.t === 'pad' && o.name && !pane.loupe && r >= 5) labels.push(padLabel(o.name, s[0] + r + 4, s[1] - r - 6, a));   // rechts oberhalb: die Bahn am Pad bleibt frei
    if (o.id === sel || (inHi && !pane.loupe)) {
      octx.globalAlpha = 1; octx.lineWidth = 2; octx.strokeStyle = '#fff'; octx.beginPath();
      if (o.t === 'pad') octx.rect(s[0] - r - 3, s[1] - r - 3, 2 * r + 6, 2 * r + 6); else octx.arc(s[0], s[1], r + 3, 0, 7);
      octx.stroke();
    }
  }
  octx.globalAlpha = 1;
  if (!pane.loupe) drawNetNames(pane, cam, labels);
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
  if (T && (A || trActive())) snapMark(pane, cam, T);
  octx.restore();
}
