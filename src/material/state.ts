import { fxQuiet, lookState } from '../state';

// ---------------------------------------------------------------- Material-Ansicht: Nur Kupfer, Kupferflächen, Druck, Hintergrund
// Gilt für alle Lagen gemeinsam (p.look.mat). Das Modell (Farben, Bahnbreite, Helligkeitsausgleich, Umriss) entsteht einmal pro Bild
// im Worker (worker/matModel.ts, ≈ 1,5 s) und liegt danach in IndexedDB (files `pid|mat|side`, Version MAT_V); gestartet nach dem Import
// oder beim ersten Einschalten. Die Masken rechnet die GPU je Kachel beim Anzeigen (material/gpu.ts), sichtbare Kacheln zuerst.
// Wächter (material/run.ts): meldet sich ein Worker MAT_WD ms nicht, wird er einmal neu gestartet, danach Fehler angezeigt.
// Bei „Nur Kupfer“: Kupfer der gezeigten Lage in Originalfarbe, Kupfer der anderen Lagen in deren Lagenfarbe (MAT_TINT).
// Gewählt (Vergleich siehe Bericht): alle Lagen in Lagenfarbe, vorne/hinten so auf einen Blick unterscheidbar; 'others' = gezeigte Lage in Originalfarbe
export let MAT_TINT = 'all';
export function setMatTint(v) { MAT_TINT = v; }   // für Testskripte (?dev)
// meta/out/work/prog/err je Lage; seen = letzte Nachricht des Workers (Wächter), retry = Neustarts, tMeta/t0 nur Diagnose
export const MAT = { meta: {}, out: {}, work: {}, prog: {}, err: {}, seen: {}, retry: {}, t0: 0, tMeta: {} as Record<string, number> };
export const MATG: Record<string, any> = {}, MAT_WD = 20000;   // MATG: GPU-Zustand je Lage (material/gpu.ts mgSide)
export function matLook() { const lk = lookState(); return lk.mat || (lk.mat = { cu: false, pour: false, silk: false, bg: false }); }
export const matAny = () => { const m = matLook(); return m.cu || m.silk || m.bg; };
export const matOn = () => !fxQuiet() && matAny();
export const matState = id => MAT.meta[id] && MAT.out[id] && MATG[id] ? { meta: MAT.meta[id], out: MAT.out[id], g: MATG[id] } : null;
