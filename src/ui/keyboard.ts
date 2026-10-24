import { commitPair, selectPair } from '../align/pairs';
import { stActive, stExit } from '../align/straight';
import { objUndo } from '../draw/edit';
import { objDelete } from '../draw/menu';
import { setDraw, setObjsHidden } from '../draw/mode';
import { objById, pickId } from '../draw/objects';
import { openNote } from '../draw/note';
import { trKey } from '../draw/trace';
import { setActive, setHold, setLayerMode, stepActive, swapFront } from '../layers/actions';
import { MODES, MODE_NAME, layerMode, layers } from '../layers/model';
import { setMat } from '../material/run';
import { matLook } from '../material/state';
import { dirty } from '../render/frame';
import { S, lookState } from '../state';
import { backStep } from './nav';
import { sheetOpen, showSheet, updateViewUI } from './sheet';
import { toast } from './toast';
import { $ } from '../util';
import { flipView, orient, rotateView } from '../view/orient';

export let spaceDown = false;

// Tasten verdrahten
export function initKeyboard() {
  document.addEventListener('keydown', (e: any) => {
    if (!S.proj || e.target.tagName === 'INPUT' && e.target.type === 'text' || e.target.tagName === 'TEXTAREA') return;
    // Ansicht drehen/spiegeln wie KiCad: R gegen, Umschalt+R im Uhrzeigersinn, F spiegeln (auch beim Ausrichten)
    const pl = !e.ctrlKey && !e.metaKey && !e.altKey, view = S.mode === 'main' || S.mode === 'align';
    if (view && pl && !e.repeat && (e.key === 'r' || e.key === 'R')) { e.preventDefault(); rotateView(e.shiftKey ? 1 : -1); return; }
    if (view && pl && !e.repeat && !e.shiftKey && (e.key === 'f' || e.key === 'F')) { e.preventDefault(); flipView(); toast(orient().f ? 'Ansicht gespiegelt' : 'Ansicht nicht mehr gespiegelt', 1500); return; }
    if (stActive()) {
      if (e.key === 'Escape') stExit();
      else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#sUndo').click(); }
      return;
    }
    if (S.mode === 'main' && trKey(e)) return;
    if (S.mode === 'main') {
      const plain = !e.ctrlKey && !e.metaKey && !e.altKey;
      if ((e.key === 'v' || e.key === 'V') && !e.repeat && plain) { S.before = true; updateViewUI(); dirty(); }
      else if ((e.key === 'a' || e.key === 'A') && plain) { if (!S.draw) showSheet(!sheetOpen()); }
      else if ((e.key === 'm' || e.key === 'M') && plain && !e.repeat) setDraw(!S.draw);
      else if ((e.key === 'k' || e.key === 'K') && plain && !e.repeat) setMat('cu', !matLook().cu);
      else if ((e.key === 'h' || e.key === 'H') && plain && !e.repeat) { setObjsHidden(!lookState().hideObjs); toast(lookState().hideObjs ? 'Zeichnungen ausgeblendet' : 'Zeichnungen eingeblendet', 1500); }
      else if ((e.key === 'h' || e.key === 'H') && (e.ctrlKey || e.metaKey) && !e.altKey && !e.repeat) { e.preventDefault(); const m = MODES[(MODES.indexOf(layerMode()) + 1) % MODES.length]; setLayerMode(m); toast('Andere Lagen: ' + MODE_NAME[m], 1500); }
      else if (e.key === 'PageUp' && plain) { e.preventDefault(); const ls = layers(); if (ls.length) setActive(ls[0].id); }
      else if (e.key === 'PageDown' && plain) { e.preventDefault(); const ls = layers(); if (ls.length) setActive(ls[ls.length - 1].id); }
      else if ((e.key === '+' || e.key === '-') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); stepActive(e.key === '+' ? 1 : -1); }
      else if ((e.key === 'z' || e.key === 'Z') && (e.ctrlKey || e.metaKey) && !e.shiftKey) { e.preventDefault(); objUndo(); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && pickId()) { e.preventDefault(); objDelete(pickId()); }
      else if ((e.key === 'Enter' || ((e.key === 'e' || e.key === 'E') && plain)) && !e.repeat && objById(pickId())?.t === 'text') { e.preventDefault(); openNote(objById(pickId()), false); }
      else if (e.key === 'Escape') backStep();
      else if (e.key === 'Tab') { e.preventDefault(); swapFront(); }
      else if (e.key === ' ' && !spaceDown) { e.preventDefault(); spaceDown = true; setHold(true); }
    } else if (S.mode === 'align') {
      if (e.key === 'Enter') { e.preventDefault(); if (S.pending) commitPair(); }
      else if (e.key === 'Escape') { S.pending = null; selectPair(null); }
      else if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel != null) $('#aDelete').click();
      else if (e.key === 'z' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#aUndo').click(); }
    }
  });
  document.addEventListener('keyup', e => { if ((e.key === 'v' || e.key === 'V') && S.before) { S.before = false; updateViewUI(); dirty(); } if (e.key === ' ' && spaceDown) { spaceDown = false; setHold(false); } });
}
