import { distance, isBotId, skinForNickname } from '@angulio/shared';
import type { BotConfig } from '../../mods/parametric/config.js';
import type { Room } from '../room.js';
import type { PlayerId } from '../types.js';
import type { BotBehaviorConfig } from './behaviorConfig.js';
import { computeBotInput, type BotStateMemory } from './botEvaluator.js';
import { loadBotBehaviorConfig } from './loadBehaviorConfig.js';
import {
  challengerMassMultiplierForRank,
  DEFAULT_BOT_PROPORTIONS,
  DEFAULT_CHALLENGER_CONFIG,
  generateBotNickname,
  rampedChallengerTarget,
  selectRandomBotProfile,
  uniqueCustomNickname,
  type BotProfileKind,
  type ChallengerConfig,
  type CustomBotSpawnOptions,
} from './botTypes.js';

interface ActiveBot {
  id: PlayerId;
  nickname: string;
  profile: BotProfileKind;
  memory: BotStateMemory;
  rank?: number;
  accumulatorMs: number;
  /** Réglage fin explicite (§10.3, `spawnBots{behaviorProfile}`) — `undefined` = comportement
   * normal, hérite du profil du salon (`BotManager.behavior`, voir `update()`). Résolu une seule
   * fois au spawn (voir `spawnBot`), jamais recalculé par tick (un fichier de comportement ne
   * change pas en cours de partie, même raisonnement que `BotManager.behavior`). */
  behaviorConfig?: BotBehaviorConfig;
}

export class BotManager {
  private readonly room: Room;
  private readonly config: BotConfig;
  private readonly maxRoomCapacity: number;
  /** Profil de PILOTAGE des bots (fuite/chasse/vagabondage/split, botEvaluator.ts) — distinct de
   * `config` ci-dessus (leur POPULATION) : voir `BotConfig.behaviorId`/`behaviorConfig.ts`. Chargé
   * une seule fois à la construction (pas par tick) — un fichier JSON de comportement n'est
   * jamais modifié pendant qu'un salon tourne. */
  private readonly behavior: BotBehaviorConfig;
  private readonly activeBots = new Map<PlayerId, ActiveBot>();
  private readonly botCounters: Record<BotProfileKind, number> = {
    fuis: 0,
    neutre: 0,
    agressif: 0,
    challenger: 0,
  };

  private currentTargetRatio = 0.7;
  private ratioTimerMs = 0;
  private nextRatioChangeMs = 0;
  private readonly updateIntervalMs: number;
  /** Horodatage (`performance.now()`) du début de la période SANS AUCUN joueur humain actuelle —
   * `undefined` tant qu'un humain est présent, ou si `config.idleDespawn` est absent/désactivé
   * (voir `updateIdleDespawn`). Remis à zéro dès qu'un humain rejoint. */
  private idleSinceMs: number | undefined;
  /** `true` une fois le despawn d'inactivité déclenché (voir `updateIdleDespawn`) — empêche
   * `adjustPopulation()` de repeupler le salon tant qu'aucun humain n'est revenu (sans quoi le
   * peuplement normal, appelé à CHAQUE tick, annulerait le despawn dès le tick suivant). */
  private idleDespawned = false;

  constructor(room: Room, config: BotConfig, maxRoomCapacity: number) {
    this.room = room;
    this.config = config;
    this.maxRoomCapacity = maxRoomCapacity;
    this.updateIntervalMs = 1000 / Math.max(0.1, config.updateFrequencyHz || 30);
    this.behavior = loadBotBehaviorConfig(config.behaviorId);
  }

  /** Recalcule périodiquement le ratio de bots entre 1/10 (10%) et 2/10 (20%) de la capacité du salon pour un nombre fluctuant et non fixe de joueurs. */
  private updateFluctuatingRatio(dtMs: number): void {
    this.ratioTimerMs += dtMs;
    if (this.ratioTimerMs >= this.nextRatioChangeMs) {
      this.ratioTimerMs = 0;
      this.nextRatioChangeMs = 10_000 + Math.random() * 20_000;
      const minRatio = 1 / 10; // 0.10 (1/10)
      const maxRatio = 2 / 10; // 0.20 (2/10)
      this.currentTargetRatio = minRatio + Math.random() * (maxRatio - minRatio);
    }
  }

