import { defineConfig } from 'vite';

export default defineConfig({
  server: { host: true }, // reachable from a phone on the same Wi-Fi
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
});
