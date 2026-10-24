// Neuer Analyse-Worker (Modul-Worker; Vite baut ihn als eigene Datei unter assets/)
export const newWorker = () => new Worker(new URL('./analysis.worker.ts', import.meta.url), { type: 'module' });
