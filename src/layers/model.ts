import type { Layer } from '../types';
import { matLook, matOn, matState } from '../material/state';
import { S, lookState } from '../state';
import { clamp } from '../util';

// ---------------------------------------------------------------- Lagen, Durchsicht, Ansicht
// Gespeichert pro Projekt in p.look (Format offen für beliebig viele Lagen):
//   p.look = { bahnen: 0..1, active: Lagen-ID, mode: 'normal'|'dim'|'hide', hideObjs, pen,
//              layers: [ { id, on, op: 0..1, color: '#rrggbb', name? } ],
//              mat: { cu: Nur Kupfer, pour: Kupferflächen ausblenden (nur mit cu), silk: Druck ausblenden, bg: Hintergrund ausblenden } }
//   layers in physikalischer Reihenfolge: [0] = Oberseite, Innenlagen, zuletzt Unterseite. id = Bild-/Lagen-ID (heute 'front' | 'back').
//   active: die Lage, auf der gearbeitet wird (alles Neue entsteht dort). Ihr Foto liegt vorne, die übrigen nach Abstand dahinter.
//   mode (wie KiCad „Inaktive Lagen“): Objekte der anderen Lagen voll, gedimmt oder ausgeblendet. Fotos regelt der Durchsicht-Schieber.
//   on (Auge): gilt für alles der Lage, Foto und Objekte.
// Durchsicht-Schieber (S.t, p.view.t): blendet nur optisch über, nimmt der vordersten sichtbaren Lage Deckkraft weg
// (wirksam = op · (1 − t)), sofern dahinter noch eine sichtbare liegt; aktive Lage bleibt. S.hold: Nachbarlage kurz vorne (Halten).
export const LAYER_NAME = { front: 'Oberseite', back: 'Unterseite' }, LAYER_SHORT = { front: 'Oben', back: 'Unten' };
export const LAYER_COLOR = { front: '#ff9a3d', back: '#4fb3ff' }, INNER_COLOR = ['#e3c341', '#56cf86', '#c08cff', '#ff78b4'];
export const MODES = ['normal', 'dim', 'hide'], MODE_NAME = { normal: 'Normal', dim: 'Gedimmt', hide: 'Ausgeblendet' }, DIM = 0.3;

export function layers() { return lookState().layers; }
export const layerById = id => layers().find(L => L.id === id) || null;
export const layerName = L => L.name || LAYER_NAME[L.id] || L.id;
export const layerShort = L => LAYER_SHORT[L.id] || layerName(L);
export const layerColor = id => { const L = layerById(id); return (L && L.color) || LAYER_COLOR[id] || '#c8ccd2'; };
export const layerMode = () => lookState().mode || 'dim';
export function activeLayer() { const lk = lookState(); return layerById(lk.active) ? lk.active : (lk.layers[0] || { id: 'front' }).id; }
// Nachbarlage der aktiven (darunter, bei der untersten darüber): „Oben ⇄“ halten zeigt sie kurz
export function holdLayer() {
  const ls = layers(), i = ls.findIndex(L => L.id === activeLayer());
  return (ls[i + 1] || ls[i - 1] || ls[i] || { id: 'front' }).id;
}
// Lage, deren Foto vorne liegt und deren Objekte betont sind: die aktive, beim Halten kurz die Nachbarlage
export const shownLayer = () => S.hold ? holdLayer() : activeLayer();
// Foto-Reihenfolge (vorne zuerst): gezeigte Lage, dann die übrigen nach Abstand im Stapel; beim Halten die gezeigte sichtbar
export function layerOrder() {
  const ls = layers(), sid = shownLayer(), i0 = ls.findIndex(L => L.id === sid);
  const ord = ls.map((L, i) => [L, Math.abs(i - i0)] as [Layer, number]).sort((a, b) => a[1] - b[1]).map(a => a[0]);
  return S.hold ? ord.map(L => L.id === sid ? { ...L, on: true } : L) : ord;
}
// Fotos mit wirksamer Deckkraft, vorne zuerst; hinter einer deckenden Lage wird nichts mehr gezeichnet.
// Der Schieber wirkt auf die vorderste sichtbare Lage, und nur wenn dahinter noch eine sichtbare liegt (sonst bliebe es schwarz).
// Bei „Nur Kupfer“ ist eine Lage mit fertiger Maske nicht deckend: die Lagen dahinter scheinen durch.
export function visibleLayers() {
  const out = [], ord = layerOrder().filter(L => L.on && S.proj.sides[L.id]), see = matOn() && matLook().cu;
  for (let i = 0; i < ord.length; i++) {
    const L = ord[i], op = L.op * (i === 0 && ord.length > 1 ? 1 - S.t : 1);
    if (op <= 0.001) continue;
    out.push({ id: L.id, op });
    if (op >= 0.999 && !(see && matState(L.id))) break;
  }
  return out;
}
// Sichtbarer Anteil des Fotos je Lage (wie visibleLayers, vorne zuerst: Anteil = α · Π(1 − α davor)), normiert auf die
// Gesamtdeckung. Zwei Lagen, Schieber t: vorne 1 − t, hinten t; beim Halten von „Oben ⇄“ entsprechend die Nachbarlage.
export function layerShares() {
  const sh = {}, ord = layerOrder().filter(L => L.on && S.proj.sides[L.id]);
  let rest = 1;
  for (let i = 0; i < ord.length; i++) { const L = ord[i], a = L.op * (i === 0 && ord.length > 1 ? 1 - S.t : 1); sh[L.id] = a * rest; rest *= 1 - a; }
  const tot = 1 - rest;
  if (tot < 1e-3) return { [shownLayer()]: 1 };
  for (const k in sh) sh[k] /= tot;
  return sh;
}
export const layerShare = (sh, id) => id === '*' ? 1 : sh[id] ?? (layerById(id) && S.proj.sides[id] ? 0 : id === shownLayer() ? 1 : 0);
// Objekt-Gewicht folgt dem, was man von seiner Lage sieht: Untergrenze je Modus (Normal 1, Gedimmt DIM, Ausgeblendet 0),
// darüber stufenlos bis 1 mit dem sichtbaren Anteil. 0 = unsichtbar (auch: Auge der Lage aus).
export function objWeight(o, sh = layerShares()) {
  const L = layerById(o.L);
  if (L && !L.on && !(S.hold && o.L === shownLayer())) return 0;
  const m = layerMode(), lo = m === 'normal' ? 1 : m === 'hide' ? 0 : DIM;
  return lo + (1 - lo) * layerShare(sh, o.L);
}
// Anwählbar: sichtbar und die Lage gerade überwiegend zu sehen (≥ ½); im Modus „Normal“ alles Sichtbare (andere nachrangig, siehe hitObj)
export const objPickable = (o, sh = layerShares()) => objWeight(o, sh) > 0 && (layerMode() === 'normal' || layerShare(sh, o.L) >= 0.5 - 1e-6);

