import { loupeMove, loupeSnap, loupeStart } from '../align/loupe';
import { edit, toastUndo } from './edit';
import { buildMenu } from './menu';
import { netLabel, netOf, segsOf } from './nets';
import { closeNote, onVV, placeNote } from './note';
import { TR_PT, TR_TYPES, anchorFrom, clone, newId, objBump, objById, objMap, pickId, r1 } from './objects';
import {
  TR, TW_F, TW_NAME, VS_F, snapMark, VS_NAME, fangR, fine, imgOf, newPt, other, padD, queue, route, splitSeg, trFinish, trHit, trStart, trSelect, trShown, trSnap, trSnapSync, updateTrUI, viaCu, viaD,
} from './trace';
import { setActive } from '../layers/actions';
import { activeLayer, layerById, layerColor, layerName, layerShort, layers } from '../layers/model';
import { octx } from '../render/gl';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { openNetsFor } from '../ui/netsheet';
import { gest, setGest } from '../ui/pointer';
import { toast } from '../ui/toast';
import { $ } from '../util';
import { s2w, w2s } from '../view/camera';

// ---------------------------------------------------------------- Bahnen bearbeiten (T3) und Pads
// Auswahl wie gehabt über S.pick (eine ID). ED.whole = ID des Segments, dessen ganze Bahn gewählt ist (U, Menü „Bahn“).
// Eine Bahn = Kette von Segmenten auf einer Lage zwischen Via, Pad, Abzweig oder Ende (wie „U“ in KiCad), abgeleitet.
// Griffe am Ausgewählten: ● Ecke/Punkt ziehen (Lupe, Fang wie beim Zeichnen; landet sie auf einem Punkt oder Segment, wird
// verbunden), ○ Segment-Mitte ziehen = parallel verschieben (KiCad „D“: Nachbarstücke behalten ihre Richtung), antippen = neue Ecke.
// Beim Ziehen werden die Objekte direkt verändert (Vorschau); zum Abschluss wird der Ausgangsstand wiederhergestellt und die
// Änderung als ein edit()-Schritt eingetragen, Rückgängig stellt also exakt wieder her. Abbruch (zweiter Finger, Esc) = Ausgangsstand.
export const ED = { whole: null as string | null, drag: null as any, msnap: null as any };
const isPt = o => !!o && TR_PT.includes(o.t);
export const trBusy = () => !!ED.drag;
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---- Bahn zu einem Segment
export function chainOf(segId) {
  const s = objById(segId), segs = [s], pts = [s.a, s.b];
  for (const start of [s.a, s.b]) {
    let cur = start, prev = s;
    for (let guard = 0; guard < 10000; guard++) {
      const o = objById(cur), all = segsOf(cur);
      if (!o || o.t !== 'node' || all.length !== 2) break;
      const nx = all.find(q => q !== prev);
      if (!nx || nx.L !== s.L || segs.includes(nx)) break;
      segs.push(nx); prev = nx; cur = other(nx, cur);
      if (!pts.includes(cur)) pts.push(cur);
    }
  }
  return { segs, pts };
}
export const selSegs = (): any[] => { const o = objById(pickId()); if (!o || o.t !== 'seg') return []; return ED.whole === o.id ? chainOf(o.id).segs : [o]; };
export function selectBahn(segId) { trSelect(segId); ED.whole = segId; buildMenu(); dirty(); }

