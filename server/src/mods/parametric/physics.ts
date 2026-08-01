import {
  accelerationForMass as sharedAccelerationForMass,
  decelerationForMass as sharedDecelerationForMass,
  velocityForMass as sharedVelocityForMass,
  type MovementConfig,
} from '@angulio/shared';
import type { ParametricModConfig } from './config.js';

/** Traduit la config paramétrique complète vers le sous-ensemble minimal transmis au client
 * (voir `WelcomeMessage.movement`, protocol.ts) — un seul point de vérité pour ce mapping,
 * réutilisé par `connectionHandler.ts` au moment du `welcome`. */
export function toMovementConfig(config: ParametricModConfig): MovementConfig {
  return {
    ...config.physics,
    startMass: config.player.startMass,
    mapSize: config.arena.width,
    borderType: config.arena.borderType,
    mergeOverlapMinFraction: config.merge.overlapMinFraction,
    splitEnabled: config.player.splitEnabled,
    maxSplits: config.player.maxSplits,
    minSplitMass: config.player.minSplitMass,
  };
}

/** v(m) = MAX(Vfloor, V0·kv·(M0/m)^gamma) — feuille Excel, dictionnaire des variables. Délègue à
 * `@angulio/shared` (voir shared/src/movement.ts) : la même formule pure doit rester identique
 * côté client (prédiction locale, client/src/prediction.ts) et côté serveur (autorité). */
export function velocityForMass(mass: number, config: ParametricModConfig): number {
  return sharedVelocityForMass(mass, toMovementConfig(config));
}

/** a(m) = A0·(M0/m)^alpha — taux de rapprochement (px/s²) vers la vitesse cible, pas une
 * vitesse instantanée : remplace l'ancien mécanisme de "boost" de split ad hoc (metriques.md
 * v0.1 §4) par un seul modèle générique valable pour tout le mouvement. Mise en mouvement
 * uniquement — voir `decelerationForMass` pour le freinage. */
export function accelerationForMass(mass: number, config: ParametricModConfig): number {
  return sharedAccelerationForMass(mass, toMovementConfig(config));
}

/** d(m) = A0·(M0/m)^delta — voir `MovementConfig.decelerationMassExponent`
 * (shared/src/movement.ts) : taux de rapprochement dédié au FREINAGE (vitesse cible < vitesse
 * actuelle), distinct de `accelerationForMass` pour la mise en mouvement. */
export function decelerationForMass(mass: number, config: ParametricModConfig): number {
  return sharedDecelerationForMass(mass, toMovementConfig(config));
}

/** Repli si `config.player.splitEnabled` est absent — le split reste activé par défaut (Vanilla ne
 * le renseigne pas) ; seul Hardcore le passe explicitement à `false` (demande utilisateur : ne
 * garder que le Dash). */
export function splitEnabled(config: ParametricModConfig): boolean {
  return config.player.splitEnabled ?? true;
}

/** Repli si `config.player.ejectEnabled` est absent — l'éjection de masse reste activée par
 * défaut (Vanilla ne le renseigne pas) ; seul Hardcore le passe explicitement à `false` (demande
 * utilisateur : ne garder que le Dash, pas de nourrissage volontaire d'un allié). */
export function ejectEnabled(config: ParametricModConfig): boolean {
  return config.player.ejectEnabled ?? true;
}

/** Repli si `config.eating.eatOverlapFraction` est absent — 0.7 (70%, arrondi de 2/3) : valeur
 * d'origine du seuil, reprise telle quelle (voir historique de `handleEatAttempt`,
 * mods/parametric/index.ts et mods/hardcore/index.ts). */
const DEFAULT_EAT_OVERLAP_FRACTION = 0.7;

/** Fraction (0-1) de la surface de la cible qui doit être recouverte pour qu'un attaquant en
 * position d'avantage de masse la dévore intégralement d'un coup — seuil unique, partagé par
 * Vanilla et Hardcore (qui composent tous deux `handleEatAttempt` sur ce même seuil plutôt que de
 * le dupliquer en dur chacun de leur côté). */
export function eatOverlapFraction(config: ParametricModConfig): number {
  return config.eating.eatOverlapFraction ?? DEFAULT_EAT_OVERLAP_FRACTION;
}

/** Repli si `config.eating.absorptionDurationSec` est absent — 0.3s : assez court pour ne jamais
 * ressembler à un ancien "drain" continu (voir `beginConsumption`, mods/parametric/index.ts),
 * assez long pour que la victime se voie visiblement rétrécir avant de disparaître plutôt que de
 * s'effacer en un seul tick de simulation (~50ms à 20Hz — largement sous le seuil de perception
 * humaine pour un événement aussi soudain). */
