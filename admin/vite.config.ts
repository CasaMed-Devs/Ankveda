import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';

/**
 * Dev server proxies /api to a backend so the dashboard runs same-origin, like on Firebase Hosting:
 *   ADMIN_API_PROXY=http://127.0.0.1:5001/ankveda-e6471/asia-south2/api   (Functions emulator)
 *   ADMIN_API_PROXY=http://127.0.0.1:8787/api                              (local Express)
 *   default: the staging API on Vercel.
 */
const target = new URL(process.env.ADMIN_API_PROXY ?? 'https://ankveda-backend.vercel.app/api');

/**
 * Root and alias come from the same source (this file's URL). On Windows the shell's working
 * directory can be "d:\…" while import.meta.url is "D:\…"; mixing the two made the bundler treat
 * node_modules/react as two modules → two React copies → "Cannot read properties of null (reading 'useState')".
 */
const root = fileURLToPath(new URL('.', import.meta.url));

export default defineConfig({
  root,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Belt and braces: there must only ever be one React.
    dedupe: ['react', 'react-dom'],
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: target.origin,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, target.pathname.replace(/\/$/, '')),
      },
    },
  },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
