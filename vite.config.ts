import { defineConfig } from 'vite';

// In dev, the Vite server proxies WebSocket traffic to the Node server (see `dev:server`).
export default defineConfig({
  server: {
    host: true,
    proxy: {
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
