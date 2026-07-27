import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/** Build servi tel quel par server/src/index.ts (`adminStaticDir` pointe sur `admin/public`,
 * non modifié par cette migration) — d'où `outDir: 'public'`. Pas de `publicDir` (aucun
 * fichier "vraiment statique" à copier ici, contrairement au client — pas de manifeste PWA ni
 * d'icônes pour l'admin), donc désactivé pour éviter tout conflit avec `outDir`. */
export default defineConfig({
  plugins: [react()],
  // L'admin est servie sous `/admin/*` par server/src/net/server.ts (préfixe retiré puis le
  // reste résolu dans `adminStaticDir`) — sans ce préfixe, les assets construits par Vite
  // (`/bundle.js`) résoudraient vers le bundle du client joueur, pas celui-ci (même piège que
  // documenté dans l'ancien index.html statique).
  base: '/admin/',
  publicDir: false,
  build: {
    outDir: 'public',
    emptyOutDir: true,
    rollupOptions: {
      output: {
        entryFileNames: 'bundle.js',
        chunkFileNames: 'chunk-[name].js',
        assetFileNames: 'bundle.[ext]',
      },
    },
  },
});
