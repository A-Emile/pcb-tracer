import { $ } from '../util';

// ---------------------------------------------------------------- Meldung oben (#toast)
export let toastTimer = 0;
export function toast(msg, ms = 3500) {
  const t = $('#toast'); t.textContent = msg; t.classList.remove('undo'); t.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}
// eigener Ablauf einer Meldung (z. B. mit Rückgängig-Knopf, draw/edit.ts): ersetzt den laufenden Zeitgeber
export function toastLater(fn, ms) { clearTimeout(toastTimer); toastTimer = setTimeout(fn, ms); }
