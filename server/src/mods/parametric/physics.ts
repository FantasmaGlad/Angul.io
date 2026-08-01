import {
  accelerationForMass as sharedAccelerationForMass,
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
    mergeOverlapMinFraction: config.merge.overlapMinFraction,
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
 * v0.1 §4) par un seul modèle générique valable pour tout le mouvement. */
export function accelerationForMass(mass: number, config: ParametricModConfig): number {
  return sharedAccelerationForMass(mass, toMovementConfig(config));
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
 * s'effacer en un seul tick de simulation (~33ms à 30Hz — largement sous le seuil de perception
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

function decayLambda(mass: number, config: ParametricModConfig, timeSinceLastEatenS = 10): number {
  const floor = config.decay.floor ?? 2;
  const decayDelayS = mass > 20000 ? 0.5 : 10;
  if (mass <= floor || timeSinceLastEatenS < decayDelayS) return 0;

  let rate = 0.002;
  let intervalSec = 10;

  if (mass > 20000) {
    const dizaines = Math.floor(mass / 10000);
    rate = dizaines * 0.01;
    intervalSec = 0.5;
  } else if (mass > 10000) {
    // Incrémenter la perte de 1% par 5s pour chaque dizaine de milliers de masse (ex: 30 000 -> 3% en 5s)
    const dizaines = Math.floor(mass / 10000);
    rate = dizaines * 0.01;
    intervalSec = 5;
  } else if (mass > 2000) {
    // 1% par 10s au dessus de 2000 jusqu'à 10 000
    rate = 0.01;
    intervalSec = 10;
  } else if (mass >= 500) {
    // 0.5% par 10s entre 500 et 2000
    rate = 0.005;
    intervalSec = 10;
  } else {
    // 0.2% par 10s en dessous de 500
    rate = 0.002;
    intervalSec = 10;
  }

  return -Math.log(1 - rate) / intervalSec;
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
