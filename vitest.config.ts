import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Les tests utilisent toujours la source à jour de shared/, sans dépendre d'un build
      // préalable — package.json de shared pointe vers dist/ pour le runtime Node réel. Le
      // sous-chemin `/render` (P2, plan-implementation-admin.md §4.1) DOIT être déclaré avant
      // l'alias racine `@angulio/shared` ci-dessous : Vite résout les alias objet dans l'ordre
      // d'écriture, et le remplacement racine ne gère pas lui-même les sous-chemins (il
      // produirait un chemin invalide du type ".../shared/src/index.ts/render").
      '@angulio/shared/render': fileURLToPath(new URL('./shared/src/render/index.ts', import.meta.url)),
      '@angulio/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['{shared,server,client,admin}/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
