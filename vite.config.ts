import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import handler from './api/aircraft';
import enrichment from './api/enrichment';
import session from './api/session';
import routeReview from './api/route-review';
export default defineConfig(({ mode }) => ({
  plugins: [
    react(),
    {
      name: 'local-aircraft-api',
      configureServer(server) {
        const env = loadEnv(mode, process.cwd(), 'AERO_');
        for (const [key, value] of Object.entries(env))
          process.env[key] ??= value;
        server.middlewares.use((req, res, next) => {
          if (req.url?.split('?')[0] === '/api/route-review') {
            routeReview(req, res);
            return;
          }
          if (req.url?.split('?')[0] === '/api/session') {void session(req,res);return;}
          if (req.url?.split('?')[0] === '/api/enrichment') {
            void enrichment(req, res);
            return;
          }
          if (req.url?.split('?')[0] === '/api/aircraft') {
            void handler(req, res);
            return;
          }
          next();
        });
      },
    },
  ],
  server: { host: '127.0.0.1', allowedHosts: ['terminal.local'] },
  build: {
    target: 'safari15',
    cssTarget: 'safari15',
    modulePreload: { polyfill: true },
    sourcemap: false,
  },
}));
