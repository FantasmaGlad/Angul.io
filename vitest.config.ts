import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      // Les tests utilisent toujours la source à jour de shared/, sans dépendre d'un build
      // préalable — package.json de shared pointe vers dist/ pour le runtime Node réel.
      '@angulio/shared': fileURLToPath(new URL('./shared/src/index.ts', import.meta.url)),
    },
  },
  test: {
    include: ['{shared,server,client,admin}/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    setupFiles: ['./vitest.setup.ts'],
  },
});
