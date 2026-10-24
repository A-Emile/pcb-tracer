// ---------------------------------------------------------------- Bildtakt
// dirty() fordert ein neues Bild an (höchstens eins je Animationsbild). Gezeichnet wird von der Szene,
// die main.ts mit setFrame() einträgt (render/scene.ts: drawFrame). Ohne Abhängigkeiten, damit alle Module dirty() nutzen können.
export let rafId = 0;
let frameFn = () => {};
export function setFrame(fn: () => void) { frameFn = fn; }
export function setRafId(v: number) { rafId = v; }   // für Testskripte (?dev)
export function dirty() { if (!rafId) rafId = requestAnimationFrame(render); }
export function render() {
  rafId = 0;
  frameFn();
}
