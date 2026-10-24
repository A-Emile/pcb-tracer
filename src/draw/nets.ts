import type { Project } from '../types';
import { TR_PT, newId, objBump, objById, objList, objVer } from './objects';
import { S } from '../state';

// ---------------------------------------------------------------- Netze (Zusammenhang der Bahnen) und ihre Namen
// Zusammenhang über Segmente (Union-Find, je Objektstand einmal). Name, Notiz, Haken „gemessen“ und eine feste Nummer hängen an
// net-Objekten { t: 'net', L: '*', name, note, ok, num, seeds: [Punkt-IDs] }. Jedes Netz mit mindestens einem Segment hat genau
// ein net-Objekt; netSync hält das nach jeder Änderung an Bahnen im selben Rückgängig-Schritt aktuell:
//   wächst ein Netz, kommen die neuen Punkte in seine seeds; treffen zwei unbenannte Netze zusammen, bleibt die kleinere Nummer;
//   treffen zwei benannte zusammen, bleiben beide stehen (Warnung, siehe trace.ts) bis „Zusammenlegen“;
//   wird ein unbenanntes Netz geteilt, behält der größere Teil die Nummer, der andere bekommt eine neue;
//   ein benanntes Netz behält seinen Namen in allen Teilen („VBAT · 2 Teile“) und bleibt auch ganz ohne Bahnen in der Liste.
const isPt = o => !!o && TR_PT.includes(o.t);
let gVer = -1, gPid = '', adj = new Map<string, any[]>(), comps: any[] = [], compOf = new Map<string, any>(), netComps = new Map<string, any[]>();
export function graph() {
  if (gVer === objVer && S.proj && gPid === S.proj.id) return;
  gVer = objVer; gPid = S.proj ? S.proj.id : ''; adj = new Map(); comps = []; compOf = new Map(); netComps = new Map();
  if (!S.proj) return;
  const par = new Map<string, string>(), find = (x: string) => { let r = x; while (par.get(r) !== r) r = par.get(r); while (par.get(x) !== r) { const n = par.get(x); par.set(x, r); x = n; } return r; };
  const ls = objList();
  for (const o of ls) if (isPt(o)) { par.set(o.id, o.id); adj.set(o.id, []); }
  for (const o of ls) if (o.t === 'seg' && par.has(o.a) && par.has(o.b)) {
    adj.get(o.a).push(o); adj.get(o.b).push(o);
    const ra = find(o.a), rb = find(o.b); if (ra !== rb) par.set(ra < rb ? rb : ra, ra < rb ? ra : rb);
  }
  const by = new Map<string, any>();
  for (const id of par.keys()) {
    const o = objById(id), r = find(id);
    if (adj.get(id).length === 0 && o.t === 'node') continue;    // einzelner Punkt ohne Bahn: kein Netz
    let c = by.get(r);
    if (!c) { c = { key: r, pts: [], segs: [], name: '', net: null, nets: [], num: 0, conflict: false }; by.set(r, c); comps.push(c); }
    c.pts.push(id); compOf.set(id, c);
  }
  for (const o of ls) if (o.t === 'seg' && compOf.has(o.a)) { const c = compOf.get(o.a); c.segs.push(o.id); compOf.set(o.id, c); }
  comps.sort((a, b) => a.key < b.key ? -1 : 1);
  const nets = ls.filter(o => o.t === 'net').sort((a, b) => (a.num || 0) - (b.num || 0));
  for (const n of nets) {
    const cs = [];
    for (const s of n.seeds) { const c = compOf.get(s); if (c && !cs.includes(c)) { cs.push(c); c.nets.push(n); } }
    netComps.set(n.id, cs);
  }
  for (const c of comps) {
    const named = c.nets.filter(n => n.name);
    c.net = named[0] || c.nets[0] || null;
    c.name = named.map(n => n.name).join(' + ');
    c.num = c.net ? c.net.num || 0 : 0;
    c.conflict = named.length > 1;
  }
}
export const segsOf = id => { graph(); return adj.get(id) || []; };
export const netOf = id => { graph(); return id ? compOf.get(id) || null : null; };
export const netLabel = c => c ? (c.name || (c.num ? 'Netz ' + c.num : 'Netz')) : '';
export function trNets() { graph(); return comps; }
// Teile (Zusammenhangskomponenten) eines net-Objekts
export const netParts = (netId): any[] => { graph(); return netComps.get(netId) || []; };
export const netObjs = () => objList().filter(o => o.t === 'net');