// ---- Griffe
export function trHandles() {
  const o = objById(pickId());
  if (!o || !TR_TYPES.includes(o.t) || !trShown() || route() || S.draw) return [];
  const out = [];
  if (o.t === 'seg') {
    const segs = selSegs(), pts = new Set<string>();
    for (const s of segs) { pts.add(s.a); pts.add(s.b); }
    for (const id of pts) { const p = objById(id); if (p) out.push({ k: 'pt', id, x: p.x, y: p.y }); }
    for (const s of segs) { const a = objById(s.a), b = objById(s.b); if (a && b) out.push({ k: 'mid', id: s.id, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, a, b }); }
  } else out.push({ k: 'pt', id: o.id, x: o.x, y: o.y });
  return out;
}
const midShown = (h, cam, pane) => { const A = w2s(cam, pane, h.a.x, h.a.y), B = w2s(cam, pane, h.b.x, h.b.y); return Math.hypot(A[0] - B[0], A[1] - B[1]) >= 40; };
export function handleAt(x, y, mouse) {
  const cam = S.cams.main, pane = S.panes[0], R = mouse ? 9 : 24;
  let best = null, bd = Infinity;
  for (const h of trHandles()) {
    if (h.k === 'mid' && !midShown(h, cam, pane)) continue;
    const s = w2s(cam, pane, h.x, h.y), d = Math.hypot(s[0] - x, s[1] - y) + (h.k === 'mid' ? 4 : 0);
    if (d <= R && d < bd) { bd = d; best = h; }
  }
  return best;
}
export function drawHandles(pane, cam) {
  octx.save();
  if (!pane.loupe) for (const h of trHandles()) {
    const s = w2s(cam, pane, h.x, h.y);
    if (h.k === 'mid') {
      if (!midShown(h, cam, pane)) continue;
      octx.lineWidth = 3.5; octx.strokeStyle = 'rgba(0,0,0,.65)'; octx.beginPath(); octx.arc(s[0], s[1], 6, 0, 7); octx.stroke();
      octx.fillStyle = 'rgba(16,19,23,.75)'; octx.fill();
      octx.lineWidth = 2; octx.strokeStyle = '#fff'; octx.beginPath(); octx.arc(s[0], s[1], 6, 0, 7); octx.stroke();
    } else {
      octx.fillStyle = '#fff'; octx.lineWidth = 2; octx.strokeStyle = 'rgba(0,0,0,.7)';
      octx.beginPath(); octx.arc(s[0], s[1], 6.5, 0, 7); octx.fill(); octx.stroke();
    }
  }
  // Fang beim Ziehen (auch in der Lupe): Finger = Fang der Lupe, Maus = Fang am Zeiger
  const D = ED.drag;
  if (D && D.h.k === 'pt') {
    const pv = S.preview, pt = D.mouse ? ED.msnap : pv && pv.pane === 'main' && S.loupe && pv.at[0] === S.loupe.x && pv.at[1] === S.loupe.y ? pv.pt : null;
    snapMark(pane, cam, pt);
  }
  octx.restore();
}

// ---- Vorschau beim Ziehen: Ausgangsstand je berührter ID (null = neu angelegt)
function liveTouch(D, id) { if (!D.snap.has(id)) D.snap.set(id, clone(objMap()[id])); }
function liveRestore(D) {
  const m = objMap();
  for (const [id, b] of D.snap) { if (b == null) delete m[id]; else m[id] = b; }
  D.snap.clear(); objBump();
}
// Abschluss: Endstand merken, Ausgangsstand zurück, Endstand (plus extra) als ein Rückgängig-Schritt
function liveCommit(D, extra?: (e) => void) {
  const m = objMap(), fin = new Map<string, any>();
  for (const id of D.snap.keys()) fin.set(id, clone(m[id]));
  liveRestore(D);
  return edit(e => {
    for (const [id, f] of fin) { if (f == null) { if (m[id]) e.del(id); } else { if (isPt(f)) anchorFrom(f); e.put(f); } }
    if (extra) extra(e);
  });
}