  /** Exécuté à chaque tick de la room. Étale l'évaluation IA des bots sur plusieurs ticks. */
  update(dt: number): void {
    if (!this.config?.enabled) return;

    const dtMs = dt * 1000;
    this.updateFluctuatingRatio(dtMs);

    // `isTouchingHuman` (voir son commentaire) ne peut JAMAIS renvoyer `true` en l'absence
    // d'humain — l'évaluer quand même coûterait une requête spatiale (`queryNearby`, allocation
    // d'un tableau) PAR MORCEAU DE BOT, À CHAQUE TICK non dû, un coût mesuré non négligeable au
    // profilage (voir audit_chaleur.md) sur un salon "au repos" (aucun joueur humain, seulement
    // les bots ambiants qui peuplent en permanence les salons publics) — précisément le cas le
    // plus fréquent en dehors des heures de forte affluence. Calculé UNE FOIS par tick (pas par
    // bot, et réutilisé par `updateIdleDespawn` ci-dessous) : `allPlayers()` alloue déjà un
    // tableau, autant ne le payer qu'une fois.
    const hasHuman = this.room.world.allPlayers().some((p) => !this.isBot(p.id));

    this.updateIdleDespawn(hasHuman);
    this.adjustPopulation();

    for (const bot of this.activeBots.values()) {
      bot.accumulatorMs += dtMs;
      const dueByAccumulator = bot.accumulatorMs >= this.updateIntervalMs;
      // Réévaluation immédiate (sans attendre l'échéance de l'accumulateur, jusqu'à 500ms à 2Hz
      // ambiant) dès qu'un morceau de ce bot touche un morceau d'un joueur HUMAIN — sinon un bot
      // qui s'est mis à foncer vers/à travers un joueur ne corrige sa trajectoire qu'à sa prochaine
      // échéance ambiante, poussant le joueur (répulsion, voir mods/parametric/index.ts
      // `applyRepulsion`) pendant toute la durée du contact au lieu d'un seul tick — non prédit
      // côté client (prediction.ts), donc visible comme un tremblement à chaque contact prolongé.
      // Ne s'évalue (`isTouchingHuman`) que si au moins un humain est présent dans le salon (voir
      // `hasHuman` ci-dessus) — jamais entre bots (l'ambiant à 2Hz reste inchangé).
      const dueByContact = !dueByAccumulator && hasHuman && this.isTouchingHuman(bot.id);
      if (dueByAccumulator || dueByContact) {
        bot.accumulatorMs %= this.updateIntervalMs;
        const { input, memory } = computeBotInput(
          this.room.world,
          bot.id,
          bot.profile,
          bot.memory,
          bot.behaviorConfig ?? this.behavior,
        );
        bot.memory = memory;
        this.room.handleInput(bot.id, input);
      }
    }
  }

  /** `true` si un morceau de ce bot chevauche réellement (même critère que la narrow-phase de
   * collision, voir `World.findOverlappingPairs`) un morceau d'un joueur qui n'est PAS un bot —
   * voir `update()`. */
  private isTouchingHuman(botId: PlayerId): boolean {
    const world = this.room.world;
    for (const piece of world.getPiecesByOwner(botId)) {
      // Marge large côté broad-phase (spatiale, bon marché) : la narrow-phase ci-dessous (vraie
      // distance vs somme des rayons) tranche seule sur le contact réel, cette marge n'a besoin
      // que de couvrir le rayon plausible de l'autre morceau, pas d'être exacte.
      const nearbyIds = world.queryNearby(piece.position, piece.radius + 300);
      for (const nearbyId of nearbyIds) {
        if (nearbyId === piece.id) continue;
        const other = world.getEntity(nearbyId);
        if (!other || !other.ownerId || this.isBot(other.ownerId)) continue;
        if (distance(piece.position, other.position) < piece.radius + other.radius) return true;
      }
    }
    return false;
  }

