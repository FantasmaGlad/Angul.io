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

/** Nombre de noms réservés en tête de liste aux Challengers du Top 10 (voir plus bas) — les
 * profils normaux (fuis/neutre/agressif/fou) piochent dans le reste de la liste. */
const CHALLENGER_POOL_SIZE = 10;

/** Génère un pseudo issu de la liste officielle de robots (BOT_IDENTITIES), UNIQUE au sein du
 * salon — `usedNames` (les pseudos des bots déjà actifs dans CE salon, voir `botManager.ts`
 * `spawnBot`) est sondé pour ne jamais réutiliser un nom encore porté par un autre bot.
 *
 * Avant ce correctif, l'index passé à cette fonction (`this.botCounters[profile]` côté
 * `botManager.ts`) repartait de 1 séparément pour CHAQUE profil — le bot #1 "neutre" et le bot #1
 * "agressif" retombaient donc sur le MÊME `nameIndex` (même formule, même point de départ) et
 * décrochaient tous les deux le même nom, deux bots homonymes dans le même salon. La recherche du
 * premier nom libre ci-dessous élimine ce cas par construction, quel que soit l'index de départ. */
export function generateBotNickname(
  profile: BotProfileKind,
  index: number,
  usedNames: ReadonlySet<string> = new Set(),
): string {
  if (BOT_IDENTITIES.length === 0) return `${profile}_${index}`;

  const poolStart = profile === 'challenger' ? 0 : Math.min(CHALLENGER_POOL_SIZE, BOT_IDENTITIES.length);
  const poolLength =
    profile === 'challenger'
      ? Math.min(CHALLENGER_POOL_SIZE, BOT_IDENTITIES.length)
      : BOT_IDENTITIES.length - poolStart;
  if (poolLength <= 0) return `${profile}_${index}`;

  const startOffset = Math.max(0, index - 1) % poolLength;
  for (let attempt = 0; attempt < poolLength; attempt++) {
    const candidateIndex = poolStart + ((startOffset + attempt) % poolLength);
    const candidate = BOT_IDENTITIES[candidateIndex]?.name;
    if (candidate && !usedNames.has(candidate)) return candidate;
  }
  // Pool entièrement occupé par des bots déjà actifs dans ce salon (population de bots
  // simultanés dépassant la taille du pool réservé au profil) : repli déterministe — pas de
  // garantie d'unicité dans ce cas extrême, mais toujours un nom valide.
  return BOT_IDENTITIES[poolStart + startOffset]?.name ?? `${profile}_${index}`;
}

/** Calcule le multiplicateur de masse de spawn pour un challenger de rang 1 à 10 (50x à 5x M0). */
export function getChallengerMassMultiplier(rank: number): number {
  const clampedRank = Math.max(1, Math.min(10, rank));
  return 50 - (clampedRank - 1) * 5; // Rank 1 = 50x, Rank 10 = 5x
}