// Parallel verschieben: je Ende frei (loses Ende), gleitend (genau ein Nachbarstück: neuer Punkt auf dessen Linie) oder
// mit neuer Ecke (Via, Pad, Abzweig: der Punkt bleibt, ein kurzes Stück verbindet)
function midPlan(segId) {
  const s = objById(segId), A = objById(s.a), B = objById(s.b);
  const dx = B.x - A.x, dy = B.y - A.y, l = Math.hypot(dx, dy) || 1, d = [dx / l, dy / l], n = [-d[1], d[0]];
  const ends = [s.a, s.b].map(pid => {
    const P = objById(pid), others = segsOf(pid).filter(q => q.id !== s.id), base = [P.x, P.y];
    if (P.t === 'node' && others.length === 0) return { mode: 'free', id: pid, base };
    if (P.t === 'node' && others.length === 1 && others[0].L === s.L) {
      const Q = objById(other(others[0], pid)), ex = P.x - Q.x, ey = P.y - Q.y, el = Math.hypot(ex, ey);
      if (el > 1e-6 && Math.abs(d[0] * ey - d[1] * ex) / el > 0.26) return { mode: 'slide', id: pid, base, Q: [Q.x, Q.y], e: [ex / el, ey / el] };
    }
    return { mode: 'insert', id: pid, base, nid: null };
  });
  return { seg: segId, d, n, ends };
}
function midApply(D, t) {
  const m = objMap(), pl = D.plan, s = m[pl.seg];
  for (const E of pl.ends) {
    let X = [E.base[0] + t * pl.n[0], E.base[1] + t * pl.n[1]];
    if (E.mode === 'slide') {   // Schnitt der verschobenen Linie mit der Linie des Nachbarstücks
      const rx = X[0] - E.Q[0], ry = X[1] - E.Q[1], den = E.e[0] * pl.d[1] - E.e[1] * pl.d[0];
      if (Math.abs(den) > 1e-6) { const mu = (rx * pl.d[1] - ry * pl.d[0]) / den; if (mu > 0) X = [E.Q[0] + mu * E.e[0], E.Q[1] + mu * E.e[1]]; }
    }
    let id = E.id;
    if (E.mode === 'insert') {
      if (!E.nid) {
        if (Math.abs(t) < 1e-3) continue;
        const n = newPt('node', s.L, E.base[0], E.base[1]), sg = { id: newId(), t: 'seg', L: s.L, a: E.id, b: n.id, w: s.w };
        liveTouch(D, n.id); liveTouch(D, sg.id); liveTouch(D, s.id);
        m[n.id] = n; m[sg.id] = sg as any;
        if (s.a === E.id) s.a = n.id; else s.b = n.id;
        E.nid = n.id;
      }
      id = E.nid;
    }
    liveTouch(D, id);
    m[id].x = X[0]; m[id].y = X[1];
  }
  objBump(); dirty();
}

