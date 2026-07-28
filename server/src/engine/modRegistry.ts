import type { GameMod } from './mod.js';
import { createHardcoreMod } from '../mods/hardcore/index.js';
import { createParametricMod } from '../mods/parametric/index.js';
import type { ParametricModConfig } from '../mods/parametric/config.js';
import { listAvailableModIds, loadModConfig } from '../mods/parametric/loadConfig.js';
import { toMovementConfig } from '../mods/parametric/physics.js';
import type { ModResolver } from './roomManager.js';

/** Modes aux mécaniques structurellement nouvelles (Lot 4) — leur fichier de config reste au
 * format paramétrique standard (server/configs/*.json, réutilisé pour mouvement/split/fusion/
 * bords/nourriture), mais leur `GameMod` est écrit à la main plutôt que produit par
 * `createParametricMod` seul. Un mode absent d'ici est traité comme purement paramétrique
 * (Vanilla, et tout futur mode qui ne fait que régler des valeurs). */
const NON_PARAMETRIC_MOD_FACTORIES: Record<string, (config: ParametricModConfig) => GameMod> = {
  hardcore: createHardcoreMod,
};

/** Résolution d'un mod, extraite de `index.ts` (qui reste l'unique point d'entrée process
 * principal) pour être également importable par un worker de simulation (`roomWorker.ts`,
 * voir plan_implementation "worker_threads") : un `GameMod` contient des fonctions, non
 * clonables via `postMessage` — chaque worker doit donc reconstruire le mod lui-même à partir
 * du seul `modId` (une chaîne, sérialisable), plutôt que de recevoir un `GameMod` déjà résolu du
 * thread principal. */
export const resolveMod: ModResolver = (modId) => {
  const config = loadModConfig(modId);
  const factory = NON_PARAMETRIC_MOD_FACTORIES[modId] ?? createParametricMod;
  return {
    mod: factory(config),
    mapSize: config.arena.width,
    kArea: config.areaConstant,
    bots: config.bots,
    // Sous-ensemble minimal du modèle de mouvement, transmis au client via `welcome.movement`
    // pour la prédiction locale (voir client/src/prediction.ts) — valable pour tout mod construit
    // sur `ParametricModConfig` (parametric ET hardcore, qui hérite du mouvement du mod
    // paramétrique sous-jacent sans le modifier, voir mods/hardcore/index.ts).
    movement: toMovementConfig(config),
  };
};

export { listAvailableModIds };
