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

export const CHALLENGER_NAMES = [
  'Titan',
  'Vortex',
  'Apex',
  'Kraken',
  'Oblivion',
  'Phantom',
  'Valkyrie',
  'Nemesis',
  'Hydra',
  'Eclipse',
];

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

/** Génère un pseudo selon le type (ex: fuis_1, neutre_2, agressif_1, fou_1). */
export function generateBotNickname(profile: BotProfileKind, index: number): string {
  if (profile === 'challenger') {
    const nameIndex = (index - 1) % CHALLENGER_NAMES.length;
    return CHALLENGER_NAMES[nameIndex] ?? `Challenger_${index}`;
  }
  return `${profile}_${index}`;
}

/** Calcule le multiplicateur de masse de spawn pour un challenger de rang 1 à 10 (50x à 5x M0). */
export function getChallengerMassMultiplier(rank: number): number {
  const clampedRank = Math.max(1, Math.min(10, rank));
  return 50 - (clampedRank - 1) * 5; // Rank 1 = 50x, Rank 10 = 5x
}
