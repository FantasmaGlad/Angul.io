import type { ParametricModConfig } from './config.js';

/** v(m) = MAX(Vfloor, V0·kv·(M0/m)^gamma) — feuille Excel, dictionnaire des variables. */
export function velocityForMass(mass: number, config: ParametricModConfig): number {
  const { v0, speedMultiplier, speedMassExponent, velocityFloor } = config.physics;
  const raw = v0 * speedMultiplier * Math.pow(config.player.startMass / mass, speedMassExponent);
  return Math.max(velocityFloor, raw);
}

/** a(m) = A0·(M0/m)^alpha — taux de rapprochement (px/s²) vers la vitesse cible, pas une
 * vitesse instantanée : remplace l'ancien mécanisme de "boost" de split ad hoc (metriques.md
 * v0.1 §4) par un seul modèle générique valable pour tout le mouvement. */
export function accelerationForMass(mass: number, config: ParametricModConfig): number {
  const { accelerationBase, accelerationMassExponent } = config.physics;
  return accelerationBase * Math.pow(config.player.startMass / mass, accelerationMassExponent);
}

function decayLambda(mass: number, config: ParametricModConfig, timeSinceLastEatenS = 10): number {
  const floor = config.decay.floor ?? 2;
  // Aucune perte de masse pendant les 10 premières secondes sans masse ingurgitée
  if (mass <= floor || timeSinceLastEatenS < 10) return 0;

  let rate = 0.002;
  let intervalSec = 10;

  if (mass > 10000) {
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
 * (pellets / bloc de 1000×1000 px²) plutôt qu'un total fixe indépendant de la taille de carte. */
export function foodTargetCount(config: ParametricModConfig): number {
  const areaInBlocks = (config.arena.width * config.arena.height) / (1000 * 1000);
  return Math.round(config.food.density * areaInBlocks);
}
