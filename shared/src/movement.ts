/**
 * Modèle de mouvement (vitesse/accélération en fonction de la masse) — extrait de
 * `server/src/mods/parametric/physics.ts` pour être réutilisable tel quel par le client
 * (prédiction locale du blob du joueur, voir client/src/prediction.ts et
 * plan_performance_reseau.md Phase 1). Le serveur reste la seule autorité sur la simulation :
 * ces fonctions sont pures, sans état, identiques des deux côtés du réseau — c'est cette
 * identité qui permet au client d'anticiper le mouvement sans attendre l'aller-retour réseau,
 * puis de se recaler en douceur sur l'état réellement reçu.
 *
 * `MovementConfig` est un sous-ensemble minimal de `ParametricModConfig['physics']` +
 * `player.startMass` — transmis une fois par connexion dans `WelcomeMessage.movement` (voir
 * protocol.ts), pas à chaque tick.
 */
export interface MovementConfig {
  /** V0 (px/s) — vitesse nominale pour un morceau de masse `startMass`. */
  v0: number;
  /** kv — multiplicateur de vitesse global du mode. */
  speedMultiplier: number;
  /** gamma — exposant d'atténuation : v(m) = MAX(velocityFloor, v0*kv*(startMass/m)^gamma). */
  speedMassExponent: number;
  /** Vfloor (px/s) — vitesse plancher, jamais nulle même pour une masse énorme. */
  velocityFloor: number;
  /** A0 (px/s²) — accélération (taux de rapprochement vers la vitesse cible) pour `startMass`. */
  accelerationBase: number;
  /** alpha — exposant d'atténuation : a(m) = A0*(startMass/m)^alpha. */
  accelerationMassExponent: number;
  /** M0 — masse de référence du mode (`player.startMass`), utilisée par les deux formules. */
  startMass: number;
}

/** Repli utilisé uniquement quand un `ModResolver` ne fournit pas de config de mouvement (ex.
 * mods factices des tests serveur, voir roomManager.test.ts/server.test.ts) — jamais utilisé en
 * production, où `engine/modRegistry.ts` fournit toujours la vraie config du mode. Des valeurs
 * plausibles suffisent : au pire, un client connecté à un mod de test verrait une prédiction
 * légèrement désaccordée, immédiatement corrigée par la réconciliation (voir
 * client/src/prediction.ts). */
export const DEFAULT_MOVEMENT_CONFIG: MovementConfig = {
  v0: 245,
  speedMultiplier: 1.5,
  speedMassExponent: 0.0333,
  velocityFloor: 20,
  accelerationBase: 4500,
  accelerationMassExponent: 0.7,
  startMass: 50,
};

/** v(m) = MAX(Vfloor, V0·kv·(M0/m)^gamma) — voir metriques.md §4/server/mods/parametric/physics.ts. */
export function velocityForMass(mass: number, config: MovementConfig): number {
  const raw =
    config.v0 * config.speedMultiplier * Math.pow(config.startMass / mass, config.speedMassExponent);
  return Math.max(config.velocityFloor, raw);
}

/** a(m) = A0·(M0/m)^alpha — taux de rapprochement (px/s²) vers la vitesse cible, pas une vitesse
 * instantanée. */
export function accelerationForMass(mass: number, config: MovementConfig): number {
  return config.accelerationBase * Math.pow(config.startMass / mass, config.accelerationMassExponent);
}
