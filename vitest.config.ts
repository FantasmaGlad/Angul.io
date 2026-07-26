import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['{shared,server,client,admin}/src/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
  },
});
