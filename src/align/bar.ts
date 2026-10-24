import { pushUndo, rebuildAlign, setPre, updateAlignBar } from './align';
import { acceptProps, commitPair, selectPair } from './pairs';
import { suggestPairs } from './suggest';
import { saveSoon } from '../db/projects';
import { dirty } from '../render/frame';
import { S } from '../state';
import { setMode } from '../ui/nav';
import { toast } from '../ui/toast';
import { $ } from '../util';
import { fitCam } from '../view/camera';

// Knöpfe der Ausrichte-Leiste verdrahten
export function initAlignBar() {
  $('#aFlipX').onclick = () => { pushUndo(); const p = S.proj.align.pre; setPre({ ...p, fx: !p.fx }); };
  $('#aFlipY').onclick = () => { pushUndo(); const p = S.proj.align.pre; setPre({ ...p, fy: !p.fy }); };
  $('#aRot').onclick = () => { pushUndo(); const p = S.proj.align.pre; setPre({ ...p, rot: (p.rot + 1) & 3 }); fitCam('back'); dirty(); };
  $('#aLink').onclick = () => { S.link = !S.link; updateAlignBar(); };
  $('#aUndo').onclick = () => {
    if (!S.undo.length) return;
    S.proj.align = JSON.parse(S.undo.pop()); S.pending = null; S.sel = null;
    rebuildAlign(); saveSoon();
  };
  $('#aDone').onclick = () => {
    if (S.proj.align.pairs.length < 3) { toast('Mindestens 3 Paare nötig, besser 6 und mehr über die ganze Platine verteilt.'); return; }
    setMode('main');
  };
  $('#aAccept').onclick = () => commitPair();
  $('#aSuggest').onclick = () => suggestPairs();
  $('#aAcceptAll').onclick = () => acceptProps();
  $('#aRejectAll').onclick = () => { S.props = null; updateAlignBar(); dirty(); };
  $('#aCancel').onclick = () => { S.pending = null; updateAlignBar(); dirty(); };
  $('#aDeselect').onclick = () => selectPair(null);
  $('#aDelete').onclick = () => {
    if (S.sel == null) return;
    pushUndo(); S.proj.align.pairs.splice(S.sel, 1); S.sel = null;
    rebuildAlign(); saveSoon();
  };
}
