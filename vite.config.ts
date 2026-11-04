import { defineConfig } from 'vite';

export default defineConfig({
  // bench/ is dev-only: served by `vite` at /bench/, never part of the production build.
  // three.js (the 3-D stage, ~570 kB, ~150 kB gzipped) is its own chunk, loaded on the first Train or Drive; the
  // workbench itself is ~70 kB.
  // The legal pages are their own small pages, served at /privacy, /terms and /cookies (vercel.json).
  build: {
    rollupOptions: { input: { main: 'index.html', privacy: 'privacy.html', terms: 'terms.html', cookies: 'cookies.html' } },
    chunkSizeWarningLimit: 600,
  },
  worker: { format: 'es' },
});