// Ältere Stände: Antipp-Farben (sides.*.colors/sub), Filter-Prototyp (p.fx) und look.durch verwerfen;
// Lagenliste aus der früheren Durchsicht (t ≥ 0,5 hieß: Unterseite vorne) anlegen.
// Bis 2026-10-23 stand die aktive Lage vorn in der Liste: daraus wird look.active, die Liste kommt in die Stapel-Reihenfolge.
export function migrateLook(p) {
  let ch = false;
  const n = v => Number.isFinite(+v) ? +v : 0;
  if (p.fx) { if (!p.look) p.look = { bahnen: p.fx.on ? n(p.fx.k) : 0 }; delete p.fx; ch = true; }
  for (const side of ['front', 'back']) for (const k of ['colors', 'sub']) if (p.sides[side] && k in p.sides[side]) { delete p.sides[side][k]; ch = true; }
  if (!p.look || typeof p.look !== 'object') { p.look = { bahnen: 0 }; ch = true; }
  const lk = p.look;
  for (const k of ['durch', 'hue']) if (k in lk) { delete lk[k]; ch = true; }
  lk.bahnen = clamp(n(lk.bahnen), 0, 1);
  const mo = lk.mat && typeof lk.mat === 'object' ? lk.mat : {}, mn = { cu: mo.cu === true, pour: mo.pour === true, silk: mo.silk === true, bg: mo.bg === true };
  if (JSON.stringify(mn) !== JSON.stringify(lk.mat)) { lk.mat = mn; ch = true; }
  if (!Array.isArray(lk.layers)) {
    const t = clamp(n(p.view && p.view.t), 0, 1), backFirst = t >= 0.5;
    lk.layers = (backFirst ? ['back', 'front'] : ['front', 'back']).map(id => ({ id, on: true, op: 1 }));
    if (p.view) p.view.t = backFirst ? 1 - t : t;
    ch = true;
  }
  const before = JSON.stringify(lk.layers), seen = new Set(), hex = c => typeof c === 'string' && /^#[0-9a-f]{6}$/i.test(c);
  // Lagen mit Bild, oder (später) benannte Lagen ohne Bild
  const old = lk.layers.filter(L => L && typeof L.id === 'string' && (p.sides[L.id] || typeof L.name === 'string') && !seen.has(L.id) && seen.add(L.id));
  for (const id of Object.keys(p.sides)) if (LAYER_NAME[id] && !seen.has(id)) { old.push({ id }); seen.add(id); }
  const rank = id => id === 'front' ? 0 : id === 'back' ? 2 : 1;
  let inner = 0;
  lk.layers = old.slice().sort((a, b) => rank(a.id) - rank(b.id)).map(L => {
    const o: any = { id: L.id, on: L.on !== false, op: clamp(L.op == null ? 1 : n(L.op), 0, 1) }; // früherer Farbton (hue) entfällt
    if (typeof L.name === 'string' && L.name) o.name = L.name;
    o.color = hex(L.color) ? L.color : LAYER_COLOR[L.id] || INNER_COLOR[inner++ % INNER_COLOR.length];
    return o;
  });
  if (JSON.stringify(lk.layers) !== before) ch = true;
  if (!lk.layers.some(L => L.id === lk.active)) { lk.active = (old[0] || { id: 'front' }).id; ch = true; }
  if (!MODES.includes(lk.mode)) { lk.mode = 'dim'; ch = true; }
  return ch;
}
