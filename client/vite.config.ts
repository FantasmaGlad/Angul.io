import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Build servi tel quel par server/src/index.ts (`staticDir` pointe sur `client/public`, non
 * modifié par cette migration) — d'où `outDir: 'public'`. Les fichiers "vraiment statiques"
 * (icônes PWA, manifest, service worker) vivent dans `static/` (voir `publicDir`) plutôt que
 * `public/`, qui devient un dossier entièrement généré par le build (voir .gitignore). */
export default defineConfig({
  plugins: [react()],
  publicDir: 'static',
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:8080',
      '/': {
        target: 'ws://localhost:8080',
        ws: true,
        bypass: (req) => {
          if (!req.url?.includes('roomId=')) {
            return req.url;
          }
        },
      },
    },
  },
  build: {
    outDir: 'public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Noms de fichiers fixes (pas de hash) : le service worker (static/service-worker.js)
        // précache une liste d'URLs figée, plus simple à maintenir sans nom de fichier versionné.
        entryFileNames: 'bundle.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'bundle.[ext]',
      },
    },
  },
});
