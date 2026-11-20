import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset URLs, so the build works at the site root or behind a
  // reverse proxy under a sub-path (e.g. https://base.domain.com/v1/).
  base: './',
  server: { host: true }, // reachable from a phone on the same Wi-Fi
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
});