// ---- Ziehen beginnen / nachführen / abschließen (Finger, Maus mit gedrückter Taste, Tasten D/M mit Mauszeiger)
export function dragStart(h, w0, mouse, keys = false) {
  const D: any = { h, w0, mouse, keys, snap: new Map() };
  if (h.k === 'mid') D.plan = midPlan(h.id);
  else { const o = objById(h.id); D.off = [o.x - w0[0], o.y - w0[1]]; }
  ED.drag = D; ED.msnap = null;
  buildMenu(); dirty();
  return D;
}
export function dragTo(w) {
  const D = ED.drag;
  if (!D) return;
  if (D.h.k === 'mid') { midApply(D, (w[0] - D.w0[0]) * D.plan.n[0] + (w[1] - D.w0[1]) * D.plan.n[1]); return; }
  const id = D.h.id, o = objMap()[id];
  if (!o) return;
  const p = [w[0] + D.off[0], w[1] + D.off[1]];
  liveTouch(D, id);
  if (D.mouse) {   // Maus: Fang sofort sichtbar und der Punkt sitzt schon dort
    const pt = trSnapSync(p[0], p[1], fangR(S.cams.main.s), id);
    ED.msnap = pt;
    if (pt && pt.kind !== 'free' && (pt.kind !== 'seg' || !segsOf(id).some(s => s.id === pt.id))) { o.x = pt.x; o.y = pt.y; }
    else { o.x = p[0]; o.y = p[1]; }
  } else { o.x = p[0]; o.y = p[1]; }
  objBump(); dirty();
}
export function dragCancel() {
  const D = ED.drag;
  if (!D) return;
  liveRestore(D); ED.drag = null; ED.msnap = null;
  buildMenu(); dirty();
}
// Punkt absetzen am Fangpunkt pt: auf einem anderen Punkt oder Segment wird verbunden. Ein Foto-Via ist nur Einrastpunkt
// (kein automatisches Via; bewusst über „Via“ im Menü der Ecke)
function commitPt(pt) {
  const D = ED.drag;
  ED.drag = null; ED.msnap = null;
  if (!D) return;
  const id = D.h.id, o0 = D.snap.get(id) || objById(id);
  if (!pt || !objById(id) || (pt.kind === 'free' && o0 && Math.hypot(pt.x - o0.x, pt.y - o0.y) * S.cams.main.s < 1)) { liveRestore(D); buildMenu(); dirty(); return; }
  liveRestore(D);
  const own = segsOf(id).map(s => s.id), tgt = pt.id && pt.id !== id ? objById(pt.id) : null;
  let keep = id;
  edit(e => {
    e.mod(id, o => { o.x = r1(pt.x); o.y = r1(pt.y); anchorFrom(o); });
    if (tgt && isPt(tgt)) keep = mergePts(e, id, tgt.id);
    else if (pt.kind === 'seg' && !own.includes(pt.id) && objById(pt.id)) keep = mergePts(e, id, splitSeg(e, pt.id, pt.x, pt.y));
  });
  if (pickId() !== keep && objById(keep)) trSelect(keep);
  buildMenu(); updateTrUI(); dirty();
}
// zwei Punkte zu einem: eine Ecke geht im anderen Punkt auf (Via/Pad bleiben); Ergebnis = verbleibende ID
function mergePts(e, a, b) {
  const A = objById(a), B = objById(b);
  let keep, gone;
  if (A.t === 'node') { keep = B; gone = A; }
  else if (B.t === 'node') { keep = A; gone = B; e.mod(A.id, o => { o.x = B.x; o.y = B.y; anchorFrom(o); }); }
  else return a;   // Via/Pad auf Via/Pad: nur die Lage
  const ks = segsOf(keep.id);
  for (const s of segsOf(gone.id)) {
    const o2 = other(s, gone.id);
    if (o2 === keep.id || ks.some(q => other(q, keep.id) === o2 && q.L === s.L)) { e.del(s.id); continue; }
    e.mod(s.id, q => { if (q.a === gone.id) q.a = keep.id; else q.b = keep.id; });
  }
  e.del(gone.id);
  return keep.id;
}
function commitMid() {
  const D = ED.drag;
  ED.drag = null; ED.msnap = null;
  if (!D) return;
  const moved = [...D.snap.keys()].some(id => { const b = D.snap.get(id), o = objById(id); return !b || !o || Math.hypot(o.x - b.x, o.y - b.y) * S.cams.main.s > 1; });
  if (!moved) { liveRestore(D); buildMenu(); dirty(); return; }
  liveCommit(D);
  buildMenu(); updateTrUI(); dirty();
}
// Abschluss mit Fang (Maus: am Zeiger; Finger: Lupe)
export function dragFinish(w?) {
  const D = ED.drag;
  if (!D) return;
  if (D.h.k === 'mid') { commitMid(); return; }
  const o = objById(D.h.id), p = w ? [w[0] + D.off[0], w[1] + D.off[1]] : [o.x, o.y];
  queue(async () => { const pt = await trSnap(p[0], p[1], fangR(S.cams.main.s), D.h.id); if (ED.drag === D) commitPt(pt); });
}

