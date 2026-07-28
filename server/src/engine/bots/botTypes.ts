import { BOT_IDENTITIES } from '@angulio/shared';

export type BotProfileKind = 'fuis' | 'neutre' | 'agressif' | 'fou' | 'challenger';

export interface BotProportions {
  fuis: number;
  neutre: number;
  agressif: number;
  fou: number;
}

export const DEFAULT_BOT_PROPORTIONS: BotProportions = {
  fuis: 25,
  neutre: 30,
  agressif: 30,
  fou: 15,
};

/** Sélectionne aléatoirement un type de bot selon la pondération des proportions. */
export function selectRandomBotProfile(
  proportions: BotProportions = DEFAULT_BOT_PROPORTIONS,
): BotProfileKind {
  const total = proportions.fuis + proportions.neutre + proportions.agressif + proportions.fou;
  if (total <= 0) return 'neutre';

  let roll = Math.random() * total;
  if ((roll -= proportions.fuis) < 0) return 'fuis';
  if ((roll -= proportions.neutre) < 0) return 'neutre';
  if ((roll -= proportions.agressif) < 0) return 'agressif';
  return 'fou';
}

/** Génère un pseudo unique issu de la liste officielle de robots (BOT_IDENTITIES). */
export function generateBotNickname(profile: BotProfileKind, index: number): string {
  if (BOT_IDENTITIES.length === 0) return `${profile}_${index}`;

  if (profile === 'challenger') {
    const nameIndex = Math.max(0, index - 1) % BOT_IDENTITIES.length;
    return BOT_IDENTITIES[nameIndex]?.name ?? `Challenger_${index}`;
  }

  // Décalage de 10 pour réserver les premiers noms aux Challengers du Top 10
  const nameIndex = (10 + Math.max(0, index - 1)) % BOT_IDENTITIES.length;
  return BOT_IDENTITIES[nameIndex]?.name ?? `${profile}_${index}`;
}

/** Calcule le multiplicateur de masse de spawn pour un challenger de rang 1 à 10 (50x à 5x M0). */
export function getChallengerMassMultiplier(rank: number): number {
  const clampedRank = Math.max(1, Math.min(10, rank));
  return 50 - (clampedRank - 1) * 5; // Rank 1 = 50x, Rank 10 = 5x
}
