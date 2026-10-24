import { rebuildAlign, updateAlignBar } from '../align/align';
import { stActive, stExit } from '../align/straight';
import { ana, getVias, viaCache, viaWorkers } from '../align/snap';
import { saveNow, saveSoon } from '../db/projects';
import { finishStroke } from '../draw/gestures';
import { selectObj } from '../draw/menu';
import { setDraw, updateDrawUI } from '../draw/mode';
import { closeNote } from '../draw/note';
import { resetRedo } from '../draw/edit';
import { netInit } from '../draw/nets';
import { migrateObjs } from '../draw/objects';
import { ED, dragCancel } from '../draw/trEdit';
import { TR, setTrace, trClearHi, trFinish, trLoadVias, updateTrUI } from '../draw/trace';
import { migrateTexts } from '../draw/text';
import { updateSideUI } from '../layers/actions';
import { migrateLook } from '../layers/model';
import { matOpen, matReset } from '../material/run';
import { dirty } from '../render/frame';
import { dropTextures } from '../render/tiles';
import { S, lookState } from '../state';
import { gest, setGest } from './pointer';
import { renderList } from './projectList';
import { netsOpen, showNets } from './netsheet';
import { panelWanted, sheetOpen, showSheet } from './sheet';
import { $, clamp } from '../util';
import { camFrontToMain, camMainToFront, clampCam, layout, linkFrom } from '../view/camera';

// ---------------------------------------------------------------- Modi & Navigation
export function setMode(m) {
  stExit();
  if (m !== 'main') { if (S.note) closeNote(); if (S.proj && S.proj.route) trFinish(); S.tr = false; S.draw = false; S.stroke = null; S.omove = null; S.pick.clear(); $('#objMenu').hidden = true; }
  S.mode = m;
  $('#barMain').hidden = m !== 'main';
  $('#barAlign').hidden = m !== 'align';
  S.pending = null; S.sel = null; S.props = null; S.loupe = null; setGest(null);
  if (m !== 'main') { S.before = false; S.hold = false; $('#sheetView').hidden = true; }
  else if (panelWanted()) $('#sheetView').hidden = false;
  if (m === 'align') {
    // Ausrichte-Fenster an der aktuellen Hauptansicht ausrichten
    S.cams.front = null; S.cams.back = null;
  }
  layout();
  if (m === 'align') { getVias('front'); getVias('back'); }
  if (m === 'align' && S.cams.main && S.proj.align.pairs.length) {
    const c = S.cams.main;
    camMainToFront(c, S.cams.front);
    linkFrom('front');
  }
  if (m === 'main' && S.cams.front && S.cams.main && S.proj.align.pairs.length) {
    camFrontToMain(S.cams.front, S.cams.main);
    clampCam('main');
  }
  updateSideUI(); updateAlignBar(); updateDrawUI(); updateTrUI(); dirty();
}
export async function openProject(p) {
  dropTextures(); matReset();
  if (S.note) closeNote();
  const migrated = (migrateLook(p) as any) | (migrateObjs(p) as any);
  S.proj = p; S.cams = {}; S.undo = []; S.pending = null; S.sel = null;
  S.pick.clear(); S.oundo = []; S.draw = false; S.tr = false; TR.hiId = null; S.stroke = null; S.omove = null; $('#objMenu').hidden = true;
  S.before = false; S.hold = false;
  $('#pname').textContent = p.name;
  $('#list').hidden = true; $('#proj').hidden = false;
  rebuildAlign();
  getVias('front'); getVias('back');
  S.mode = p.align.pairs.length >= 3 ? 'main' : 'align';
  setMode(S.mode);
  if (p.view && S.cams.main) Object.assign(S.cams.main, { cx: p.view.cx, cy: p.view.cy, s: p.view.s });
  const mt = migrateTexts(p);   // alte Notiz-Nadeln → Textfelder (braucht Ausrichtung und Ansicht)
  resetRedo(); ED.whole = null; ED.drag = null; TR.tool = 'bahn';
  const nm = netInit(p);   // Netz-Objekte für ältere Stände (feste Nummern, draw/nets.ts)
  if (netsOpen()) showNets(false);
  S.t = clamp(p.view && +p.view.t || 0, 0, 1);
  $('#fade').value = Math.round(S.t * 100);
  S.before = false; $('#sheetView').hidden = !panelWanted();
  updateSideUI();
  if (S.mode === 'main' && p.view && p.view.draw) { S.draw = true; lookState().hideObjs = false; }
  // Modus Bahnen samt angefangener Bahn wieder aufnehmen
  if (S.mode === 'main' && !S.draw && ((p.view && p.view.tr) || p.route)) { S.tr = true; lookState().hideTr = false; trLoadVias(); }
  else if (p.route) p.route = null;
  updateDrawUI(); updateTrUI();
  history.pushState({ p: p.id }, '');
  if (migrated || mt || nm) saveSoon();
  matOpen(p);
  dirty();
}
export async function closeProject() {
  if (S.note) closeNote();
  S.draw = false; S.pick.clear(); $('#objMenu').hidden = true;
  await saveNow();
  S.tr = false; S.loupe = null;
  if (ana) ana.postMessage({ type: 'forget', pid: S.proj.id });
  for (const k in viaWorkers) { viaWorkers[k].terminate(); delete viaWorkers[k]; }
  for (const k in viaCache) delete viaCache[k];
  dropTextures(); matReset();
  S.proj = null;
  $('#proj').hidden = true; $('#list').hidden = false;
  renderList();
}
// Zurück (Android-Geste) und Esc schließen in dieser Reihenfolge: Menü ⋯, Notiz, Menü am Objekt, Zeichenmodus, Sheet Ansicht
export function backStep() {
  if (stActive()) { stExit(); return true; }
  if (!$('#sheetMenu').hidden) { $('#sheetMenu').hidden = true; return true; }
  if (S.note) { closeNote(); return true; }
  if (S.tr && S.proj.route) { trFinish(); return true; }
  if (ED.drag) { dragCancel(); return true; }
  if (netsOpen()) { showNets(false); return true; }
  if (S.pick.size || TR.hiId) { trClearHi(); return true; }
  if (S.draw) { setDraw(false); return true; }
  if (S.tr) { setTrace(false); return true; }
  if (sheetOpen()) { showSheet(false); return true; }
  return false;
}