  /** Despawn automatique de tous les bots (demande utilisateur) si aucun joueur humain n'est
   * connecté depuis `config.idleDespawn.afterMinutes` minutes D'AFFILÉE — économise le CPU d'un
   * salon durablement vide (bots ambiants + Challengers désormais permanents, voir §1 de
   * `adjustPopulation`). `idleDespawned` reste `true` (donc `adjustPopulation` continue de
   * refuser tout repeuplement, voir sa garde) tant qu'aucun humain n'est revenu — sans cet état,
   * le peuplement normal (appelé à CHAQUE tick juste après) annulerait le despawn dès le tick
   * suivant. */
  private updateIdleDespawn(hasHuman: boolean): void {
    const idleConfig = this.config.idleDespawn;
    if (!idleConfig?.enabled || hasHuman) {
      this.idleSinceMs = undefined;
      // Un humain vient de revenir (ou le despawn d'inactivité est désactivé) : lève l'état de
      // dormance — `adjustPopulation()` (appelé juste après par `update()`) repeuple normalement.
      this.idleDespawned = false;
      return;
    }

    const now = performance.now();
    this.idleSinceMs ??= now;
    if (!this.idleDespawned && now - this.idleSinceMs >= idleConfig.afterMinutes * 60_000) {
      // AVANT clearAll() (pas après) : son propre adjustPopulation() interne doit déjà voir cet
      // état pour ne pas repeupler immédiatement ce qu'il vient de vider.
      this.idleDespawned = true;
      this.clearAll();
    }
  }

