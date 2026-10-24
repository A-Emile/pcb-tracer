import { defineConfig } from 'vite';

// base './': die gebaute Seite läuft unter beliebigem Pfad (GitHub Pages /pcb-tracer/, lokale Testserver)
export default defineConfig({
  base: './',
  worker: { format: 'es' },
  build: { target: 'es2022', outDir: 'dist', emptyOutDir: true },
});