// Zurück-Geste, Menü ⋯ und App-Wechsel verdrahten
export function initNav() {
  window.addEventListener('popstate', () => {
    if (!S.proj) return;
    if (backStep()) { history.pushState({ p: S.proj.id }, ''); return; }
    if (S.mode === 'align' && S.proj.align.pairs.length >= 3) { setMode('main'); history.pushState({ p: S.proj.id }, ''); return; }
    closeProject();
  });
  $('#btnBack').onclick = () => history.back();
  $('#btnMenu').onclick = () => { $('#sheetMenu').hidden = false; };
  $('#mClose').onclick = () => { $('#sheetMenu').hidden = true; };
  $('#mAlign').onclick = () => { $('#sheetMenu').hidden = true; setMode('align'); };
  $('#mList').onclick = () => { $('#sheetMenu').hidden = true; history.back(); };
  $('#sheetMenu').onclick = e => { if (e.target.id === 'sheetMenu') e.target.hidden = true; };
  // App-Wechsel: angefangenen Strich übernehmen (der Notiztext steht schon beim Tippen im Objekt), dann sofort speichern
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'hidden') return;
    if (gest && gest.kind === 'trt') { S.loupe = null; S.preview = null; setGest({ kind: 'none', pane: gest.pane }); }
    if (ED.drag) { dragCancel(); if (gest && gest.kind === 'trh') setGest({ kind: 'none', pane: gest.pane }); S.loupe = null; }
    if (S.stroke && S.proj) { const o = finishStroke(); if (o) selectObj(o.id); if (gest && gest.kind === 'draw') setGest({ kind: 'none', pane: gest.pane }); }
    saveNow();
  });
}
