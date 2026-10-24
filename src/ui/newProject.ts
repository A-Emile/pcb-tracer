import { newWorker } from '../worker/client';
import { idbPutMany } from '../db/idb';
import { cleanupOrphans, deleteProjectData } from '../db/projects';
import { S } from '../state';
import { openProject } from './nav';
import { renderList } from './projectList';
import { $ } from '../util';

// ---------------------------------------------------------------- Neues Projekt / Import
export const nf = { front: null, back: null };
export let importWorker = null;
export function resetNew() {
  nf.front = nf.back = null;
  $('#fileFront').value = ''; $('#fileBack').value = '';
  $('#fnFront').textContent = ''; $('#fnBack').textContent = '';
  $('#newName').value = 'Platine ' + new Date().toLocaleDateString('de-DE');
  $('#newProg').hidden = true; $('#newErr').hidden = true;
  $('#newGo').disabled = true;
}
export async function importProject(name, fFront, fBack) {
  try { await navigator.storage?.persist?.(); } catch {}
  const est = await navigator.storage?.estimate?.();
  const need = (fFront.size + fBack.size) * 3;
  if (est && est.quota - est.usage < need) throw new Error(`zu wenig Speicher (frei ${((est.quota - est.usage) / 1048576).toFixed(0)} MB, nötig ca. ${(need / 1048576).toFixed(0)} MB)`);
  const pid = 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  $('#newProg').hidden = false;
  const bar = $('#newBar'), txt = $('#newPText');
  try {
    await idbPutMany(S.db, 'files', [[pid + '|front', fFront], [pid + '|back', fBack]]);
    importWorker = newWorker();
    const sides = {};
    for (const [i, side] of ['front', 'back'].entries()) {
      txt.textContent = (side === 'front' ? 'Oberseite' : 'Unterseite') + ': Foto wird gelesen …';
      sides[side] = await new Promise((res, rej) => {
        importWorker.onmessage = e => {
          const m = e.data;
          if (m.type === 'progress') {
            bar.style.width = ((i + m.done / m.total) * 50).toFixed(1) + '%';
            txt.textContent = `${side === 'front' ? 'Oberseite' : 'Unterseite'}: ${m.done} / ${m.total} Kacheln`;
          } else if (m.type === 'imported') res({ w: m.w, h: m.h, L: m.L });
          else if (m.type === 'error') rej(new Error(m.message));
        };
        importWorker.onerror = e => rej(new Error(e.message || 'Worker-Fehler'));
        importWorker.postMessage({ type: 'import', pid, side, blob: side === 'front' ? fFront : fBack, thumb: side === 'front' });
      });
    }
    importWorker.terminate(); importWorker = null;
    const proj = { id: pid, name, created: Date.now(), updated: Date.now(), sides, align: { pre: { fx: true, fy: false, rot: 0 }, pairs: [] }, view: null, matAuto: true };
    await idbPutMany(S.db, 'projects', [[null, proj]]);
    return proj;
  } catch (e) {
    if (importWorker) { importWorker.terminate(); importWorker = null; }
    await deleteProjectData(pid).catch(() => {});
    throw e;
  }
}

// Sheet „Neues Projekt“ verdrahten
export function initNewProject() {
  $('#btnNew').onclick = () => { resetNew(); $('#sheetNew').hidden = false; };
  for (const side of ['front', 'back']) {
    const inp = side === 'front' ? $('#fileFront') : $('#fileBack');
    inp.onchange = () => {
      nf[side] = inp.files[0] || null;
      (side === 'front' ? $('#fnFront') : $('#fnBack')).textContent = nf[side] ? '✓ ' + nf[side].name : '';
      $('#newGo').disabled = !(nf.front && nf.back);
    };
  }
  $('#newCancel').onclick = () => {
    if (importWorker) { importWorker.terminate(); importWorker = null; }
    $('#sheetNew').hidden = true;
    cleanupOrphans();
  };
  $('#newGo').onclick = async () => {
    $('#newGo').disabled = true; $('#newErr').hidden = true;
    try {
      const p = await importProject($('#newName').value.trim() || 'Platine', nf.front, nf.back);
      $('#sheetNew').hidden = true;
      renderList();
      openProject(p);
    } catch (e) {
      $('#newErr').textContent = 'Import fehlgeschlagen: ' + e.message; $('#newErr').hidden = false;
      $('#newGo').disabled = !(nf.front && nf.back);
    }
  };
}
