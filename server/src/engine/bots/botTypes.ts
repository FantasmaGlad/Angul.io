import { BOT_IDENTITIES } from '@angulio/shared';
import type { BotConfig } from '../../mods/parametric/config.js';

export type BotProfileKind = 'fuis' | 'neutre' | 'agressif' | 'challenger';

/** Forme résolue de `BotConfig['challengers']` (config.ts) — champ optionnel côté config JSON,
 * toujours présent ici une fois `DEFAULT_CHALLENGER_CONFIG` fusionné (voir `botManager.ts`). */
export type ChallengerConfig = NonNullable<BotConfig['challengers']>;

/** Repli si `config.bots.challengers` est absent du JSON — pyramide 6 à 15 Challengers selon le
 * nombre de joueurs humains connectés (demande utilisateur, §15 : "entre 6 et 15 bots... plus il y
 * a de joueurs humains, plus le nombre de robots diminue"), SAUF la permanence à 0 humain
 * (`baselineCount` Challengers actifs en continu même sans aucun humain — voir
 * `BotManager.adjustPopulation`). */
export const DEFAULT_CHALLENGER_CONFIG: ChallengerConfig = {
  enabled: true,
  baselineCount: 6,
  maxWithHumans: 15,
  minWithHumans: 6,
  rampHumans: 5,
  massMultipliers: [50, 40, 30, 25, 20, 15, 12, 10, 8, 7, 6, 5, 4, 3, 2],
};

/** Options d'un spawn de bot PERSONNALISÉ (cahier_des_charges_admin.md §9.3/§17, "Bots
 * personnalisés : création de robots configurables sur-mesure") — toutes optionnelles et
 * indépendantes du profil de pilotage IA (voir `BotManager.forceSpawnOne`) : ce type ne couvre
 * QUE l'apparence/position de spawn, jamais le comportement, un bot personnalisé reste piloté par
 * l'IA comme n'importe quel autre bot. `x`/`y` ne sont appliqués que si les DEUX sont fournis
 * ensemble (voir `BotManager` méthode privée `spawnBot`) — un seul des deux, sans l'autre, est
 * ignoré plutôt que de repositionner partiellement le bot. */
export interface CustomBotSpawnOptions {
  nickname?: string;
  mass?: number;
  x?: number;
  y?: number;
  /** Profil de comportement/tuning explicite (id de `server/configs/bots/*.json`, voir
   * `loadBotBehaviorConfig`) — AXE DISTINCT de la "personnalité" `BotProfileKind`
   * (fuis/neutre/agressif, toujours tirée aléatoirement même quand ce champ est fourni, voir
   * `BotManager.forceSpawnMany`) : ce champ ne change QUE le réglage fin (agressivité, seuils de
   * split...) appliqué au sein de la personnalité obtenue, jamais la personnalité elle-même. */
  behaviorId?: string;
}

export interface BotProportions {
  fuis: number;
  neutre: number;
  agressif: number;
}

export const DEFAULT_BOT_PROPORTIONS: BotProportions = {
  fuis: 30,
  neutre: 30,
  agressif: 40,
};

/** Sélectionne aléatoirement un type de bot selon la pondération des proportions. */
export function selectRandomBotProfile(
  proportions: BotProportions = DEFAULT_BOT_PROPORTIONS,
): BotProfileKind {
  const total = proportions.fuis + proportions.neutre + proportions.agressif;
  if (total <= 0) return 'neutre';

  let roll = Math.random() * total;
  if ((roll -= proportions.fuis) < 0) return 'fuis';
  if ((roll -= proportions.neutre) < 0) return 'neutre';
  return 'agressif';
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

  const isSmallPool = BOT_IDENTITIES.length <= CHALLENGER_POOL_SIZE;
  const poolStart = profile === 'challenger' || isSmallPool ? 0 : Math.min(CHALLENGER_POOL_SIZE, BOT_IDENTITIES.length);
  const poolLength =
    profile === 'challenger' || isSmallPool
      ? BOT_IDENTITIES.length
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

/** Résout les collisions de pseudo pour un bot PERSONNALISÉ (§9.3/§17, "Bots personnalisés") —
 * `requested` tel quel s'il est libre, sinon suffixé par un compteur croissant (` (2)`, ` (3)`,
 * ...) jusqu'à trouver un pseudo non porté par un bot actif de CE salon — même `usedNames` que
 * `generateBotNickname` ci-dessus (jamais deux bots affichés sous le même nom, ici pour un pseudo
 * choisi par l'admin plutôt que tiré de `BOT_IDENTITIES`). */
export function uniqueCustomNickname(requested: string, usedNames: ReadonlySet<string>): string {
  if (!usedNames.has(requested)) return requested;
  let suffix = 2;
  while (usedNames.has(`${requested} (${suffix})`)) suffix++;
  return `${requested} (${suffix})`;
}

/** Population de Challengers dès QU'AU MOINS un joueur humain est connecté (`humanCount >= 1`) —
 * décroissance LINÉAIRE de `maxWithHumans` (à `humanCount === 1`) jusqu'à `minWithHumans` (atteint
 * et maintenu à partir de `humanCount === rampHumans`), demande utilisateur §15 : "entre 6 et 15
 * bots... plus il y a de joueurs humains, plus le nombre de robots diminue". Remplace l'ancien
 * `withHumanCount` fixe (identique quel que soit le nombre d'humains). `rampHumans <= 1` (config
 * mal formée) retombe immédiatement sur `minWithHumans`, aucune division par zéro possible. */
export function rampedChallengerTarget(
  humanCount: number,
  config: ChallengerConfig = DEFAULT_CHALLENGER_CONFIG,
): number {
  const { minWithHumans, maxWithHumans, rampHumans } = config;
  if (rampHumans <= 1) return minWithHumans;
  const progress = Math.min(1, Math.max(0, (humanCount - 1) / (rampHumans - 1)));
  return Math.round(maxWithHumans - (maxWithHumans - minWithHumans) * progress);
}

/** Multiplicateur de masse de spawn pour un Challenger de rang `rank` (1 = le plus fort), lu dans
 * `config.massMultipliers` (index 0 = rang 1) — voir `BotConfig['challengers']`, config.ts. Un
 * rang au-delà de la longueur du tableau retombe sur la DERNIÈRE valeur (le palier le plus
 * faible configuré) plutôt que de planter : filet de sécurité si `maxWithHumans` dépasse la
 * longueur de `massMultipliers` dans une config JSON mal formée. */
export function challengerMassMultiplierForRank(
  rank: number,
  config: ChallengerConfig = DEFAULT_CHALLENGER_CONFIG,
): number {
  const multipliers =
    config.massMultipliers.length > 0 ? config.massMultipliers : DEFAULT_CHALLENGER_CONFIG.massMultipliers;
  const index = Math.max(0, Math.min(multipliers.length - 1, rank - 1));
  return multipliers[index]!;
}