// ---- Gesten (aus ui/gestures.ts, vor dem Zeichnen/Nachziehen): Griff unter dem Finger/Mauszeiger?
export function trHandleDown(pane, x, y, mouse) {
  if (!S.proj || S.mode !== 'main' || S.draw || S.note) return false;
  if (ED.drag && ED.drag.keys) {   // Tasten D/M: Klick setzt ab
    if (mouse) { dragFinish(s2w(S.cams.main, pane, x, y)); setGest({ kind: 'none', pane }); return true; }
    dragCancel();
  }
  if (route()) return false;
  const h = handleAt(x, y, mouse);
  if (!h) return false;
  const hs = w2s(S.cams.main, pane, h.x, h.y);
  setGest({ kind: 'trh', pane, moved: false, x0: x, y0: y, t0: performance.now(), h, mouse, hs });
  if (!mouse) loupeStart(pane, x, y, hs[0], hs[1], false, h.k === 'mid', h.k === 'pt' ? (w, _R, sc) => trSnap(w[0], w[1], fangR(sc), h.id) : undefined);
  return true;
}
export function trhMove(x, y) {
  const g = gest;
  if (S.loupe && !g.mouse) loupeMove(x, y);
  if (!g.moved) return;
  const cam = S.cams.main;
  if (!ED.drag) dragStart(g.h, s2w(cam, g.pane, g.hs[0], g.hs[1]), g.mouse);
  const L = S.loupe, sx = L && !g.mouse ? L.x : g.hs[0] + x - g.x0, sy = L && !g.mouse ? L.y : g.hs[1] + y - g.y0;
  dragTo(s2w(cam, g.pane, sx, sy));
}
export function trhEnd(g, cancel) {
  const L = S.loupe;
  S.loupe = null; S.preview = null;
  if (L) clearTimeout(L.timer);
  if (cancel) { dragCancel(); return; }
  if (!ED.drag) {   // Tipp: auf die Mitte = neue Ecke; im Werkzeug Bahn auf Via, Pad oder freies Ende = dort weiterziehen; sonst Punkt auswählen
    const o = objById(g.h.id);
    if (g.h.k === 'mid') insertCorner(g.h.id);
    else if (S.tr && o && (o.t !== 'node' || segsOf(o.id).length <= 1)) queue(() => trStart({ x: o.x, y: o.y, kind: o.t, id: o.id }));
    else if (pickId() !== g.h.id) trSelect(g.h.id);
    dirty(); return;
  }
  const D = ED.drag;
  if (D.h.k === 'mid') { commitMid(); return; }
  if (g.mouse) { dragFinish(); return; }
  const p = L ? loupeSnap(L, true) : null;
  queue(async () => { const pt = p ? await p : null; if (ED.drag === D) { if (pt) commitPt(pt); else dragCancel(); } });
}

