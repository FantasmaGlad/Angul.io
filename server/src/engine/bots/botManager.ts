import { getRandomSkin } from '@angulio/shared';
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
    this.updateIntervalMs = 1000 / Math.max(0.1, config.updateFrequencyHz || 2);
  }

  /** Recalcule périodiquement le ratio de bots entre 3/5 (60%) et 4/5 (80%) de la capacité du salon pour un nombre fluctuant et non fixe de joueurs. */
  private updateFluctuatingRatio(dtMs: number): void {
    this.ratioTimerMs += dtMs;
    if (this.ratioTimerMs >= this.nextRatioChangeMs) {
      this.ratioTimerMs = 0;
      this.nextRatioChangeMs = 10_000 + Math.random() * 20_000;
      const minRatio = 3 / 5; // 0.60 (3/5)
      const maxRatio = 4 / 5; // 0.80 (4/5)
      this.currentTargetRatio = minRatio + Math.random() * (maxRatio - minRatio);
    }
  }

  /** Exécuté à chaque tick de la room. Étale l'évaluation IA des bots sur plusieurs ticks. */
  update(dt: number): void {
    if (!this.config?.enabled) return;

    const dtMs = dt * 1000;
    this.updateFluctuatingRatio(dtMs);
    this.adjustPopulation();

    for (const bot of this.activeBots.values()) {
      bot.accumulatorMs += dtMs;
      if (bot.accumulatorMs >= this.updateIntervalMs) {
        bot.accumulatorMs %= this.updateIntervalMs;
        const { input, memory } = computeBotInput(this.room.world, bot.id, bot.profile, bot.memory);
        bot.memory = memory;
        this.room.handleInput(bot.id, input);
      }
    }
  }

  /** Ajuste le nombre de bots actifs selon le nombre de joueurs humains et garantit qu'il reste toujours au moins 1 place disponible pour un humain. */
  adjustPopulation(maxSpawnPerTick = 20): void {
    if (!this.config?.enabled) return;

    const allPlayers = Array.from(this.room.world.allPlayers());
    const humanCount = allPlayers.filter((p) => !this.activeBots.has(p.id)).length;

    // Toujours réserver au moins 1 place pour un joueur humain s'il n'y a pas d'humain connecté
    const maxBotsAllowed = Math.max(0, this.maxRoomCapacity - Math.max(1, humanCount));

    // 1. Les Challenger Bots (jusqu'à 10, bridés par la capacité autorisée du salon)
    const maxChallengers = Math.min(10, maxBotsAllowed);
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

    // 2. Ajuster le reste de la population de bots normaux (fluctuant entre 3/5 et 4/5 de la capacité)
    const effectiveRatio = this.config.targetRatio ?? this.currentTargetRatio;
    const targetBotCount = Math.floor(this.maxRoomCapacity * effectiveRatio);
    const desiredBots = Math.min(
      maxBotsAllowed,
      Math.max(maxChallengers, targetBotCount - humanCount),
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

    if (profile === 'challenger' && rank !== undefined) {
      index = rank;
      nickname = generateBotNickname('challenger', rank);
      botId = `bot-challenger-${rank}`;
    } else {
      this.botCounters[profile] += 1;
      index = this.botCounters[profile];
      nickname = generateBotNickname(profile, index);
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
    return this.activeBots.has(playerId);
  }

  get activeBotCount(): number {
    return this.activeBots.size;
  }
}
