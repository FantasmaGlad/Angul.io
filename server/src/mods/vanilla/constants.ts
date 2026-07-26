/**
 * Constantes du mode Vanilla — voir metriques.md (table des constantes, §1) et
 * cahier_des_charges.md §3.5. Toute valeur chiffrée du jeu doit venir d'ici, jamais d'un
 * nombre en dur ailleurs dans ce mod.
 */
export const VANILLA_CONSTANTS = {
  M_START: 50,
  M_SPLIT_MIN: 100,
  N_PIECES_MAX: 16,
  T_MERGE_COOLDOWN: 30,
  OVERLAP_MERGE_MIN_FRACTION: 1 / 3,
  M_FOOD: 1,
  M_EAT_FOOD_MIN: 2,
  EAT_MASS_ADVANTAGE: 0.05,
  M_DECAY_FLOOR: 2,
  K_AREA: Math.PI,
  V_REF: 6,
  V_MIN_FACTOR: 0.25,
  V_MAX_FACTOR: 3,
  BOOST_SPEED_FACTOR: 2,
  T_BOOST: 0.3,
  /** Nombre cible de particules de nourriture ambiantes sur la carte (densité non chiffrée
   * dans le cahier des charges, tranchée ici — voir metriques.md §13). */
  FOOD_TARGET_COUNT: 300,
  FOOD_SPAWN_PER_TICK: 5,
} as const;

/** λ = -ln(0.99) / T (metriques.md §5) — dérivées une seule fois des taux "1%/5s" et "1%/10s". */
export const LAMBDA_ABOVE_M_START = -Math.log(0.99) / 5;
export const LAMBDA_BELOW_M_START = -Math.log(0.99) / 10;