// ---- Bearbeiten
export function insertCorner(segId) {
  const s = objById(segId), A = s && objById(s.a), B = s && objById(s.b);
  if (!A || !B) return;
  let nid = null;
  edit(e => { nid = splitSeg(e, segId, (A.x + B.x) / 2, (A.y + B.y) / 2); });
  trSelect(nid);
  toast(fine() ? 'Neue Ecke, jetzt ziehen' : 'Neue Ecke, Punkt jetzt ziehen', 1600);
}
function delSegs(e, segs, except?: string) {
  const gone = new Set(segs.map(s => s.id));
  for (const s of segs) e.del(s.id);
  for (const s of segs) for (const p of [s.a, s.b]) {
    const q = objById(p);
    if (q && q.t === 'node' && p !== except && segsOf(p).every(x => gone.has(x.id))) e.del(p);
  }
}
// Löschen: Segment bzw. ganze Bahn (ED.whole); Ecke mit zwei Stücken = die Stücke werden eines; Via/Pad: die Bahnen bleiben
// (enden dort an einer Ecke je Lage); andere Punkte samt ihren Stücken
export function trDelete(id) {
  const o = objById(id);
  if (!o) return;
  const whole = o.t === 'seg' && ED.whole === id;
  edit(e => {
    if (o.t === 'seg') { delSegs(e, whole ? chainOf(id).segs : [o]); return; }
    const ss = segsOf(id);
    if (o.t === 'node') {
      if (ss.length === 2 && ss[0].L === ss[1].L) {
        const [s1, s2] = ss, A = other(s1, id), B = other(s2, id);
        e.del(s2.id); e.del(id);
        if (A === B || segsOf(A).some(q => q !== s1 && q !== s2 && other(q, A) === B && q.L === s1.L)) delSegs(e, [s1], undefined);
        else e.mod(s1.id, q => { if (q.a === id) q.a = B; else q.b = B; });
      } else { delSegs(e, ss, id); e.del(id); }
      return;
    }
    const byL = new Map<string, any>();
    for (const s of ss) {
      let n = byL.get(s.L);
      if (!n) { n = newPt('node', s.L, o.x, o.y); e.put(n); byL.set(s.L, n); }
      e.mod(s.id, q => { if (q.a === id) q.a = n.id; else q.b = n.id; });
    }
    e.del(id);
  });
  if (ED.whole === id) ED.whole = null;
  if (route() && !objById(route().last)) S.proj.route = null;
  buildMenu(); updateTrUI(); dirty();
}
// Breite der Auswahl weiterschalten (Schmal → Normal → Breit), bezogen auf die Via-Größe des Fotos
export function cycleSelWidth() {
  const segs = selSegs();
  if (!segs.length) return;
  const base = s => 0.27 * viaD(imgOf(s.L)), f = segs[0].w / base(segs[0]);
  let i = 0;
  TW_F.forEach((v, k) => { if (Math.abs(v - f) < Math.abs(TW_F[i] - f)) i = k; });
  const ni = (i + 1) % TW_F.length;
  edit(e => { for (const s of segs) e.mod(s.id, q => { q.w = r1(TW_F[ni] * base(q)); }); });
  buildMenu(); toast('Breite: ' + TW_NAME[ni], 1200);
}
export const widthIdx = s => { const f = s.w / (0.27 * viaD(imgOf(s.L))); let i = 0; TW_F.forEach((v, k) => { if (Math.abs(v - f) < Math.abs(TW_F[i] - f)) i = k; }); return i; };
// ganze Bahn auf eine andere Lage legen. Enden mit weiteren Stücken auf der alten Lage werden zu Vias: dort wechselt die Verbindung
// die Lage, ohne Via wäre sie elektrisch falsch (oder müsste aufgetrennt werden). Die Meldung nennt die Zahl, Rückgängig nimmt alles zurück.
export function bahnToLayer(segId, L) {
  const s = objById(segId);
  if (!s || s.L === L) return;
  const ch = chainOf(segId), set = new Set(ch.segs.map(q => q.id));
  let nv = 0;
  edit(e => {
    for (const q of ch.segs) e.mod(q.id, x => { x.L = L; });
    for (const pid of ch.pts) {
      const P = objById(pid);
      if (!P || P.t !== 'node') continue;
      if (segsOf(pid).every(q => set.has(q.id))) e.mod(pid, o => { o.L = L; o.img = imgOf(L); anchorFrom(o); });
      else { nv++; e.mod(pid, o => { o.t = 'via'; o.L = '*'; o.d = viaCu(o.img); o.dv = 2; }); }
    }
  });
  setActive(L);
  selectBahn(segId);
  const nl = layerById(L);
  toastUndo('Auf ' + (nl ? layerName(nl) : L) + ' gelegt' + (nv ? ' · ' + (nv === 1 ? 'Via' : nv + ' Vias') + ' am Abzweig' : ''));
}
// Ecke bewusst zum Via machen (Menü „Via“): Größe = Vorgabe (Stufe look.vs)
export function nodeToVia(id) {
  const n = objById(id);
  if (!n || n.t !== 'node') return;
  edit(e => e.mod(id, o => { o.t = 'via'; o.L = '*'; o.d = viaCu(o.img); o.dv = 2; }));
  trSelect(id); updateTrUI();
  toastUndo('Via gesetzt');
}
// Via-Größe der Auswahl weiterschalten (Klein → Normal → Groß); die gewählte Stufe gilt auch für neue Vias
export const viaSizeIdx = o => { const f = (o.d || 0) / viaCu(o.img, 1); let i = 0; VS_F.forEach((v, k) => { if (Math.abs(v - f) < Math.abs(VS_F[i] - f)) i = k; }); return i; };
export function cycleViaSize(id) {
  const o = objById(id);
  if (!o || o.t !== 'via') return;
  const ni = (viaSizeIdx(o) + 1) % VS_F.length;
  lookState().vs = ni;
  edit(e => e.mod(id, q => { q.d = viaCu(q.img, ni); q.dv = 2; }));
  buildMenu(); toast('Via: ' + VS_NAME[ni] + ' (auch für neue)', 1400);
}
const nextLayer = L => { const ls = layers(), i = ls.findIndex(x => x.id === L); return ls.length ? ls[(i + 1) % ls.length].id : L; };

