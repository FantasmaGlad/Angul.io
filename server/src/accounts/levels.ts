/**
 * Formule XP/niveau (demande utilisateur, remplace la courbe en racine carrée provisoire posée
 * au Lot 3) : `players.xp` (Lot 3.5) reste un cumul total depuis la création du compte, mais le
 * coût EN XP de chaque niveau (l'XP nécessaire pour passer du niveau N au niveau N+1) suit
 * désormais une suite récurrente géométrique fournie telle quelle :
 *   coût(1) = 1000
 *   coût(N+1) = coût(N) * 1,2 - 150   (ex. coût(2) = 1000*1,2-150 = 1050, valeur donnée)
 * Le coût croît d'environ 20%/niveau une fois la constante `-150` négligeable devant le coût
 * courant (point fixe instable à 750 : toute suite démarrant au-dessus, comme ici à 1000,
 * diverge vers le haut plutôt que de se stabiliser).
 */
const LEVEL_1_XP_COST = 1000;
const LEVEL_COST_GROWTH_FACTOR = 1.2;
const LEVEL_COST_GROWTH_OFFSET = 150;
/** Garde-fou anti-boucle infinie : un cumul d'XP aberrant (bug, valeur corrompue en base) ne
 * doit jamais bloquer indéfiniment le calcul — largement au-dessus de toute progression
 * atteignable en jeu normal. */
const MAX_LEVEL_ITERATIONS = 100_000;

/** Convertit un cumul total d'XP en niveau, en consommant les paliers un par un (coût(1), puis
 * coût(2), etc.) jusqu'à épuisement du cumul — niveau 1 tant que le cumul est inférieur au coût
 * du premier palier. */
export function levelForXp(xp: number): number {
  let level = 1;
  let remaining = Math.max(0, xp);
  let cost = LEVEL_1_XP_COST;

  for (let i = 0; i < MAX_LEVEL_ITERATIONS && remaining >= cost; i++) {
    remaining -= cost;
    level += 1;
    cost = cost * LEVEL_COST_GROWTH_FACTOR - LEVEL_COST_GROWTH_OFFSET;
  }

  return level;
}
