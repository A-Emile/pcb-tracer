import { saveSoon } from '../db/projects';
import { edit, toastUndo } from '../draw/edit';
import { selectObj } from '../draw/menu';
import { netObjs, netOf, netParts, netSummary } from '../draw/nets';
import { objById, objVer, pickId } from '../draw/objects';
import { TR, openNetName, setNetField } from '../draw/trace';
import { openLine } from '../draw/trEdit';
import { dirty } from '../render/frame';
import { S } from '../state';
import { $, clamp } from '../util';
import { camAt, clampCam, fitScale, vm } from '../view/camera';
import { sheetOpen, showSheet } from './sheet';

// ---------------------------------------------------------------- Sheet/Panel „Netze“ (Desktop N, Handy: ⋯ → Netze oder „Netz ›“ am Objekt)
// Liste aller Netze: Name (○ = ohne Namen, „Netz 7“), Endpunkte-Kurzinfo, Haken „gemessen“; Suche über Name, Pads, Notiz.
// Tipp = Netz hervorheben und einpassen, die Zeile klappt auf: Namen geben, Notiz, gemessen, Löschen. Liegt wie „Ansicht“
// (Handy unten, Desktop/quer rechts); die beiden schließen sich gegenseitig.
export const netsOpen = () => !$('#sheetNets').hidden;
let openId: string = null, sig = '';
export function showNets(on, focusNet?: string) {
  if (on && sheetOpen()) showSheet(false);
  $('#sheetNets').hidden = !on;
  if (!on) { openId = null; const q = $('#nSearch'); if (document.activeElement === q) q.blur(); }
  if (focusNet !== undefined) openId = focusNet;
  sig = ''; updateNets();
  if (on && openId) requestAnimationFrame(() => { const r = $(`#nList .nrow[data-id="${openId}"]`); if (r) r.scrollIntoView({ block: 'nearest' }); });
  dirty();
}
// „Netz ›“ am Objekt: Netz hervorheben und in der Liste aufklappen
export function openNetsFor(id) {
  const c = netOf(id);
  if (!c || !c.net) return;
  showNets(true, c.net.id);
}
const order = (a, b) => (a.name ? 0 : 1) - (b.name ? 0 : 1) || (a.name ? a.name.localeCompare(b.name, 'de', { numeric: true }) : (a.num || 0) - (b.num || 0));
const hiId = () => { const p = pickId(); if (p) { const c = netOf(p); return c && c.net ? c.net.id : null; } const o = objById(TR.hiId); return o ? (o.t === 'net' ? o.id : (netOf(o.id) || {} as any).net?.id) : null; };
export function updateNets() {
  if (!S.proj || !netsOpen()) return;
  const q = $('#nSearch').value.trim().toLowerCase(), k = objVer + '|' + q + '|' + openId + '|' + hiId();
  if (k === sig) return;
  sig = k;
  const el = $('#nList'), hid = hiId();
  el.innerHTML = '';
  const nets = netObjs().filter(n => n.name || netParts(n.id).length).sort(order);
  let shown = 0;
  for (const n of nets) {
    const label = n.name || 'Netz ' + (n.num || ''), sub = netSummary(n.id);
    if (q && !(label + ' ' + sub + ' ' + (n.note || '')).toLowerCase().includes(q)) continue;
    shown++;
    const row = document.createElement('div');
    row.className = 'nrow' + (n.id === openId ? ' open' : '') + (n.id === hid ? ' hi' : ''); row.dataset.id = n.id;
    const main = document.createElement('button'); main.className = 'nmain';
    main.setAttribute('aria-expanded', String(n.id === openId));
    const dot = document.createElement('i'); dot.className = 'ndot' + (n.name ? ' on' : '');
    const tx = document.createElement('span'); tx.className = 'ntx';
    const b = document.createElement('b'); b.textContent = label;
    const sm = document.createElement('small'); sm.textContent = sub;
    tx.append(b, sm); main.append(dot, tx);
    if (n.ok) { const ok = document.createElement('span'); ok.className = 'nok'; ok.textContent = '✓'; ok.setAttribute('aria-label', 'gemessen'); main.append(ok); }
    main.onclick = () => tapNet(n.id);
    row.append(main);
    if (n.id === openId) {
      if (n.note) { const nt = document.createElement('div'); nt.className = 'nnote'; nt.textContent = n.note; row.append(nt); }
      const act = document.createElement('div'); act.className = 'nact';
      const mk = (t, fn, cls?) => { const x = document.createElement('button'); x.textContent = t; if (cls) x.className = cls; x.onclick = e => { e.stopPropagation(); fn(); }; act.append(x); return x; };
      mk(n.name ? 'Umbenennen' : 'Namen geben', () => renameNet(n.id));
      mk(n.note ? 'Notiz ändern' : 'Notiz', () => openLine(n.note || '', 'Notiz zu ' + label, v => setNetField(n.id, 'note', v)));
      const ok = mk('Gemessen', () => setNetField(n.id, 'ok', !n.ok), n.ok ? 'on' : '');
      ok.setAttribute('aria-pressed', String(!!n.ok));
      mk('Löschen', () => deleteNet(n.id), 'danger');
      row.append(act);
    }
    el.append(row);
  }
  if (!shown) { const e = document.createElement('div'); e.className = 'nempty'; e.textContent = q ? 'Nichts gefunden' : 'Noch keine Bahnen nachgezogen'; el.append(e); }
  $('#nCount').textContent = nets.length ? String(nets.length) : '';
}
function tapNet(id) {
  if (openId === id) { openId = null; updateNets(); return; }
  openId = id;
  if (pickId()) selectObj(null);
  TR.hiId = id;
  updateNets(); fitNet(id); dirty();
}
function renameNet(id) {
  const parts = netParts(id), n = objById(id);
  if (parts.length) { openNetName(parts[0].pts[0]); return; }
  openLine(n.name || '', 'Name, z. B. VBAT', v => setNetField(id, 'name', v));
}
// Netz löschen: seine Bahnen, Ecken und Vias samt Namen (Pads bleiben, sie gehören zum Bauteil)
function deleteNet(id) {
  const parts = netParts(id), n = objById(id);
  edit(e => {
    for (const c of parts) {
      for (const s of c.segs) e.del(s);
      for (const p of c.pts) { const o = objById(p); if (o && o.t !== 'pad') e.del(p); }
    }
    if (objById(id)) e.del(id);
  });
  if (TR.hiId === id) TR.hiId = null;
  openId = null; updateNets();
  toastUndo((n && n.name ? n.name : 'Netz') + ' gelöscht');
}