// ---- Pads: Werkzeug „Pad“ (Desktop P). Pad = benannter Endpunkt, Quadrat in Via-Größe; Lage = aktive Lage, auf einem
// Lötauge/Via „durchgehend“ ('*'). Auf einer eigenen Ecke/einem Via wird dieser Punkt zum Pad, auf einem Segment entsteht es darin.
export function setPadTool(on) {
  TR.tool = on ? 'pad' : 'bahn';
  if (on) toast(fine() ? 'Klick setzt ein Pad' : 'Tippe, wo das Pad hin soll', 2500);
  updateTrUI(); dirty();
}
export function placePad(pt) {
  TR.tool = 'bahn';
  if (!pt) { updateTrUI(); return; }
  const tgt = pt.id ? objById(pt.id) : null;
  if (tgt && tgt.t === 'pad') { trSelect(tgt.id); renamePad(tgt.id); updateTrUI(); return; }
  let id = null;
  edit(e => {
    if (tgt && (tgt.t === 'node' || tgt.t === 'via')) { id = tgt.id; e.mod(id, o => { o.d = r1(o.t === 'via' && o.d ? o.d : padD(o.img)); o.t = 'pad'; o.name = ''; o.dv = 2; }); return; }
    if (pt.kind === 'seg' && objById(pt.id)) { id = splitSeg(e, pt.id, pt.x, pt.y); e.mod(id, o => { o.t = 'pad'; o.name = ''; o.d = padD(o.img); o.dv = 2; }); return; }
    const L = pt.kind === 'pvia' ? '*' : activeLayer(), p = newPt('pad', L, pt.x, pt.y, { name: '', dv: 2 });
    p.d = r1(pt.kind === 'pvia' ? pt.d : padD(p.img));
    e.put(p); id = p.id;
  });
  trSelect(id);
  renamePad(id, true);
  updateTrUI();
}
export function renamePad(id, isNew = false) {
  const o = objById(id);
  if (!o) return;
  openLine(o.name || '', isNew ? 'Pad-Name, z. B. U3.12' : 'Pad-Name', v => { const p = objById(id); if (p && (p.name || '') !== v) edit(e => e.mod(id, q => { q.name = v; })); });
}
function padLayer(id) {
  const o = objById(id), ls = layers().map(L => L.id).concat('*'), i = ls.indexOf(o.L), L = ls[(i + 1) % ls.length];
  edit(e => e.mod(id, q => { q.L = L; if (L !== '*' && S.proj.sides[L]) { q.img = L; anchorFrom(q); } }));
  if (L !== '*') setActive(L);
  trSelect(id);
  toast(L === '*' ? 'Pad: durchgehend' : 'Pad: ' + layerName(layerById(L)), 1400);
}

// ---- Eingabezeile (unten, über der Tastatur) für Namen und Notizen; fn(Wert) beim Schließen
export function openLine(value, placeholder, fn) {
  if (S.note) closeNote();
  S.note = { fn, isNew: false };
  const ta = $('#noteTx'); ta.value = value; ta.placeholder = placeholder;
  $('#noteEd').hidden = false; buildMenu(); placeNote();
  const v = window.visualViewport;
  if (v) { S.note.vv = v; v.addEventListener('resize', onVV); v.addEventListener('scroll', onVV); }
  try { ta.focus({ preventScroll: true }); } catch { ta.focus(); }
}

