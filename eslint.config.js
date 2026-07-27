import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import globals from 'globals';

export default tseslint.config(
  {
    // client/public/**, admin/public/** contiennent le bundle généré par Vite : jamais linté.
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
  {
    // Service worker (Lot 7.2) : JS brut chargé directement par le navigateur, globals propres
    // (self/caches/fetch/URL) plutôt que ceux du DOM classique.
    files: ['**/service-worker.js'],
    languageOptions: {
      globals: globals.serviceworker,
    },
  },
  {
    // Composants React (client/admin) : règles des Hooks (dépendances manquantes, ordre
    // d'appel) — attrape des bugs réels (state jamais mis à jour, effet qui boucle).
    files: ['**/*.tsx'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // `set-state-in-effect` remonte aussi le pattern standard "fetch au montage, setState au
      // résultat" (App.tsx `refreshLobby`, etc.) — un vrai anti-pattern qu'elle vise (dériver un
      // state depuis un autre au lieu de le calculer pendant le rendu) est différent d'un appel
      // réseau asynchrone, qui n'a pas d'alternative sans librairie de data-fetching dédiée.
      'react-hooks/set-state-in-effect': 'off',
    },
  },
  eslintConfigPrettier,
);
