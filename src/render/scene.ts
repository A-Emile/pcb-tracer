import { loupeCam, loupeRect } from '../align/loupe';
import { fxApply, fxBahnen, fxBuffers } from './fx';
import { gl } from './gl';
import { drawPane, setPaneGL } from './layer';
import { drawLinesGL } from './lines';
import { drawOverlay } from './overlay';
import { nextFrame, pump } from './tiles';
import { S } from '../state';
import { matPump } from '../material/gpu';

// Ein Bild: Kacheln aller Fenster (ggf. über den Filter-Puffer), Linien, Lupe, dann das 2D-Overlay.
// Aufgerufen über render() aus render/frame.ts (dort auch dirty()).
export function drawFrame() {
  if (!S.proj || !gl) return;
  nextFrame();
  const kAmt = S.mode === 'main' && (!S.loupe || S.loupe.keepFx) ? fxBahnen() : 0;
  gl.disable(gl.SCISSOR_TEST);
  if (kAmt > 0) gl.bindFramebuffer(gl.FRAMEBUFFER, fxBuffers().fbA);
  gl.viewport(0, 0, gl.canvas.width, gl.canvas.height);
  gl.clearColor(0.043, 0.051, 0.063, 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.STENCIL_BUFFER_BIT);
  gl.enable(gl.SCISSOR_TEST);
  for (const p of S.panes) drawPane(p, S.cams[p.id]);
  if (kAmt > 0) fxApply(S.cams.main, kAmt);
  if (S.mode === 'main') drawLinesGL(S.panes[0], S.cams.main);
  if (S.loupe) {
    const L = loupeRect();
    setPaneGL(L);
    gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    drawPane({ ...L, id: S.loupe.pane.id }, loupeCam());
    if (S.loupe.pane.id === 'main') drawLinesGL(L, loupeCam(), true);
  }
  gl.disable(gl.SCISSOR_TEST);
  // Zielalpha (Durchsicht-Maske) wieder deckend machen, sonst scheint die Seite durch die Zeichenfläche
  gl.colorMask(false, false, false, true); gl.clearColor(0, 0, 0, 1); gl.clear(gl.COLOR_BUFFER_BIT); gl.colorMask(true, true, true, true);
  matPump();   // Material-Masken der gewünschten Kacheln auf der GPU (material/gpu.ts)
  pump();
  drawOverlay();
}