  /** Ajuste le nombre de bots actifs selon le nombre de joueurs humains et garantit qu'il reste toujours au moins 1 place disponible pour un humain. */
  adjustPopulation(maxSpawnPerTick = 20): void {
    if (!this.config?.enabled) return;

    const allPlayers = Array.from(this.room.world.allPlayers());
    const humanCount = allPlayers.filter((p) => !this.activeBots.has(p.id)).length;

    // Dormance (voir `updateIdleDespawn`) : aucun repeuplement tant qu'aucun humain n'est revenu —
    // un salon resté vide `afterMinutes` a été volontairement vidé, le repeupler au tick suivant
    // annulerait le despawn.
    if (humanCount === 0 && this.idleDespawned) return;

    // Toujours réserver au moins 1 place pour un joueur humain s'il n'y a pas d'humain connecté —
    // et plafond dur absolu TOUS bots confondus (demande utilisateur, §15 : "au-delà de X robots,
    // plus d'apparition possible"), appliqué EN PLUS de cette réservation, jamais à la place.
    const maxBotsAllowed = Math.min(
      this.config.maxTotal ?? Infinity,
      Math.max(0, this.maxRoomCapacity - Math.max(1, humanCount)),
    );

    // 1. Les Challenger Bots — pyramide de robots forts identifiés par rang (voir botTypes.ts
    // `ChallengerConfig`) : `baselineCount` en PERMANENCE, même à 0 joueur humain (demande
    // utilisateur — auparavant 0 dans ce cas), puis une population qui DÉCROÎT LINÉAIREMENT de
    // `maxWithHumans` (à 1 humain connecté) vers `minWithHumans` (atteint à `rampHumans` humains —
    // voir `rampedChallengerTarget`, demande utilisateur §15 : "entre 6 et 15 bots... plus il y a
    // de joueurs humains, plus le nombre de robots diminue") ; toujours bridée par la capacité
    // autorisée du salon ET par le nombre de paliers de masse réellement configurés
    // (`massMultipliers.length`).
    const challengerConfig = this.config.challengers ?? DEFAULT_CHALLENGER_CONFIG;
    const challengerTarget = !challengerConfig.enabled
      ? 0
      : humanCount === 0
        ? challengerConfig.baselineCount
        : rampedChallengerTarget(humanCount, challengerConfig);
    const maxChallengerRank = challengerConfig.massMultipliers.length;
    const maxChallengers = Math.min(challengerTarget, maxBotsAllowed, maxChallengerRank);
    let spawnedThisTick = 0;

    for (let rank = 1; rank <= maxChallengers; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (!this.activeBots.has(challengerId)) {
        if (spawnedThisTick < maxSpawnPerTick) {
          this.spawnBot('challenger', rank, challengerConfig);
          spawnedThisTick++;
        }
      }
    }

    // Retirer les challengers en trop (capacité du salon réduite, ou Challengers désactivés)
    for (let rank = maxChallengers + 1; rank <= maxChallengerRank; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (this.activeBots.has(challengerId)) {
        this.activeBots.delete(challengerId);
        this.room.removePlayer(challengerId);
      }
    }

    // 2. Ajuster le reste de la population de bots normaux — UNIQUEMENT en mode ambiance, à 0
    // joueur humain connecté (demande utilisateur, §15 : dès qu'un humain se connecte, TOUTE la
    // population de bots passe par la pyramide Challenger ci-dessus ; les profils normaux
    // fuis/neutre/agressif/fou ne scalent plus avec le nombre d'humains — comportement retiré,
    // remplacé par la décroissance de §1). `ambientTargetCount` si défini, sinon le ratio cible
    // (fixe ou fluctuant, voir `updateFluctuatingRatio`).
    //
    // Compte des bots normaux SEULS (pas `this.activeBots.size`, qui inclurait les Challengers
    // désormais maintenus en permanence, voir §1 ci-dessus) : `desiredBots` ci-dessous n'a jamais
    // été pensé comme incluant les Challengers (sa formule ne les mentionne pas), donc comparer un
    // total qui les inclut ferait DÉCLENCHER LA BOUCLE DE RETRAIT ci-dessous dès que les
    // Challengers, à eux seuls, dépassent `desiredBots` (ex. `targetRatio` bas/nul, ou
    // `ambientTargetCount` absent) — `removeSmallestBot()` retomberait alors sur son repli
    // "aucun bot normal, retire un Challenger" et viderait la pyramide que §1 vient pourtant de
    // peupler délibérément, dans le MÊME appel. Un bug constaté au calibrage de la permanence des
    // Challengers (demande utilisateur, §1) : la garantie "toujours au moins `baselineCount`
    // Challengers" ne tient que si cette section ne les compte jamais dans ses propres calculs.
    let challengerCount = 0;
    for (const bot of this.activeBots.values()) {
      if (bot.profile === 'challenger') challengerCount++;
    }

    const effectiveRatio = this.config.targetRatio ?? this.currentTargetRatio;
    const targetBotCount = Math.floor(this.maxRoomCapacity * effectiveRatio);
    const ambientCount = this.config.ambientTargetCount;
    // Budget restant pour les bots normaux APRÈS réservation des Challengers (`maxChallengers`,
    // §1) — jamais `maxBotsAllowed` seul : les deux populations partagent la même réservation "au
    // moins 1 place pour un humain" (`maxBotsAllowed`, voir plus haut), donc les plafonner
    // indépendamment l'une de l'autre contre CE MÊME budget permettrait à leur SOMME de le
    // dépasser (ex. un salon à capacité 2 avec 1 Challenger ET 1 bot normal, ne laissant plus
    // aucune place à l'humain que `maxBotsAllowed` était censé garantir) — bug constaté au
    // calibrage de la permanence des Challengers (demande utilisateur, §1).
    const remainingBotBudget = Math.max(0, maxBotsAllowed - maxChallengers);
    const desiredBots = humanCount === 0 ? Math.min(remainingBotBudget, ambientCount ?? targetBotCount) : 0;

    // Si on manque de bots : spawn progressif (limité à maxSpawnPerTick par tick)
    while (this.activeBots.size - challengerCount < desiredBots && spawnedThisTick < maxSpawnPerTick) {
      this.spawnBot();
      spawnedThisTick++;
    }

    // Si on a trop de bots normaux : ajustement immédiat (jamais les Challengers — voir plus
    // haut : `normalBotCount > desiredBots >= 0` garantit qu'il reste au moins un bot normal à
    // retirer ici, donc `removeSmallestBot()` ne retombe jamais sur son repli Challenger dans
    // cette boucle précise).
    while (this.activeBots.size - challengerCount > desiredBots) {
      this.removeSmallestBot();
    }
  }

