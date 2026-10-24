import { saveSoon } from '../db/projects';
import { OBJ_TYPES, TR_TYPES, objList } from '../draw/objects';
import { setActive, setLayerMode, setLayerOn } from '../layers/actions';
import { MODES, MODE_NAME, activeLayer, layerColor, layerMode, layerName, layers } from '../layers/model';
import { updateMatUI } from '../material/run';
import { matAny } from '../material/state';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { $ } from '../util';
import { updateOrientUI } from '../view/orient';

export const sheetOpen = () => !$('#sheetView').hidden;
// Seitenpanel statt Sheet (Desktop, Handy quer): darf offen bleiben, auch beim Zeichnen; am Desktop merkt sich der Browser den Zustand
export const panelUI = () => matchMedia('(orientation:landscape) and (max-height:600px),(min-width:900px)').matches;
export const deskUI = () => matchMedia('(min-width:900px)').matches;
export const panelWanted = () => { try { return S.mode === 'main' && deskUI() && localStorage.getItem('pcbt.panel') === '1'; } catch { return false; } };
export function showSheet(on) {
  $('#sheetView').hidden = !on;
  if (deskUI()) try { localStorage.setItem('pcbt.panel', on ? '1' : '0'); } catch {}
  if (!on) S.before = false;
  updateViewUI(); dirty();
}
// Lagenliste: neu aufgebaut nur, wenn sich ihr Aufbau ändert (nicht beim Ziehen eines Reglers)
export const EYE = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
export let layerSig = '';
export function buildLayers() {
  const el = $('#vLayers'), ls = layers(), act = activeLayer();
  el.innerHTML = '';
  for (const L of ls) {
    const nm = layerName(L), isAct = L.id === act, row = document.createElement('div');
    row.className = 'vrow lay' + (isAct ? ' act' : '') + (L.on ? '' : ' off'); row.dataset.id = L.id; row.style.setProperty('--lc', layerColor(L.id));
    const eye = document.createElement('button'); eye.className = 'eye' + (L.on ? '' : ' off'); eye.setAttribute('aria-label', nm + (L.on ? ' ausblenden' : ' einblenden'));
    eye.innerHTML = EYE + (L.on ? '' : '<path d="M3 3l18 18"/>') + '</svg>';
    eye.onclick = () => setLayerOn(L.id, !L.on);
    const nb = document.createElement('button'); nb.className = 'nm' + (isAct ? ' act' : '');
    nb.innerHTML = '<i class="sw"></i>'; nb.append(nm);
    nb.setAttribute('aria-label', nm + (isAct ? ' (aktiv)' : ' aktivieren')); nb.setAttribute('aria-pressed', isAct);
    nb.onclick = () => setActive(L.id);
    const op: any = document.createElement('input'); op.type = 'range'; op.className = 'op'; op.min = 0; op.max = 100; op.value = Math.round(L.op * 100);
    op.setAttribute('aria-label', 'Deckkraft Foto ' + nm);
    op.addEventListener('input', () => { L.op = op.value / 100; dirty(); saveSoon(); });
    row.append(eye, nb, op); el.append(row);
  }
}
export function updateViewUI() {
  if (!S.proj) return;
  const lk = lookState(), open = sheetOpen(), ls = layers();
  const active = lk.bahnen > 0 || matAny();
  $('#btnView').classList.toggle('on', open);
  $('#btnView').classList.toggle('act', !open && active);
  $('#vBefore').classList.toggle('on', !!S.before);
  updateOrientUI();
  if (!open) return;
  const hasObj = objList().some(o => OBJ_TYPES.includes(o.t)), hid = !!lk.hideObjs, eye = $('#vObjEye');
  $('#vObj').hidden = $('#vObjHead').hidden = !hasObj;
  if (eye.dataset.h !== String(hid)) { eye.dataset.h = hid; eye.classList.toggle('off', hid); eye.innerHTML = EYE + (hid ? '<path d="M3 3l18 18"/>' : '') + '</svg>'; eye.setAttribute('aria-label', hid ? 'Zeichnungen einblenden' : 'Zeichnungen ausblenden'); }
  $('#vObj').classList.toggle('off', hid);
  $('#vObj').hidden = !hasObj;
  const hasTr = objList().some(o => TR_TYPES.includes(o.t)), ht = !!lk.hideTr, te = $('#vTrEye');
  $('#vTr').hidden = !hasTr; $('#vObjHead').hidden = !hasObj && !hasTr;
  if (te.dataset.h !== String(ht)) { te.dataset.h = ht; te.innerHTML = EYE + (ht ? '<path d="M3 3l18 18"/>' : '') + '</svg>'; te.setAttribute('aria-label', ht ? 'Bahnen einblenden' : 'Bahnen ausblenden'); }
  $('#vTr').classList.toggle('off', ht); te.classList.toggle('off', ht);
  if (document.activeElement !== $('#vK')) $('#vK').value = Math.round(lk.bahnen * 100);
  for (const b of $('#vMode').children) { const on = b.dataset.m === layerMode(); b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  updateMatUI();
  const sig = ls.map(L => L.id + L.on + L.color).join() + '|' + activeLayer();
  if (sig !== layerSig) { layerSig = sig; buildLayers(); }
  for (const L of ls) {
    const row = $(`#vLayers .lay[data-id="${L.id}"]`), op = row.querySelector('.op');
    if (document.activeElement !== op) op.value = Math.round(L.op * 100);
  }
}

// Sheet „Ansicht“ verdrahten
export function initSheet() {
  // Anzeige der anderen Lagen (Normal · Gedimmt · Ausgeblendet)
  (() => {
    const el = $('#vMode');
    for (const m of MODES) {
      const b = document.createElement('button'); b.dataset.m = m; b.textContent = MODE_NAME[m]; b.setAttribute('role', 'radio');
      b.onclick = () => setLayerMode(m);
      el.append(b);
    }
  })();
  // Chip oben: aktive Lage, antippen zeigt die Lagenliste
  $('#sideChip').onclick = () => { if (S.mode === 'main') showSheet(!sheetOpen()); };
  $('#btnView').onclick = () => showSheet(!sheetOpen());
  $('#vDone').onclick = () => showSheet(false);
  $('#vK').addEventListener('input', e => { lookState().bahnen = e.target.value / 100; updateViewUI(); dirty(); saveSoon(); });
  (() => {
    const b = $('#vBefore'), on = v => { if (!!S.before === v) return; S.before = v; updateViewUI(); dirty(); };
    b.addEventListener('pointerdown', e => { try { b.setPointerCapture(e.pointerId); } catch {} on(true); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => on(false));
    b.addEventListener('contextmenu', e => e.preventDefault());
    // Griff: antippen oder nach unten ziehen schließt
    const g = $('#vGrip');
    let y0 = null;
    g.addEventListener('pointerdown', e => { y0 = e.clientY; try { g.setPointerCapture(e.pointerId); } catch {} });
    g.addEventListener('pointerup', e => { if (y0 != null && (e.clientY - y0 > 30 || Math.abs(e.clientY - y0) < 6)) showSheet(false); y0 = null; });
    g.addEventListener('pointercancel', () => { y0 = null; });
  })();
}
