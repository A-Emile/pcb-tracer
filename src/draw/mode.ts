import { saveSoon } from '../db/projects';
import { objUndo } from './edit';
import { selectObj } from './menu';
import { closeNote } from './note';
import { PENS, PEN_NAME, curPen } from './objects';
import { setTrace } from './trace';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { panelUI, sheetOpen, showSheet, updateViewUI } from '../ui/sheet';
import { toast } from '../ui/toast';
import { $ } from '../util';

// ---- Zeichenmodus, Werkzeugzeile, Ein/Aus
export function setDraw(on) {
  on = !!on && S.mode === 'main';
  if (S.note) closeNote();
  if (S.draw === on) { updateDrawUI(); return; }
  if (on && S.tr) setTrace(false);
  S.draw = on; S.stroke = null;
  if (on) { lookState().hideObjs = false; if (sheetOpen() && !panelUI()) showSheet(false); toast(matchMedia('(pointer:fine)').matches ? 'Ziehen zeichnet, Klicken setzt Text' : 'Ziehen zeichnet, Tippen setzt Text', 3000); }
  else $('#toast').classList.remove('show');
  selectObj(null);
  updateDrawUI(); updateViewUI(); dirty(); saveSoon();
}
export function setObjsHidden(h) {
  if (h && S.draw) setDraw(false);
  lookState().hideObjs = !!h; selectObj(null);
  updateDrawUI(); updateViewUI(); dirty(); saveSoon();
}
export function updateDrawUI() {
  if (!S.proj) return;
  const pen = curPen();
  $('#grpMain').hidden = !!S.draw || !!S.tr; $('#grpDraw').hidden = !S.draw;
  const pens = $('#pens');
  if (!pens.children.length) PENS.forEach((c, i) => {
    const b = document.createElement('button'); b.className = 'pen'; b.dataset.c = c; b.setAttribute('role', 'radio'); b.setAttribute('aria-label', PEN_NAME[i]);
    b.innerHTML = `<i style="background:${c}"></i>`;
    b.onclick = () => { lookState().pen = c; updateDrawUI(); saveSoon(); };
    pens.append(b);
  });
  for (const b of pens.children) { const on = b.dataset.c === pen; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
  $('#dUndo').disabled = !S.oundo.length;
}

// Knöpfe des Zeichenmodus verdrahten
export function initDrawUI() {
  $('#btnDraw').onclick = () => setDraw(true);
  $('#dDone').onclick = () => setDraw(false);
  $('#dUndo').onclick = () => objUndo();
  $('#vObjEye').onclick = () => setObjsHidden(!lookState().hideObjs);
}