// nach einer Änderung an Bahnen, innerhalb von edit(): e = Werkzeug { put, del, mod }
export function netSync(e) {
  objBump(); graph();
  const nets = netObjs();
  let next = nets.reduce((m, n) => Math.max(m, n.num || 0), 0) + 1, ch = false;
  // 1. seeds bereinigen: nur noch vorhandene Punkte; unbenannte nur in Teilen mit Segmenten und nur im größten Teil
  for (const n of nets) {
    let seeds = n.seeds.filter(s => isPt(objById(s)));
    if (!n.name) {
      const cnt = new Map<any, number>();
      for (const s of seeds) { const c = compOf.get(s); if (c && c.segs.length) cnt.set(c, (cnt.get(c) || 0) + 1); }
      let best = null, bn = -1;
      for (const [c, k] of cnt) if (k > bn || (k === bn && c.key < best.key)) { best = c; bn = k; }
      seeds = best ? seeds.filter(s => compOf.get(s) === best) : [];
    }
    if (!n.name && !seeds.length) { e.del(n.id); ch = true; continue; }
    if (seeds.length !== n.seeds.length) { e.mod(n.id, o => { o.seeds = seeds; }); ch = true; }
  }
  if (ch) { objBump(); graph(); }
  // 2. jedes Netz mit Segmenten: genau ein führendes net-Objekt (benannte zuerst, sonst kleinste Nummer); weitere unbenannte gehen darin auf
  for (const c of comps) {
    if (!c.segs.length) continue;
    if (!c.nets.length) { e.put({ id: newId(), t: 'net', L: '*', name: '', note: '', ok: false, num: next++, seeds: c.pts.slice() }); continue; }
    const lead = c.net;
    for (const n of c.nets) if (n !== lead && !n.name) {
      const rest = n.seeds.filter(s => compOf.get(s) !== c);
      if (rest.length) e.mod(n.id, o => { o.seeds = rest; }); else e.del(n.id);
    }
    const miss = c.pts.filter(p => !lead.seeds.includes(p));
    if (miss.length) e.mod(lead.id, o => { o.seeds = o.seeds.concat(miss); });
  }
  objBump();
}

// Zwei benannte Netze in einem Teil: Warnung einmal je Paar (bereits beim Öffnen vorhandene gelten als bekannt)
let confKnown: Set<string> = null, confPid = '';
export function newConflicts(): any[] {
  graph();
  const pid = S.proj ? S.proj.id : '', cur = [];
  for (const c of comps) if (c.conflict) { const ns = c.nets.filter(n => n.name); for (let i = 1; i < ns.length; i++) cur.push([ns[0], ns[i]]); }
  const key = p => p[0].id + '|' + p[1].id;
  if (!confKnown || confPid !== pid) { confKnown = new Set(cur.map(key)); confPid = pid; return []; }
  const out = cur.filter(p => !confKnown.has(key(p)));
  confKnown = new Set(cur.map(key));   // aufgelöste Paare vergessen: nach Rückgängig warnt ein neues Verbinden wieder
  return out;
}

// Endpunkte-Kurzinfo: Pad-Namen der Enden („U3.12 → MCU 47“), sonst Vias/Stücke
export function netSummary(netId) {
  const parts = netParts(netId);
  if (!parts.length) return 'keine Bahnen';
  const pads = [], vias = [];
  let segs = 0;
  for (const c of parts) {
    segs += c.segs.length;
    for (const id of c.pts) { const o = objById(id); if (o.t === 'pad') pads.push(o); else if (o.t === 'via') vias.push(o); }
  }
  const nm = pads.map(p => p.name || 'Pad');   // in Entstehungsreihenfolge: das zuerst gesetzte Pad steht vorn
  let s = '';
  if (nm.length >= 2) s = nm[0] + ' → ' + nm[1] + (nm.length > 2 ? ' +' + (nm.length - 2) : '');
  else if (nm.length === 1) s = nm[0] + (vias.length ? ' → ' + (vias.length === 1 ? 'Via' : vias.length + ' Vias') : ' → offen');
  else s = vias.length ? (vias.length === 1 ? '1 Via' : vias.length + ' Vias') : (segs === 1 ? '1 Stück' : segs + ' Stücke');
  if (parts.length > 1) s += ' · ' + parts.length + ' Teile';
  return s;
}

// beim Öffnen (ohne Rückgängig): ältere Stände bekommen ihre net-Objekte und festen Nummern; true = geändert
export function netInit(p: Project) {
  let ch = false;
  const m = p.objs;
  for (const o of Object.values(m)) if (o.t === 'net' && !Number.isFinite(o.num)) { o.num = 0; ch = true; }
  let next = Object.values(m).reduce((k, o) => o.t === 'net' ? Math.max(k, o.num || 0) : k, 0) + 1;
  for (const o of Object.values(m)) if (o.t === 'net' && !o.num) o.num = next++;
  netSync({ put(o) { m[o.id] = o; ch = true; }, del(id) { delete m[id]; ch = true; }, mod(id, f) { if (m[id]) { f(m[id]); ch = true; } } });
  confKnown = null; newConflicts();
  return ch;
}