// ---- Menü am Bahnobjekt (aus draw/menu.ts): btn(html, fn, cls?, label?)
export function trMenu(o, btn) {
  const c = netOf(o.id);
  const net = () => { if (c && c.segs.length) btn(esc(netLabel(c)) + ' ›', () => openNetsFor(o.id), 'mnet', 'Netz ' + netLabel(c) + ' (Name, Notiz, gemessen)'); };
  const lay = (L, fn) => { const lo = layerById(L); btn(`<i class="sw" style="--lc:${L === '*' ? '#c8ccd2' : layerColor(L)}"></i>${L === '*' ? 'Durch' : lo ? layerShort(lo) : L}`, fn, 'mlay', 'Lage: ' + (L === '*' ? 'durchgehend' : lo ? layerName(lo) : L)); };
  if (o.t === 'pad') {
    btn(o.name ? esc(o.name) : 'Name', () => renamePad(o.id), '', 'Pad benennen');
    net();
    lay(o.L, () => padLayer(o.id));
    btn('Löschen', () => { trDelete(o.id); toastUndo('Gelöscht'); }, 'del');
    return;
  }
  net();
  if (o.t === 'node') btn('Via', () => nodeToVia(o.id), '', 'Hier ein Via setzen');
  if (o.t === 'via') { const i = viaSizeIdx(o); btn(`<i class="vd" style="--vd:${[8, 11, 14][i]}px"></i>${VS_NAME[i]}`, () => cycleViaSize(o.id), '', 'Via-Größe: ' + VS_NAME[i]); }
  if (o.t === 'seg') {
    const i = widthIdx(selSegs()[0] || o);
    btn(`<i class="tw" style="height:${[2, 4, 7][i]}px"></i>Breite`, () => cycleSelWidth(), '', 'Breite: ' + TW_NAME[i]);
    if (layers().length > 1) lay(o.L, () => bahnToLayer(o.id, nextLayer(o.L)));
    btn('Bahn', () => { if (ED.whole === o.id) { ED.whole = null; buildMenu(); dirty(); } else selectBahn(o.id); }, ED.whole === o.id ? 'on' : '', 'Ganze Bahn auswählen').setAttribute('aria-pressed', String(ED.whole === o.id));
  }
  btn('Löschen', () => { trDelete(o.id); toastUndo('Gelöscht'); }, 'del');
}

// ---- Tasten (aus trace.ts trKey; Desktop): D, M, U, E, P, Esc beim Ziehen
export function edKey(e, k, plain) {
  const hov = TR.hover, cam = S.cams.main, pane = S.panes[0];
  if (ED.drag && ED.drag.keys && k === 'Escape') { e.preventDefault(); dragCancel(); return true; }
  if (!plain || e.repeat || S.draw || route() || !trShown()) return false;
  const under = () => hov ? trHit(hov.x, hov.y) : null, sel = () => { const o = objById(pickId()); return o && TR_TYPES.includes(o.t) ? o : null; };
  const lk = k.toLowerCase();
  if (lk === 'd' || lk === 'm') {
    const o = under() || sel();
    if (!o || !hov) return false;
    e.preventDefault();
    if (pickId() !== o.id) trSelect(o.id);
    const w = s2w(cam, pane, hov.x, hov.y);
    dragStart(o.t === 'seg' ? { k: 'mid', id: o.id } : { k: 'pt', id: o.id, x: o.x, y: o.y }, w, true, true);
    toast(o.t === 'seg' ? 'Bahnstück folgt der Maus, Klick setzt ab' : 'Punkt folgt der Maus, Klick setzt ab', 2000);
    return true;
  }
  if (lk === 'u') {
    const o = under() || sel();
    if (!o || o.t !== 'seg') return false;
    e.preventDefault(); selectBahn(o.id); return true;
  }
  if (lk === 'e') {
    const o = sel() || under();
    if (!o) return false;
    e.preventDefault();
    if (o.t === 'pad') renamePad(o.id); else openNetsFor(o.id);
    return true;
  }
  if (lk === 'p' && hov) {
    e.preventDefault();
    const w = s2w(cam, pane, hov.x, hov.y);
    queue(async () => placePad(await trSnap(w[0], w[1], fangR(cam.s), undefined, true)));
    return true;
  }
  return false;
}
// Mauszeiger beim Ziehen mit D/M
export function edHover(x, y) {
  const D = ED.drag;
  if (!D || !D.keys) return false;
  dragTo(s2w(S.cams.main, S.panes[0], x, y));
  return true;
}
// nach einer Bahn auf ihrer Startstelle: Tipp darauf ohne gesetztes Stück wählt diesen Punkt aus (statt nichts zu tun)
export function tapStartAgain(x, y) {
  const R = route();
  if (!R || R.n) return false;
  const h = trHit(x, y);
  if (!h || h.id !== R.last) return false;
  trFinish(); trSelect(h.id);
  return true;
}