  /** `challengerMassOverride` : multiplicateur de masse imposé pour un Challenger, plutôt que
   * celui du barème par rang (`challengerMassMultiplierForRank`) — utilisé UNIQUEMENT par
   * `respawnChallengerAtWeakestTier` (voir son commentaire) pour qu'un Challenger qui réapparaît
   * après avoir été mangé entre toujours au palier le plus faible actuellement actif, jamais à
   * celui de son rang d'origine. Absent pour un spawn "normal" (peuplement initial du salon /
   * extension de la pyramide à la connexion d'un humain), qui utilise le barème par rang.
   *
   * `customOptions` : bot PERSONNALISÉ (§9.3/§17, voir `forceSpawnOne`) — pseudo/masse/position
   * imposés APRÈS le spawn normal, jamais utilisé pour les Challengers (`forceSpawnOne` est le
   * seul appelant à le fournir, toujours avec `forcedProfile` absent ou `'neutre'`). */
  private spawnBot(
    forcedProfile?: BotProfileKind,
    rank?: number,
    challengerConfig?: ChallengerConfig,
    challengerMassOverride?: number,
    customOptions?: CustomBotSpawnOptions,
  ): void {
    const profile =
      forcedProfile ?? selectRandomBotProfile(this.config.proportions ?? DEFAULT_BOT_PROPORTIONS);

    let index: number;
    let nickname: string;
    let botId: PlayerId;
    // Pseudos déjà portés par un bot actif dans CE salon — voir `generateBotNickname` (évite deux
    // bots homonymes, ex. le bot #1 "neutre" et le bot #1 "agressif" retombant sur le même nom
    // avant ce correctif).
    const usedNames = new Set(Array.from(this.activeBots.values(), (b) => b.nickname));

    if (profile === 'challenger' && rank !== undefined) {
      index = rank;
      nickname = generateBotNickname('challenger', rank, usedNames);
      botId = `bot-challenger-${rank}`;
    } else {
      this.botCounters[profile] += 1;
      index = this.botCounters[profile];
      nickname = generateBotNickname(profile, index, usedNames);
      botId = `bot-${profile}-${index}`;
    }

    // Pseudo personnalisé (§9.3/§17, "Bots personnalisés") : remplace le pseudo généré ci-dessus
    // — voir `uniqueCustomNickname` pour la garantie d'unicité (mêmes `usedNames` que
    // `generateBotNickname` juste au-dessus, jamais deux bots affichés sous le même nom).
    if (customOptions?.nickname) {
      nickname = uniqueCustomNickname(customOptions.nickname, usedNames);
    }

    // Décalage initial de l'accumulateur pour étaler les calculs d'IA des bots
    const offsetMs = Math.random() * this.updateIntervalMs;

    const bot: ActiveBot = {
      id: botId,
      nickname,
      profile,
      memory: {},
      rank,
      accumulatorMs: offsetMs,
      // Réglage fin explicite (§10.3) — `loadBotBehaviorConfig` replie silencieusement sur
      // `DEFAULT_BOT_BEHAVIOR_CONFIG` si l'id est invalide/introuvable (voir son commentaire),
      // jamais d'exception ici pour un id fourni par l'admin.
      behaviorConfig: customOptions?.behaviorId ? loadBotBehaviorConfig(customOptions.behaviorId) : undefined,
    };

    // Déterministe (hash du pseudo, comme un invité sans compte, voir `colorForNickname`) plutôt
    // qu'un tirage aléatoire à CHAQUE spawn/respawn (retour utilisateur : un bot changeait de skin
    // à chaque réapparition, incohérent avec le bestiaire) — un bot garde ainsi toujours le même
    // skin pour un nom donné, cohérent entre toutes les parties et tous les points de vue.
    const botSkin = skinForNickname(nickname);
    this.activeBots.set(botId, bot);
    this.room.addPlayer(botId, nickname, botSkin);

    const firstPiece = this.room.world.getPiecesByOwner(botId)[0];
    if (firstPiece) {
      if (profile === 'challenger' && rank !== undefined) {
        const multiplier =
          challengerMassOverride ?? challengerMassMultiplierForRank(rank, challengerConfig);
        this.room.world.setMass(firstPiece, firstPiece.mass * multiplier);
      }

      // Masse personnalisée (§9.3/§17) : même schéma que le multiplicateur Challenger ci-dessus —
      // appliquée APRÈS `addPlayer`/`onPlayerJoin` (jamais avant, qui a besoin d'une masse de
      // départ valide, `startMass` du mod, pour placer la pièce à une position sûre en premier
      // lieu, voir `spawnPlayerPiece`, mods/parametric/index.ts).
      if (customOptions?.mass !== undefined) {
        this.room.world.setMass(firstPiece, customOptions.mass);
      }

      // Position personnalisée (§9.3/§17, "position précise (x,y) ou au clic sur le canva") : les
      // DEUX coordonnées doivent être fournies ensemble, sinon ignorées (pas de repositionnement
      // partiel, voir `CustomBotSpawnOptions`) — clampée défensivement dans les bornes de la carte
      // (origine en haut à gauche, `[0, mapSize]`, voir `randomPositionInMap`,
      // mods/parametric/index.ts) : une position hors carte fournie par l'admin ne doit pas faire
      // disparaître le bot du monde jouable.
      if (customOptions?.x !== undefined && customOptions?.y !== undefined) {
        const mapSize = this.room.world.mapSize;
        firstPiece.position.x = Math.max(0, Math.min(mapSize, customOptions.x));
        firstPiece.position.y = Math.max(0, Math.min(mapSize, customOptions.y));
      }
    }
  }