// ---- Einpassen: Netz (alle Teile) in den freien Bereich neben bzw. über dem Sheet, sanft
export function fitNet(id) {
  const parts = netParts(id);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const c of parts) for (const p of c.pts) { const o = objById(p); if (!o) continue; x0 = Math.min(x0, o.x); y0 = Math.min(y0, o.y); x1 = Math.max(x1, o.x); y1 = Math.max(y1, o.y); }
  if (!Number.isFinite(x0)) return;
  const cam = S.cams.main, pane = S.panes[0], st = $('#stage').getBoundingClientRect(), sh = $('#sheetNets').getBoundingClientRect(), m = vm().m;
  let vx = 0, vy = 0, vw = pane.w, vh = pane.h;
  if (netsOpen()) {
    if (sh.left > st.left + 40) vw = sh.left - st.left;   // Panel rechts
    else vh = sh.top - st.top;                            // Sheet unten
  }
  const bw = x1 - x0, bh = y1 - y0, ew = Math.abs(m[0]) * bw + Math.abs(m[1]) * bh, eh = Math.abs(m[2]) * bw + Math.abs(m[3]) * bh, M = 56;
  const s1 = clamp(Math.min((vw - 2 * M) / Math.max(ew, 1), (vh - 2 * M) / Math.max(eh, 1)), fitScale('main', pane) * 0.5, 2.5);
  const tgt = { cx: 0, cy: 0, s: s1 };
  camAt(tgt, pane, (x0 + x1) / 2, (y0 + y1) / 2, pane.x + vx + vw / 2, pane.y + vy + vh / 2);
  const c0 = { cx: cam.cx, cy: cam.cy, s: cam.s }, t0 = performance.now(), T = 240;
  const step = () => {
    const k = Math.min(1, (performance.now() - t0) / T), e = 1 - (1 - k) ** 3;
    cam.s = Math.exp(Math.log(c0.s) + (Math.log(s1) - Math.log(c0.s)) * e);
    // Mitte so führen, dass der Zielpunkt gleichmäßig wandert
    cam.cx = c0.cx + (tgt.cx - c0.cx) * e; cam.cy = c0.cy + (tgt.cy - c0.cy) * e;
    dirty();
    if (k < 1) requestAnimationFrame(step); else { Object.assign(cam, tgt); clampCam('main'); dirty(); saveSoon(); }
  };
  step();
}

// Tastatur am Handy: Sheet über die Tastatur schieben, solange die Suche den Fokus hat
function onVV() {
  const v = window.visualViewport, el = $('#sheetNets');
  if (!v || document.activeElement !== $('#nSearch')) { el.style.bottom = ''; return; }
  const kb = Math.max(0, innerHeight - (v.offsetTop + v.height)), st = $('#stage').getBoundingClientRect();
  el.style.bottom = kb > 0 ? Math.max(0, kb - (innerHeight - st.bottom)) + 'px' : '';
}

export function initNets() {
  $('#nDone').onclick = () => showNets(false);
  $('#mNets').onclick = () => { $('#sheetMenu').hidden = true; showNets(true); };
  $('#nSearch').addEventListener('input', () => updateNets());
  // VisualViewport erst beim Fokus abonnieren (dann gilt das aktuelle Objekt), beim Verlassen wieder abmelden
  let vv = null;
  $('#nSearch').addEventListener('focus', () => { vv = window.visualViewport; if (vv) { vv.addEventListener('resize', onVV); vv.addEventListener('scroll', onVV); } onVV(); });
  $('#nSearch').addEventListener('blur', () => { if (vv) { vv.removeEventListener('resize', onVV); vv.removeEventListener('scroll', onVV); vv = null; } $('#sheetNets').style.bottom = ''; });
  $('#nSearch').addEventListener('keydown', e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); (e.target as HTMLElement).blur(); } });
  // „Ansicht“ geht auf: Netze schließen (beide liegen an derselben Stelle)
  new MutationObserver(() => { if (!$('#sheetView').hidden && netsOpen()) showNets(false); }).observe($('#sheetView'), { attributes: true, attributeFilter: ['hidden'] });
  // Griff: antippen oder nach unten ziehen schließt
  const g = $('#nGrip');
  let y0 = null;
  g.addEventListener('pointerdown', e => { y0 = e.clientY; try { g.setPointerCapture(e.pointerId); } catch {} });
  g.addEventListener('pointerup', e => { if (y0 != null && (e.clientY - y0 > 30 || Math.abs(e.clientY - y0) < 6)) showNets(false); y0 = null; });
  g.addEventListener('pointercancel', () => { y0 = null; });
}
