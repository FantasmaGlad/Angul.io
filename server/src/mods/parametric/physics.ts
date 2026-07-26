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

function decayLambda(mass: number, config: ParametricModConfig): number {
  const { rateAboveStart, intervalAboveStartSec, rateBelowStart, intervalBelowStartSec, floor } =
    config.decay;
  if (mass <= floor) return 0;
  const startMass = config.player.startMass;
  return mass > startMass
    ? -Math.log(1 - rateAboveStart) / intervalAboveStartSec
    : -Math.log(1 - rateBelowStart) / intervalBelowStartSec;
}

export function applyPassiveDecay(mass: number, dt: number, config: ParametricModConfig): number {
  const lambda = decayLambda(mass, config);
  if (lambda === 0) return mass;
  return Math.max(mass * Math.exp(-lambda * dt), config.decay.floor);
}

/** Masse d'une nouvelle particule de nourriture. Distribution biaisée vers `massMin` quand
 * `massSkewExponent > 1` ("plus de petits que de gros", décrit qualitativement par la feuille
 * Excel pour Folie — la formule exacte est notre interprétation, pas la leur). */
export function randomFoodMass(config: ParametricModConfig): number {
  const { massMin, massMax, massSkewExponent } = config.food;
  if (massMax <= massMin) return massMin;
  return massMin + (massMax - massMin) * Math.pow(Math.random(), massSkewExponent);
}

/** Nombre cible de particules de nourriture pour la carte actuelle, dérivé de la densité
 * (pellets / bloc de 1000×1000 px²) plutôt qu'un total fixe indépendant de la taille de carte. */
export function foodTargetCount(config: ParametricModConfig): number {
  const areaInBlocks = (config.arena.width * config.arena.height) / (1000 * 1000);
  return Math.round(config.food.density * areaInBlocks);
}
