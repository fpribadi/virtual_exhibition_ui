import { defineConfig } from 'vite';

export default defineConfig(({ command }) => ({
  // Relative asset URLs, so the build works at the site root or behind a
  // reverse proxy under a sub-path (e.g. https://base.domain.com/v1/).
  base: './',
  server: { host: true }, // reachable from a phone on the same Wi-Fi
  build: { chunkSizeWarningLimit: 800 }, // three.js alone is ~600 kB
  define: {
    // Unique per production build. When it changes, browsers drop their old
    // autosave on the next visit (see checkRelease in src/storage.js).
    // Override with BUILD_ID=... to control it, e.g. a git tag.
    __BUILD_ID__: JSON.stringify(command === 'build' ? process.env.BUILD_ID || new Date().toISOString() : 'dev'),
  },
}));
