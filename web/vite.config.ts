import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Builds into ../public/app (committed). The Node server serves it at /app/ with no install needed.
// `npm run dev` proxies the JSON API to the Node server (run `node src/server.js` in the repo root).
const api = process.env.API_URL || 'http://localhost:3000';
export default defineConfig({
  base: '/app/',
  plugins: [react(), tailwindcss()],
  build: {
    outDir: '../public/app',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1600, // AG Grid / AG Charts are large but lazy-loaded per route
  },
  server: {
    port: 5173,
    proxy: { '/api': api, '/paypal': api, '/mock-paypal': api, '/.well-known': api },
  },
});