const DEFAULT_ABSORPTION_DURATION_SEC = 0.3;

/** Durée (s) sur laquelle la masse d'une cible dont le seuil d'absorption vient d'être franchi
 * est transférée à l'attaquant — voir `beginConsumption`/`advanceConsumptions`,
 * mods/parametric/index.ts. Le seuil lui-même (`eatOverlapFraction`) n'est pas affecté : cette
 * durée ne concerne que l'ACTE de manger une fois la décision prise, jamais la décision
 * elle-même (la cible reste librement mangeable/non-mangeable exactement comme avant tant que le
 * seuil n'est pas franchi). */
export function absorptionDurationSec(config: ParametricModConfig): number {
  return config.eating.absorptionDurationSec ?? DEFAULT_ABSORPTION_DURATION_SEC;
}

/** Palier applicable à `mass` : le `DecayTier` de `minMass` le plus élevé restant <= `mass` (les
 * tiers n'ont pas besoin d'être pré-triés). `undefined` si aucun tier ne couvre cette masse (config
 * invalide — ne devrait jamais arriver en pratique, tout mode déclare un premier palier à
 * `minMass: 0`). */
function applicableDecayTier(mass: number, config: ParametricModConfig) {
  let best: ParametricModConfig['decay']['tiers'][number] | undefined;
  for (const tier of config.decay.tiers) {
    if (mass >= tier.minMass && (!best || tier.minMass > best.minMass)) best = tier;
  }
  return best;
}

/** Perte de masse passive — cahier des charges §4d ("formule de perte de masse en fonction de la
 * taille") : chaque mode définit désormais ses PROPRES paliers (`config.decay.tiers`) plutôt
 * qu'une courbe unique codée en dur partagée par tous les modes (comportement précédent : les
 * champs `config.decay.threshold`/`rateAboveThreshold`/... existaient mais n'étaient jamais lus
 * ici) — c'est ce qui permet à Vanilla de rester peu punitif et à Hardcore de l'être nettement
 * plus, à parité de masse. */
function decayLambda(mass: number, config: ParametricModConfig, timeSinceLastEatenS = 10): number {
  const floor = config.decay.floor ?? 2;
  if (mass <= floor || timeSinceLastEatenS < config.decay.graceSec) return 0;

  const tier = applicableDecayTier(mass, config);
  if (!tier || tier.rate <= 0) return 0;

  return -Math.log(1 - tier.rate) / tier.intervalSec;
}

export function applyPassiveDecay(
  mass: number,
  dt: number,
  config: ParametricModConfig,
  timeSinceLastEatenS = 10,
): number {
  const lambda = decayLambda(mass, config, timeSinceLastEatenS);
  if (lambda === 0) return mass;
  return Math.max(mass * Math.exp(-lambda * dt), config.decay.floor ?? 2);
}

/** Masse d'une nouvelle particule de nourriture — tirage pondéré parmi les types de pellets du
 * mode (`config.food.pelletTypes`, ex. Vert/Bleu/Jaune/Violet/Rouge/Orange/Rose/Multicolor,
 * chacun avec sa propre masse et son propre poids de spawn, différent par mode). Remplace
 * l'ancien modèle de distribution continue (`massMin`/`massMax`/`massSkewExponent`). */
export function randomFoodMass(config: ParametricModConfig): number {
  const { pelletTypes } = config.food;
  const totalWeight = pelletTypes.reduce((sum, type) => sum + type.weight, 0);
  let roll = Math.random() * totalWeight;
  for (const type of pelletTypes) {
    if (roll < type.weight) return type.mass;
    roll -= type.weight;
  }
  // Filet de sécurité : erreur d'arrondi flottant en bout de boucle, ou config invalide
  // (`pelletTypes` vide) — ne doit jamais planter sur un `undefined.mass`.
  const last = pelletTypes[pelletTypes.length - 1];
  return last ? last.mass : 1;
}

/** Nombre cible de particules de nourriture pour la carte actuelle, dérivé de la densité
 * (pellets / bloc de 1000×1000 px²) plutôt qu'un total fixe indépendant de la taille de carte.
 * Si aucun joueur humain n'est présent (humanCount === 0), la nourriture est réduite en mode ambiance (~30%). */
export function foodTargetCount(config: ParametricModConfig, humanCount: number = 1): number {
  const areaInBlocks = (config.arena.width * config.arena.height) / (1000 * 1000);
  const baseTarget = Math.round(config.food.density * areaInBlocks);
  if (humanCount === 0) {
    return Math.max(100, Math.round(baseTarget * 0.3));
  }
  return baseTarget;
}
