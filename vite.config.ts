import { defineConfig } from 'vite';

export default defineConfig({
  // bench/ is dev-only: served by `vite` at /bench/, never part of the production build.
  build: { rollupOptions: { input: { main: 'index.html' } } },
  worker: { format: 'es' },
});
