import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import globals from 'globals';

export default tseslint.config(
  {
    // client/public/**, admin/public/** contiennent le bundle généré par esbuild : jamais linté.
    ignores: ['**/dist/**', '**/node_modules/**', 'client/public/**', 'admin/public/**'],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Scripts Node autonomes (pas de type-checking TypeScript ici, donc no-undef reste actif).
    files: ['**/*.mjs', '**/*.cjs'],
    languageOptions: {
      globals: globals.node,
    },
  },
  eslintConfigPrettier,
);