  /** Supprime le plus petit bot (bots normaux d'abord, puis challengers si nécessaire). */
  removeSmallestBot(): void {
    let smallestBotId: PlayerId | undefined;
    let minMass = Infinity;

    for (const bot of this.activeBots.values()) {
      if (bot.profile === 'challenger') continue;

      const player = this.room.world.getPlayer(bot.id);
      if (!player) {
        smallestBotId = bot.id;
        break;
      }

      let mass = 0;
      for (const pieceId of player.pieceIds) {
        const piece = this.room.world.getEntity(pieceId);
        if (piece) mass += piece.mass;
      }

      if (mass < minMass) {
        minMass = mass;
        smallestBotId = bot.id;
      }
    }

    if (!smallestBotId) {
      const maxRank = (this.config.challengers ?? DEFAULT_CHALLENGER_CONFIG).massMultipliers.length;
      for (let rank = maxRank; rank >= 1; rank--) {
        const challengerId = `bot-challenger-${rank}`;
        if (this.activeBots.has(challengerId)) {
          smallestBotId = challengerId;
          break;
        }
      }
    }

    if (smallestBotId) {
      this.activeBots.delete(smallestBotId);
      this.room.removePlayer(smallestBotId);
    }
  }

  onPlayerDeath(playerId: PlayerId): void {
    const bot = this.activeBots.get(playerId);
    if (!bot) return;

    this.activeBots.delete(playerId);
    this.room.removePlayer(playerId);

    // Un Challenger mangé (demande utilisateur) : le remplaçant entre TOUJOURS au palier le plus
    // faible actuellement actif (rang `baselineCount`/cible ramped, ex. x10 ou x3) — jamais au
    // palier de son propre rang (qui pouvait être x50) — voir `respawnChallengerAtWeakestTier`.
    // Fait AVANT `adjustPopulation()` ci-dessous : celui-ci comble ensuite tout écart restant
    // (rangs manquants) avec le barème normal par rang, sans jamais re-remplir un rang déjà
    // repeuplé ici (voir la garde `!this.activeBots.has(challengerId)` dans `adjustPopulation`).
    if (bot.profile === 'challenger') {
      this.respawnChallengerAtWeakestTier();
    }
    this.adjustPopulation();
  }

