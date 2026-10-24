import { idbGet } from '../db/idb';
import { deleteProjectData, listProjects } from '../db/projects';
import { S } from '../state';
import { openProject } from './nav';
import { $ } from '../util';

// ---------------------------------------------------------------- Projektliste
export const thumbURLs = [];
export async function renderList() {
  thumbURLs.splice(0).forEach(u => URL.revokeObjectURL(u));
  const list = (await listProjects()).filter(p => p.id !== pendingDelete?.id), el = $('#plist');
  el.innerHTML = '';
  if (!list.length) { el.innerHTML = '<div class="empty">Noch kein Projekt.<br>Lege eins an und wähle ein Foto der Ober- und eins der Unterseite.</div>'; }
  for (const p of list) {
    const it = document.createElement('div'); it.className = 'pitem';
    const thumb = await idbGet(S.db, 'files', p.id + '|thumb');
    const img: any = document.createElement(thumb ? 'img' : 'div');
    if (thumb) { const u = URL.createObjectURL(thumb); thumbURLs.push(u); img.src = u; img.alt = ''; } else img.className = 'noimg';
    const meta = document.createElement('div'); meta.className = 'meta';
    const nm = document.createElement('div'); nm.className = 'name'; nm.textContent = p.name;
    const sub = document.createElement('div'); sub.className = 'sub';
    sub.textContent = new Date(p.updated).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }) + ' · ' + p.align.pairs.length + ' Ausrichtpaare';
    meta.append(nm, sub);
    const more = document.createElement('button'); more.textContent = '⋯'; more.setAttribute('aria-label', 'Optionen');
    more.onclick = e => { e.stopPropagation(); openItemSheet(p); };
    it.append(img, meta, more);
    it.onclick = () => openProject(p);
    el.append(it);
  }
  updateStoreInfo();
}
export async function updateStoreInfo() {
  const el = $('#storeInfo');
  try {
    const [persisted, est] = await Promise.all([navigator.storage?.persisted?.() ?? false, navigator.storage?.estimate?.()]);
    const mb = est ? (est.usage / 1048576).toFixed(0) : '?';
    el.className = 'info' + (persisted ? '' : ' warn');
    el.textContent = `Belegt: ${mb} MB · ` + (persisted ? 'Speicher dauerhaft' : 'Speicher nicht dauerhaft – Export ist die Sicherung');
  } catch { el.textContent = ''; }
}
export let itemProj = null;
export function openItemSheet(p) { itemProj = p; $('#itemTitle').textContent = p.name; $('#sheetItem').hidden = false; }
export let pendingDelete = null;
export async function finishDelete() {
  if (!pendingDelete) return;
  const d = pendingDelete; pendingDelete = null;
  clearTimeout(d.timer); $('#undoToast').hidden = true;
  await deleteProjectData(d.id);
  if (!$('#list').hidden) renderList();
}

// Sheets der Projektliste verdrahten
export function initProjectList() {
  $('#iClose').onclick = () => { $('#sheetItem').hidden = true; };
  $('#sheetItem').onclick = e => { if (e.target.id === 'sheetItem') e.target.hidden = true; };
  $('#iOpen').onclick = () => { $('#sheetItem').hidden = true; openProject(itemProj); };
  $('#iDelete').onclick = () => {
    $('#sheetItem').hidden = true;
    $('#confTitle').textContent = `„${itemProj.name}“ löschen?`;
    $('#confText').textContent = 'Fotos, Ausrichtung und alles Gezeichnete dieses Projekts werden entfernt.';
    $('#sheetConfirm').hidden = false;
  };
  $('#confNo').onclick = () => { $('#sheetConfirm').hidden = true; };
  $('#confYes').onclick = () => {
    $('#sheetConfirm').hidden = true;
    finishDelete();
    const p = itemProj;
    pendingDelete = { id: p.id, timer: setTimeout(finishDelete, 10000) };
    $('#undoText').textContent = `„${p.name}“ gelöscht`;
    $('#undoToast').hidden = false;
    renderList();
  };
  $('#undoBtn').onclick = () => { if (!pendingDelete) return; clearTimeout(pendingDelete.timer); pendingDelete = null; $('#undoToast').hidden = true; renderList(); };
}
