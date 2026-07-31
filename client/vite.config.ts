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
      // Musiques/logo : copiés dans `public/` par `prebuild` (voir package.json), pas dans
      // `static/` (voir commentaire d'en-tête) — `publicDir: 'static'` ci-dessus fait que
      // `vite dev` ne les sert jamais lui-même, contrairement au vrai serveur Node (`staticDir`
      // = `client/public`, server/src/index.ts). Sans ce proxy, ces deux chemins retombaient
      // silencieusement sur le fallback SPA (200, `text/html`) en dev — un <img>/<audio> qui
      // semblait fonctionner (200 OK) mais ne chargeait jamais le bon contenu.
      '/assets/Logos': 'http://localhost:8080',
      '/assets/Sons': 'http://localhost:8080',
      '/assets/Profil': 'http://localhost:8080',
      '/assets/Joystick': 'http://localhost:8080',
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
