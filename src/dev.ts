// ---------------------------------------------------------------- Testhilfe (nur mit ?dev)
// __devImport: Projekt aus URLs importieren. Außerdem werden alle Exporte der App-Module als globale Namen auf window
// gelegt (live, wie früher die globalen Namen der einen Datei), damit Testskripte per Runtime.evaluate z. B.
// `S.proj`, `openProject(p)`, `inflight===0 && want.size===0 && !rafId` nutzen können. Zuweisen geht nur, wo ein Setter steht.
import { setMatTint } from './material/state';
import { setRafId } from './render/frame';
import { openProject } from './ui/nav';
import { importProject, resetNew } from './ui/newProject';
import { setGest } from './ui/pointer';
import { renderList } from './ui/projectList';
import { $ } from './util';

const SETTERS: Record<string, (v: any) => void> = { rafId: setRafId, MAT_TINT: setMatTint, gest: setGest };

export function initDev() {
  if (!new URLSearchParams(location.search).has('dev')) return;
  (window as any).__devImport = async (name, uf, ub) => {
    const [a, b] = await Promise.all([uf, ub].map(u => fetch(u).then(r => r.blob())));
    resetNew(); $('#sheetNew').hidden = false;
    const p = await importProject(name, new File([a], 'front.jpg', { type: a.type }), new File([b], 'back.jpg', { type: b.type }));
    $('#sheetNew').hidden = true; renderList(); openProject(p);
    return p.id;
  };
  const mods = import.meta.glob(['./**/*.ts', '!./worker/**', '!./main.ts', '!./dev.ts', '!./**/*.d.ts'], { eager: true });
  for (const [file, ns] of Object.entries(mods)) for (const k of Object.keys(ns as object)) {
    // eigene Eigenschaften von window nicht überschreiben; Element-IDs (#gl, #toast …) schon, wie früher die globalen const
    if (Object.prototype.hasOwnProperty.call(window, k)) { console.warn('dev: Name schon vorhanden', k, file); continue; }
    Object.defineProperty(window, k, {
      configurable: true,
      get: () => ns[k],
      set: v => { const f = SETTERS[k]; if (!f) throw new TypeError('dev: ' + k + ' (' + file + ') ist nicht zuweisbar'); f(v); },
    });
  }
}
