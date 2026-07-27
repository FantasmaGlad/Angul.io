import type { PlayerId } from './types.js';
import type { World } from './world.js';

/**
 * Système d'XP et de combo (demande utilisateur, formules fournies telles quelles) :
 *  - "1 masse mangée = 1xp" (nourriture ET joueurs, tout gain de masse par absorption compte).
 *  - "1 joueur mangé = 400xp" (bonus fixe, en plus — pas à la place — de la masse gagnée sur ce
 *    même événement).
 *  - Combo : manger 2 joueurs en moins de 5s déclenche un multiplicateur x1,2 sur l'XP gagné
 *    pendant les 20 secondes suivantes ("2 joueurs mangé en -5 secondes = *1,2 ... multiplication
 *    des points d'xp gagnés pendant les 20 prochaines secondes"). Manger un joueur de plus dans
 *    les 10 secondes qui suivent prolonge le combo — la chaîne s'allonge, le multiplicateur
 *    grimpe, la fenêtre de 20s reprend à zéro — jusqu'à un plafond x10 ("Boost Max"). Le premier
 *    déclenchement (fenêtre stricte de 5s) est volontairement plus dur que la prolongation
 *    (fenêtre plus large de 10s) : "le plus dur est de lancer le premier combo" (demande
 *    utilisateur).
 *
 * Attaché à `PlayerState.lifeStats` (engine/types.ts), mis à jour directement par les mods au
 * moment de l'absorption (`mods/parametric/index.ts`, `mods/hardcore/index.ts`) — remis à zéro
 * uniquement par net/server.ts (`World.resetLifeStats`), juste après avoir lu/crédité la valeur
 * au compte joueur : le respawn immédiat du MVP recrée un morceau (donc une "nouvelle vie") AVANT
 * que le réseau ait eu la main pour lire le cumul de la vie qui vient de se terminer (voir
 * `Room.tick`, l'ordre `mod.onPlayerDeath` puis `deathListeners`) — remettre à zéro ici plutôt que
 * dans le mod éviterait sinon de perdre l'XP de cette vie avant même de l'avoir créditée.
 */

export const XP_PER_MASS_EATEN = 1;
export const XP_PER_PLAYER_EATEN = 400;

const COMBO_TRIGGER_WINDOW_MS = 5_000;
const COMBO_CONTINUE_WINDOW_MS = 10_000;
const COMBO_DURATION_MS = 20_000;
const COMBO_STEP_FACTOR = 1.2;
const COMBO_MAX_MULTIPLIER = 10;

export interface ComboState {
  /** Nombre de joueurs mangés dans la tentative/chaîne en cours — 0 = aucune tentative, 1 = un
   * premier mangé en attente d'un second sous 5s (combo pas encore déclenché), >=2 = combo
   * effectivement actif. */
  chain: number;
  /** Multiplicateur d'XP courant — n'a d'effet que tant que `expiresAtMs > now` (voir `awardXp`) ;
   * conservé même expiré pour rester lisible en dehors de ce module (debug), jamais lu directement
   * sans vérifier `expiresAtMs`. */
  multiplier: number;
  /** Horodatage (`performance.now()`, ms) au-delà duquel le multiplicateur cesse de s'appliquer. */
  expiresAtMs: number;
  /** Horodatage du dernier joueur mangé — mesure l'écart avec le suivant (5s pour déclencher,
   * 10s pour prolonger). */
  lastEatAtMs: number;
}

export interface LifeStats {
  /** Masse totale mangée (nourriture + joueurs) depuis le dernier (re)spawn — purement
   * informatif/débogage, l'XP correspondant est déjà comptée dans `xpEarned`. */
  massEaten: number;
  /** Nombre de joueurs mangés depuis le dernier (re)spawn. */
  playersEaten: number;
  /** XP accumulée pour la vie en cours, combo déjà appliqué au fil de l'eau — c'est cette valeur
   * qui est créditée au compte à la mort/déconnexion (voir net/server.ts `recordAccountStats`). */
  xpEarned: number;
  combo: ComboState;
}

export function createLifeStats(): LifeStats {
  return {
    massEaten: 0,
    playersEaten: 0,
    xpEarned: 0,
    combo: { chain: 0, multiplier: 1, expiresAtMs: 0, lastEatAtMs: 0 },
  };
}

