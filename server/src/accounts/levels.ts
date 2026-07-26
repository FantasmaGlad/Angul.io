/**
 * Formule XP/niveau — cahier des charges §5.2 : "progression globale du compte (formule XP à
 * définir en phase de développement)", donc volontairement provisoire, comme d'autres
 * paramètres tranchés par défaut ailleurs dans le projet (voir metriques.md §13). Courbe en
 * racine carrée : chaque niveau coûte proportionnellement plus d'XP que le précédent
 * (niveau 2 = 100 XP, niveau 3 = 400 XP, niveau 4 = 900 XP…), sans palier plafond. Ajustable
 * sans migration : `level` est une colonne dénormalisée réécrite à chaque partie (Lot 3.5),
 * pas une contrainte de schéma.
 */
const XP_PER_LEVEL_SQUARED = 100;

export function levelForXp(xp: number): number {
  return 1 + Math.floor(Math.sqrt(Math.max(0, xp) / XP_PER_LEVEL_SQUARED));
}

/**
 * XP gagné en fin de partie (Lot 3.5) — la masse maximale atteinte pendant la vie du joueur est
 * la seule mesure de performance disponible à ce jour (pas de système de score dédié, cahier
 * des charges §5.2 : "meilleur score par mode"), donc XP = score = masse max, arrondie.
 * Volontairement le même choix simple que pour le "score" lui-même plutôt qu'une pondération
 * distincte, en l'absence de besoin de jeu justifiant plus de nuance pour l'instant.
 */
export function xpForScore(score: number): number {
  return Math.max(0, Math.round(score));
}
