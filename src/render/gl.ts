import { $ } from '../util';
import { FS_BASE, FS_BLUR, FS_COMP, FS_MAT, VQ, VS } from './shaders';

// ---------------------------------------------------------------- Kacheln & Rendering
// alpha: true (Kontext unverändert); am Ende jedes Bildes wird die Zielalpha wieder auf 1 gesetzt
export const gl: WebGL2RenderingContext = $('#gl').getContext('webgl2', { antialias: false, stencil: true, alpha: true, premultipliedAlpha: false });
export const ov: HTMLCanvasElement = $('#ov'), octx: CanvasRenderingContext2D = ov.getContext('2d');
// P: aktuell benutztes Programm (Uniform-Orte als Felder, siehe mk)
export let vao, vao0, vbuf, P: any = null, progBase, progMat, progBlur, progComp;
(function initGL() {
  if (!gl) return;
  const sh = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
  const mk = (vs, fs, names) => {
    const prog = gl.createProgram();
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, fs));
    gl.bindAttribLocation(prog, 0, 'aPos'); gl.bindAttribLocation(prog, 1, 'aUV');
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    const o: any = { prog };
    for (const n of names) o[n] = gl.getUniformLocation(prog, n);
    return o;
  };
  const TU = ['uC', 'uS', 'uHalf', 'uA', 'uR'];
  progBase = mk(VS, FS_BASE, TU);
  progMat = mk(VS, FS_MAT, [...TU, 'uM', 'uO', 'uOn', 'uFill', 'uOutV', 'uMT', 'uGT', 'uVis', 'uTint', 'uRing']);
  useP(progMat); gl.uniform1i(progMat.uM, 1); gl.uniform1i(progMat.uO, 2);
  progBlur = mk(VQ, FS_BLUR, ['uSrc', 'uLod', 'uDir', 'uInv', 'uW']);
  progComp = mk(VQ, FS_COMP, ['uA', 'uB', 'uInv', 'uK', 'uC']);
  vao0 = gl.createVertexArray();
  vao = gl.createVertexArray(); gl.bindVertexArray(vao);
  vbuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, vbuf);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 16, 0);
  gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 16, 8);
  useP(progBase);
  gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
})();
export function useP(p) { if (P !== p) { gl.useProgram(p.prog); P = p; } }