/** "1 masse mangée = 1xp" — à appeler pour CHAQUE gain de masse par absorption (nourriture ou
 * joueur) ; bénéficie du combo actif comme n'importe quel autre gain d'XP. */
export function recordMassEaten(stats: LifeStats, massGained: number, nowMs: number): void {
  if (massGained <= 0) return;
  stats.massEaten += massGained;
  awardXp(stats, massGained * XP_PER_MASS_EATEN, nowMs);
}

/** "1 joueur mangé = 400xp" + déclenche/prolonge le combo — à appeler UNE FOIS par joueur
 * absorbé, en plus de (jamais à la place de) `recordMassEaten` pour la masse gagnée sur ce même
 * événement. */
export function recordPlayerEaten(stats: LifeStats, nowMs: number): void {
  stats.playersEaten += 1;
  updateCombo(stats.combo, nowMs);
  awardXp(stats, XP_PER_PLAYER_EATEN, nowMs);
}

function updateCombo(combo: ComboState, nowMs: number): void {
  const gapMs = nowMs - combo.lastEatAtMs;

  if (combo.chain === 1 && gapMs <= COMBO_TRIGGER_WINDOW_MS) {
    // Second mangé assez rapide après le premier : déclenche le combo.
    combo.chain = 2;
    combo.multiplier = comboMultiplierForChain(combo.chain);
    combo.expiresAtMs = nowMs + COMBO_DURATION_MS;
  } else if (combo.chain >= 2 && gapMs <= COMBO_CONTINUE_WINDOW_MS) {
    // Combo déjà actif, prolongé (fenêtre plus large que le déclenchement initial).
    combo.chain += 1;
    combo.multiplier = comboMultiplierForChain(combo.chain);
    combo.expiresAtMs = nowMs + COMBO_DURATION_MS;
  } else {
    // Trop lent pour déclencher/prolonger (ou tout premier mangé de la vie) : ce mangé devient
    // le premier maillon d'une nouvelle tentative.
    combo.chain = 1;
    combo.multiplier = 1;
    combo.expiresAtMs = 0;
  }

  combo.lastEatAtMs = nowMs;
}

function comboMultiplierForChain(chain: number): number {
  // chain=2 (déclenchement) -> 1,2^1 = x1,2 (valeur fournie). Chaque maillon supplémentaire
  // multiplie encore par 1,2, plafonné à x10 ("Boost Max", valeur fournie) — progression
  // géométrique retenue comme interpolation raisonnable entre les deux points donnés, les
  // paliers intermédiaires n'étant pas spécifiés par la demande.
  return Math.min(COMBO_MAX_MULTIPLIER, Math.pow(COMBO_STEP_FACTOR, chain - 1));
}

function awardXp(stats: LifeStats, baseAmount: number, nowMs: number): void {
  const multiplier = stats.combo.expiresAtMs > nowMs ? stats.combo.multiplier : 1;
  stats.xpEarned += baseAmount * multiplier;
}

/** Niveau de combo à afficher côté client ("Combo x{niveau}"), `undefined` si aucun combo actif
 * — délibérément un compteur entier (1, 2, 3…) plutôt que le multiplicateur décimal réel (détail
 * de calcul serveur), plus lisible pour un gros texte à l'écran (§ demande utilisateur). */
export function activeComboLevel(combo: ComboState, nowMs: number): number | undefined {
  if (combo.expiresAtMs <= nowMs) return undefined;
  return combo.chain - 1;
}

/** Crédite l'XP de masse mangée au joueur propriétaire d'un morceau, s'il existe (une pièce a
 * toujours un `ownerId`, mais l'appelant peut passer un id inconnu du monde par prudence — aucun
 * joueur invité/déconnecté entre-temps ne doit faire planter la collision). */
export function creditMassEatenXp(
  world: World,
  ownerId: PlayerId | undefined,
  massGained: number,
  nowMs: number,
): void {
  if (!ownerId) return;
  const player = world.getPlayer(ownerId);
  if (player) recordMassEaten(player.lifeStats, massGained, nowMs);
}

/** Crédite le bonus fixe + la logique de combo pour un joueur mangé. */
export function creditPlayerEatenXp(
  world: World,
  ownerId: PlayerId | undefined,
  nowMs: number,
): void {
  if (!ownerId) return;
  const player = world.getPlayer(ownerId);
  if (player) recordPlayerEaten(player.lifeStats, nowMs);
}
