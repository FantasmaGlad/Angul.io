/** Moteur de rendu du jeu, mutualisé entre `client/` (joueur, fond spectateur du lobby) et
 * `admin/` (studio) — extrait de `client/src/render.ts`/`renderEngine.ts` (P2,
 * plan-implementation-admin.md §4.1, correctif A16). Sous-chemin d'export dédié
 * (`@angulio/shared/render`, voir `package.json`) plutôt que barrel principal : ce module dépend
 * du DOM (Canvas2D, `Image`, `HTMLCanvasElement`), contrairement au reste de `shared/`, qui reste
 * 100% logique pure — `server/` n'importe jamais ce sous-chemin. */
export * from './camera.js';
export * from './sectors.js';
export * from './stats.js';
export * from './render.js';
export * from './renderEngine.js';
