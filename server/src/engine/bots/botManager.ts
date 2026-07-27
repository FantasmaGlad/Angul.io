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

  private accumulatorMs = 0;
  private readonly updateIntervalMs: number;

  constructor(room: Room, config: BotConfig, maxRoomCapacity: number) {
    this.room = room;
    this.config = config;
    this.maxRoomCapacity = maxRoomCapacity;
    this.updateIntervalMs = 1000 / Math.max(0.1, config.updateFrequencyHz || 2);
  }

  /** Exécuté à chaque tick de la room. Déclenche l'IA uniquement à la fréquence configurée (2 Hz). */
  update(dt: number): void {
    if (!this.config.enabled) return;

    // S'assure d'ajuster la population si nécessaire
    this.adjustPopulation();

    this.accumulatorMs += dt * 1000;
    if (this.accumulatorMs < this.updateIntervalMs) return;

    this.accumulatorMs %= this.updateIntervalMs;

    // Évaluation IA pour chaque bot actif
    for (const bot of this.activeBots.values()) {
      const { input, memory } = computeBotInput(
        this.room.world,
        bot.id,
        bot.profile,
        bot.memory,
      );
      bot.memory = memory;
      this.room.handleInput(bot.id, input);
    }
  }

  /** Ajuste le nombre de bots actifs selon le nombre de joueurs humains et gère le Top 10 Challengers. */
  adjustPopulation(): void {
    if (!this.config.enabled) return;

    // 1. S'assurer que les 10 Challenger Bots (ranks 1 à 10) sont toujours vivants et actifs
    for (let rank = 1; rank <= 10; rank++) {
      const challengerId = `bot-challenger-${rank}`;
      if (!this.activeBots.has(challengerId)) {
        this.spawnBot('challenger', rank);
      }
    }

    // 2. Ajuster le reste de la population de bots normaux
    const allPlayers = Array.from(this.room.world.allPlayers());
    const humanCount = allPlayers.filter((p) => !this.activeBots.has(p.id)).length;

    const targetBotCount = Math.floor(this.maxRoomCapacity * (this.config.targetRatio ?? 0.5));
    const desiredBots = Math.max(10, targetBotCount - humanCount);

    // Si on manque de bots
    while (this.activeBots.size < desiredBots) {
      this.spawnBot();
    }

    // Si on a trop de bots (supprime les bots normaux les plus petits, protège les Challengers)
    while (this.activeBots.size > desiredBots) {
      this.removeSmallestNormalBot();
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

    const bot: ActiveBot = {
      id: botId,
      nickname,
      profile,
      memory: {},
      rank,
    };

    this.activeBots.set(botId, bot);
    this.room.addPlayer(botId, nickname);

    // Si c'est un Challenger, lui attribuer son multiplicateur de masse (x5 à x50 de M0)
    if (profile === 'challenger' && rank !== undefined) {
      const multiplier = getChallengerMassMultiplier(rank);
      const pieces = this.room.world.getPiecesByOwner(botId);
      const firstPiece = pieces[0];
      if (firstPiece) {
        this.room.world.setMass(firstPiece, firstPiece.mass * multiplier);
      }
    }

  }

  private removeSmallestNormalBot(): void {
    let smallestBotId: PlayerId | undefined;
    let minMass = Infinity;

    for (const bot of this.activeBots.values()) {
      // Ne jamais supprimer un Challenger lors de la réduction de population
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

    if (smallestBotId) {
      this.activeBots.delete(smallestBotId);
      this.room.removePlayer(smallestBotId);
    }
  }

  /** Notifié quand un joueur (humain ou bot) meurt. */
  onPlayerDeath(playerId: PlayerId): void {
    if (this.activeBots.has(playerId)) {
      this.activeBots.delete(playerId);
      this.room.removePlayer(playerId);
      this.adjustPopulation();
    }
  }

  /** Notifié lors de la réinitialisation du salon (room.reset()). */
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
