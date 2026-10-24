// ---------------------------------------------------------------- Analyse-Worker
// Ein Worker-Typ für alles, was im Hintergrund rechnet: Import (Kacheln), Fang am Via (snap), Via-Suche (vias),
// Material-Modell (mat; Masken rechnet die GPU, material/gpu.ts) und dessen Hilfs-Worker (labtiles). Gestartet als Modul-Worker über worker/client.ts; jede Instanz hat ihren eigenen Kachel-Zwischenspeicher.
import { scope } from './scope';
import { importSide } from './importSide';
import { labTiles, matModel } from './matModel';
import { rgb } from './rgb';
import { findVias, snapVia } from './vias';

scope.onmessage = async e => {
  const m = e.data;
  try {
    if (m.type === 'import') scope.postMessage({ type: 'imported', side: m.side, ...(await importSide(m)) });
    else if (m.type === 'snap') scope.postMessage({ type: 'snap', id: m.id, hit: await snapVia(m) });
    else if (m.type === 'vias') scope.postMessage({ type: 'vias', id: m.id, vias: await findVias(m) });
    else if (m.type === 'mat') scope.postMessage({ type: 'mat', side: m.side, meta: await matModel(m) });
    else if (m.type === 'labtiles') { const t = await labTiles(m); scope.postMessage({ type: 'labtiles', tiles: t }, t.flatMap(o => [o.L.buffer, o.A.buffer, o.B.buffer])); }
    else if (m.type === 'forget') { for (const k of [...rgb.keys()]) if (k.startsWith(m.pid + '|')) rgb.delete(k); }
  } catch (err) {
    scope.postMessage({ type: 'error', id: m.id, side: m.side, message: String((err && err.message) || err) });
  }
};
