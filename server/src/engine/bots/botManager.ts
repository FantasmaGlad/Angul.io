import { distance, getRandomSkin, isBotId } from '@angulio/shared';
import type { BotConfig } from '../../mods/parametric/config.js';
import type { Room } from '../room.js';
import type { PlayerId } from '../types.js';
import { computeBotInput, type BotStateMemory } from './botEvaluator.js';
import {
  DEFAULT_BOT_PROPORTIONS,
  generateBotNickname,
  getChallengerMassMultiplier,
  selectRandomBotProfile,
  type BotProfileKind,
} from './botTypes.js';

interface ActiveBot {
  id: PlayerId;
  nickname: string;
  profile: BotProfileKind;
  memory: BotStateMemory;
  rank?: number;
  accumulatorMs: number;
}

export class BotManager {
  private readonly room: Room;
  private readonly config: BotConfig;
  private readonly maxRoomCapacity: number;
  private readonly activeBots = new Map<PlayerId, ActiveBot>();
  private readonly botCounters: Record<BotProfileKind, number> = {
    fuis: 0,
    neutre: 0,
    agressif: 0,
    fou: 0,
    challenger: 0,
  };

  private currentTargetRatio = 0.7;
  private ratioTimerMs = 0;
  private nextRatioChangeMs = 0;
  private readonly updateIntervalMs: number;

  constructor(room: Room, config: BotConfig, maxRoomCapacity: number) {
    this.room = room;
    this.config = config;
    this.maxRoomCapacity = maxRoomCapacity;
    this.updateIntervalMs = 1000 / Math.max(0.1, config.updateFrequencyHz || 30);
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
    this.adjustPopulation();

    // `isTouchingHuman` (voir son commentaire) ne peut JAMAIS renvoyer `true` en l'absence
    // d'humain — l'évaluer quand même coûterait une requête spatiale (`queryNearby`, allocation
    // d'un tableau) PAR MORCEAU DE BOT, À CHAQUE TICK non dû, un coût mesuré non négligeable au
    // profilage (voir audit_chaleur.md) sur un salon "au repos" (aucun joueur humain, seulement
    // les bots ambiants qui peuplent en permanence les salons publics) — précisément le cas le
    // plus fréquent en dehors des heures de forte affluence. Calculé UNE FOIS par tick (pas par
    // bot) : `allPlayers()` alloue déjà un tableau, autant ne le payer qu'une fois.
    const hasHuman = this.room.world.allPlayers().some((p) => !this.isBot(p.id));

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
        const { input, memory } = computeBotInput(this.room.world, bot.id, bot.profile, bot.memory);
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

  /** Ajuste le nombre de bots actifs selon le nombre de joueurs humains et garantit qu'il reste toujours au moins 1 place disponible pour un humain. */
  adjustPopulation(maxSpawnPerTick = 20): void {
    if (!this.config?.enabled) return;

    const allPlayers = Array.from(this.room.world.allPlayers());
    const humanCount = allPlayers.filter((p) => !this.activeBots.has(p.id)).length;

    // Toujours réserver au moins 1 place pour un joueur humain s'il n'y a pas d'humain connecté
    const maxBotsAllowed = Math.max(0, this.maxRoomCapacity - Math.max(1, humanCount));

    // 1. Les Challenger Bots (jusqu'à 10, bridés par la capacité autorisée du salon ; 0 si 0 humain pour l'ambiance)
    const maxChallengers = humanCount === 0 ? 0 : Math.min(10, maxBotsAllowed);
    let spawnedThisTick = 0;

    for (let rank = 1; rank <= maxChallengers; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (!this.activeBots.has(challengerId)) {
        if (spawnedThisTick < maxSpawnPerTick) {
          this.spawnBot('challenger', rank);
          spawnedThisTick++;
        }
      }
    }

    // Retirer les challengers si la capacité du salon est inférieure à 10
    for (let rank = maxChallengers + 1; rank <= 10; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (this.activeBots.has(challengerId)) {
        this.activeBots.delete(challengerId);
        this.room.removePlayer(challengerId);
      }
    }

    // 2. Ajuster le reste de la population de bots normaux (mode ambiance à 0 joueur humain si ambientTargetCount est défini)
    const effectiveRatio = this.config.targetRatio ?? this.currentTargetRatio;
    const targetBotCount = Math.floor(this.maxRoomCapacity * effectiveRatio);
    const ambientCount = this.config.ambientTargetCount;
    const desiredBots = Math.min(
      maxBotsAllowed,
      humanCount === 0 && ambientCount !== undefined
        ? ambientCount
        : Math.max(ambientCount ?? 0, targetBotCount - humanCount),
    );

    // Si on manque de bots : spawn progressif (limité à maxSpawnPerTick par tick)
    while (this.activeBots.size < desiredBots && spawnedThisTick < maxSpawnPerTick) {
      this.spawnBot();
      spawnedThisTick++;
    }

    // Si on a trop de bots : ajustement immédiat
    while (this.activeBots.size > desiredBots) {
      this.removeSmallestBot();
    }
  }

  private spawnBot(forcedProfile?: BotProfileKind, rank?: number): void {
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

    // Décalage initial de l'accumulateur pour étaler les calculs d'IA des bots
    const offsetMs = Math.random() * this.updateIntervalMs;

    const bot: ActiveBot = {
      id: botId,
      nickname,
      profile,
      memory: {},
      rank,
      accumulatorMs: offsetMs,
    };

    const randomSkin = getRandomSkin();
    this.activeBots.set(botId, bot);
    this.room.addPlayer(botId, nickname, randomSkin);

    if (profile === 'challenger' && rank !== undefined) {
      const multiplier = getChallengerMassMultiplier(rank);
      const pieces = this.room.world.getPiecesByOwner(botId);
      const firstPiece = pieces[0];
      if (firstPiece) {
        this.room.world.setMass(firstPiece, firstPiece.mass * multiplier);
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
      for (let rank = 10; rank >= 1; rank--) {
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
    if (this.activeBots.has(playerId)) {
      this.activeBots.delete(playerId);
      this.room.removePlayer(playerId);
      this.adjustPopulation();
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
   * automatique de `adjustPopulation` — un profil aléatoire, comme un spawn naturel. */
  forceSpawnOne(): void {
    this.spawnBot();
  }
}
