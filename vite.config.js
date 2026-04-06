import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { buildShareUrl } from './share-url.js';

export default defineConfig({
  plugins: [
    react(),
    {
      name: 'share-url-endpoint',
      configureServer(server) {
        server.middlewares.use('/share-url', (_req, res) => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ url: buildShareUrl(5173) }));
        });
      },
    },
  ],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
  },
});
