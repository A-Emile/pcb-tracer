// ---------------------------------------------------------------- Start
// Lädt die Module, verdrahtet die Bedienelemente (Reihenfolge wie früher in der einen Datei) und öffnet die Datenbank.
import './styles/main.css';
import { initAlignBar } from './align/bar';
import { initStraight } from './align/straight';
import { openDB } from './db/idb';
import { cleanupOrphans } from './db/projects';
import { initDev } from './dev';
import { initDrawUI } from './draw/mode';
import { initNote } from './draw/note';
import { initTraceUI } from './draw/trace';
import { initNets } from './ui/netsheet';
import { initLayerUI } from './layers/actions';
import { initMatUI } from './material/run';
import { setFrame } from './render/frame';
import { gl } from './render/gl';
import { drawFrame } from './render/scene';
import { S } from './state';
import { initGestures } from './ui/gestures';
import { initKeyboard } from './ui/keyboard';
import { initNav } from './ui/nav';
import { initNewProject } from './ui/newProject';
import { initProjectList, renderList } from './ui/projectList';
import { initSheet } from './ui/sheet';
import { initCamera } from './view/camera';
import { initOrient } from './view/orient';

setFrame(drawFrame);
initCamera();
initNote();
initDrawUI();
initTraceUI();
initNets();
initGestures();
initLayerUI();
initKeyboard();
initSheet();
initMatUI();
initNav();
initAlignBar();
initProjectList();
initNewProject();
initStraight();
initOrient();
initDev();

(async () => {
  if (!gl) { document.body.innerHTML = '<p style="padding:24px">Dieser Browser unterstützt kein WebGL2.</p>'; return; }
  S.db = await openDB();
  await cleanupOrphans();
  renderList();
})();