  /** Fait réapparaître UN Challenger au palier de masse le plus faible actuellement actif
   * (`baselineCount` paliers si aucun humain n'est connecté, cible ramped sinon — voir
   * `rampedChallengerTarget`/`adjustPopulation`), dans n'importe quel rang de slot libre (le rang
   * sert uniquement d'id unique/de nom ici, PAS de barème de masse — voir `spawnBot`,
   * `challengerMassOverride`). Ne fait rien si les Challengers sont désactivés ou si aucun rang
   * n'est libre (population déjà au complet, `adjustPopulation` juste après s'occupera du reste
   * normalement). */
  private respawnChallengerAtWeakestTier(): void {
    if (!this.config?.enabled) return;
    const challengerConfig = this.config.challengers ?? DEFAULT_CHALLENGER_CONFIG;
    if (!challengerConfig.enabled) return;

    const humanCount = this.room.world.allPlayers().filter((p) => !this.isBot(p.id)).length;
    const activeTierCount = Math.min(
      humanCount === 0 ? challengerConfig.baselineCount : rampedChallengerTarget(humanCount, challengerConfig),
      challengerConfig.massMultipliers.length,
    );
    if (activeTierCount <= 0) return;
    const weakestMultiplier = challengerMassMultiplierForRank(activeTierCount, challengerConfig);

    for (let rank = 1; rank <= activeTierCount; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (!this.activeBots.has(challengerId)) {
        this.spawnBot('challenger', rank, challengerConfig, weakestMultiplier);
        return;
      }
    }
  }

  onReset(): void {
    for (const botId of Array.from(this.activeBots.keys())) {
      this.room.world.removePlayer(botId);
    }
    this.activeBots.clear();
    this.adjustPopulation();
  }

  isBot(playerId: PlayerId): boolean {
    return isBotId(playerId) || this.activeBots.has(playerId);
  }

  get activeBotCount(): number {
    return this.activeBots.size;
  }

  /** Supprime tous les bots actifs (§4.4 cahier_des_charges_admin.md, "Nettoyage") — même
   * mécanique que `onReset` (retrait direct de `world`, pas `room.removePlayer`, qui
   * redéclencherait `adjustPopulation` à chaque itération), mais sans réinitialiser le reste du
   * salon. Renvoie le nombre de bots retirés (affichage admin). */
  clearAll(): number {
    const count = this.activeBots.size;
    for (const botId of Array.from(this.activeBots.keys())) {
      this.room.world.removePlayer(botId);
    }
    this.activeBots.clear();
    this.adjustPopulation();
    return count;
  }

  /** Force le spawn immédiat d'un bot supplémentaire (§4.4, "Spawner"), au-delà du peuplement
   * automatique de `adjustPopulation` — un profil aléatoire, comme un spawn naturel, SAUF si
   * `options` fixe au moins un des champs pseudo/masse/position (bot PERSONNALISÉ créé depuis
   * l'admin, §9.3/§17) : dans ce cas le profil de pilotage IA est fixé à `'neutre'` (comportement
   * simple et prévisible, alors qu'il resterait sinon tiré au hasard comme un bot ambiant) —
   * `options` ne touche QUE l'apparence/position de spawn, jamais le comportement (le bot reste
   * piloté par l'IA normalement, voir `update()`). */
  forceSpawnOne(options?: CustomBotSpawnOptions): void {
    const isCustom =
      options !== undefined &&
      (options.nickname !== undefined ||
        options.mass !== undefined ||
        options.x !== undefined ||
        options.y !== undefined);
    this.spawnBot(isCustom ? 'neutre' : undefined, undefined, undefined, undefined, options);
  }

  /** Vague de bots (§10.3 cahier_des_charges_admin.md, `spawnBots{count,mass?,behaviorProfile?}`)
   * — appelle directement `spawnBot` (pas `forceSpawnOne`) : une vague garde une personnalité
   * ALÉATOIRE par bot (comme un peuplement ambiant normal), là où `forceSpawnOne` force `'neutre'`
   * dès qu'un champ personnalisé est fourni (bot unitaire, comportement inchangé — voir plus haut).
   * `count` borné [1,50] ici (§10.3 : "1-50"), pas seulement côté UI. */
  forceSpawnMany(count: number, options?: { mass?: number; behaviorId?: string }): void {
    const clamped = Math.max(1, Math.min(50, Math.floor(count) || 1));
    for (let i = 0; i < clamped; i++) {
      this.spawnBot(undefined, undefined, undefined, undefined, {
        mass: options?.mass,
        behaviorId: options?.behaviorId,
      });
    }
  }

  /** Synchronise le pseudo d'un bot lorsqu'il est modifié à la volée par l'admin. */
  onPlayerNicknameChanged(playerId: PlayerId, nickname: string): void {
    const bot = this.activeBots.get(playerId);
    if (bot) {
      bot.nickname = nickname;
    }
  }
}
