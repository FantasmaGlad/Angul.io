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
  /** A0 (px/s²) — accélération (taux de rapprochement vers la vitesse cible) pour `startMass`.
   * Régit désormais UNIQUEMENT la mise en mouvement (vitesse cible > vitesse actuelle) — voir
   * `decelerationMassExponent` pour le freinage. */
  accelerationBase: number;
  /** alpha — exposant d'atténuation : a(m) = A0*(startMass/m)^alpha. */
  accelerationMassExponent: number;
  /** delta — exposant d'atténuation DÉDIÉ au freinage (vitesse cible < vitesse actuelle,
   * relâchement de l'input) : d(m) = A0*(startMass/m)^delta, même base `accelerationBase` mais un
   * exposant propre — voir `decelerationForMass`. Absent = repli sur `accelerationMassExponent`
   * (comportement historique, un seul exposant partagé pour les deux). Cahier des charges §4a :
   * "que le blob ralentisse moins vite en fonction de sa masse" — un exposant PLUS GRAND ici fait
   * perdre au freinage bien plus de puissance que ne l'accélération à mesure que la masse grandit,
   * donc un gros blob conserve son élan nettement plus longtemps qu'il ne met de temps à
   * atteindre sa vitesse de pointe, sans toucher à sa réactivité au pilotage. */
  decelerationMassExponent?: number;
  /** M0 — masse de référence du mode (`player.startMass`), utilisée par les deux formules. */
  startMass: number;
  /** Taille de la carte en pixels monde (ex: 10000). */
  mapSize?: number;
  /** Type de bord de carte du mode actif (mur, rebond, toroïdal...). */
  borderType?: 'STRICT_WALL' | 'ELASTIC_BOUNCE' | 'TOROIDAL' | 'TOXIC_ZONE';
  /** `config.merge.overlapMinFraction` du mod actif — fraction minimale de la surface des deux
   * morceaux qui doit se chevaucher pour fusionner (voir `tryMerge`/`onCollision`,
   * mods/parametric/index.ts). Transmise au client uniquement pour que sa propre répulsion locale
   * entre morceaux d'un même joueur (`applySelfRepulsion`, prediction.ts) vise la MÊME distance de
   * repos partiellement chevauchante que le serveur, plutôt qu'une séparation totale erronée (voir
   * `restingDistanceForOverlap`, geometry.ts). */
  mergeOverlapMinFraction: number;
  /** split.enabled du mod actif (défaut true). */
  splitEnabled?: boolean;
  /** split.maxPieces du mod actif (défaut 16). */
  maxSplits?: number;
  /** split.minMassToSplit du mod actif (défaut 36). */
  minSplitMass?: number;
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
  mergeOverlapMinFraction: 0.3,
};

/** v(m) = MAX(Vfloor, V0·kv·(M0/m)^gamma) — voir metriques.md §4/server/mods/parametric/physics.ts. */
export function velocityForMass(mass: number, config: MovementConfig): number {
  const raw =
    config.v0 * config.speedMultiplier * Math.pow(config.startMass / mass, config.speedMassExponent);
  return Math.max(config.velocityFloor, raw);
}

/** a(m) = A0·(M0/m)^alpha — taux de rapprochement (px/s²) vers la vitesse cible, pas une vitesse
 * instantanée. Utilisé uniquement quand cette vitesse cible dépasse la vitesse actuelle (mise en
 * mouvement) — voir `decelerationForMass` pour le freinage. */
export function accelerationForMass(mass: number, config: MovementConfig): number {
  return config.accelerationBase * Math.pow(config.startMass / mass, config.accelerationMassExponent);
}

/** d(m) = A0·(M0/m)^delta — même forme que `accelerationForMass`, avec l'exposant DÉDIÉ
 * `decelerationMassExponent` (repli sur `accelerationMassExponent` si absent, comportement
 * historique). Utilisé quand la vitesse cible est INFÉRIEURE à la vitesse actuelle (relâchement de
 * l'input, freinage) — voir le commentaire de `MovementConfig.decelerationMassExponent`. */
export function decelerationForMass(mass: number, config: MovementConfig): number {
  const exponent = config.decelerationMassExponent ?? config.accelerationMassExponent;
  return config.accelerationBase * Math.pow(config.startMass / mass, exponent);
}

/** Vitesse de base (px/s) de l'impulsion de Dash (Hardcore uniquement, voir
 * server/src/mods/hardcore/index.ts) — pleine puissance pour un blob à `DASH_REFERENCE_MASS`,
 * valeur historique inchangée. */
export const DASH_BASE_SPEED = 4050;
/** Masse de référence pour l'atténuation du Dash — le Dash est une mécanique Hardcore fixe, pas
 * paramétrable par mode comme le reste du mouvement (`MovementConfig.startMass`) : ancrée sur la
 * masse de spawn commune aux deux modes (voir server/configs/*.json `player.startMass`). */
const DASH_REFERENCE_MASS = 50;
/** Exposant d'atténuation du Dash — volontairement doux (0.15, bien en-deçà de
 * `accelerationMassExponent`/`decelerationMassExponent`) : le Dash doit rester perceptiblement
 * moins puissant pour un gros blob (cahier des charges §4a) sans devenir anecdotique dès qu'on
 * dépasse un peu la masse de spawn. */
const DASH_MASS_EXPONENT = 0.15;
/** Puissance plancher du Dash pour un blob énorme (fraction de `DASH_BASE_SPEED`) — jamais
 * neutralisé complètement ("moins puissant", pas "inutile") : reste toujours utile pour fuir/
 * attaquer, même pour le plus gros blob de la partie. */
const DASH_MIN_POWER_FRACTION = 0.4;

/** Impulsion de Dash (px/s) pour un morceau de masse `mass` — pleine puissance
 * (`DASH_BASE_SPEED`) à `DASH_REFERENCE_MASS` ou en-dessous, décroissante ensuite jusqu'au
 * plancher `DASH_MIN_POWER_FRACTION` (cahier des charges §4a : "en hardcore que son dash soit
 * moins puissant lorsqu'il est gros"). Fonction pure partagée entre le serveur (autorité, voir
 * `mods/hardcore/index.ts`) et la prédiction locale du client (`client/src/prediction.ts`
 * `applyDash`) — même raisonnement que le reste de ce fichier : une seule formule des deux côtés
 * élimine tout risque de rollback visuel au moment du dash. */
export function dashSpeedForMass(mass: number): number {
  const factor = Math.pow(DASH_REFERENCE_MASS / Math.max(1, mass), DASH_MASS_EXPONENT);
  return DASH_BASE_SPEED * clampUnitOrLess(factor, DASH_MIN_POWER_FRACTION);
}

function clampUnitOrLess(value: number, floor: number): number {
  return Math.max(floor, Math.min(1, value));
}
