import type { Project } from '../types';
import { idbPutMany } from './idb';
import { S } from '../state';
import { toast } from '../ui/toast';

// ---------------------------------------------------------------- Speicher
export async function listProjects() {
  return new Promise<Project[]>((res, rej) => {
    const r = S.db.transaction('projects').objectStore('projects').getAll();
    r.onsuccess = () => res(r.result.sort((a, b) => b.updated - a.updated)); r.onerror = () => rej(r.error);
  });
}
export function deleteProjectData(pid) {
  return new Promise<void>((res, rej) => {
    const tx = S.db.transaction(['projects', 'files', 'tiles'], 'readwrite');
    const range = IDBKeyRange.bound(pid + '|', pid + '|￿');
    tx.objectStore('projects').delete(pid);
    tx.objectStore('files').delete(range);
    tx.objectStore('tiles').delete(range);
    tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error);
  });
}
export async function cleanupOrphans() {
  const ids = new Set((await listProjects()).map(p => p.id)), orphans = new Set();
  for (const store of ['files', 'tiles']) {
    const keys = await new Promise<IDBValidKey[]>(res => { const r = S.db.transaction(store).objectStore(store).getAllKeys(); r.onsuccess = () => res(r.result); r.onerror = () => res([]); });
    for (const k of keys) { const pid = String(k).split('|')[0]; if (!ids.has(pid)) orphans.add(pid); }
  }
  for (const pid of orphans) await deleteProjectData(pid);
}
export let saveTimer = 0;
export function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveNow, 500); }
export async function saveNow() {
  clearTimeout(saveTimer);
  const p = S.proj;
  if (!p) return;
  p.updated = Date.now();
  if (S.cams.main) p.view = { cx: S.cams.main.cx, cy: S.cams.main.cy, s: S.cams.main.s, t: S.t, draw: !!S.draw, tr: !!S.tr };
  try { await idbPutMany(S.db, 'projects', [[null, p]]); }
  catch (e) { toast('Nicht gespeichert: ' + e.message, 6000); }
}
