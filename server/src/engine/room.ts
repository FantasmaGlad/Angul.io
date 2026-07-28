import { add, scale } from '@angulio/shared';
import type { BotConfig } from '../mods/parametric/config.js';
import { BotManager } from './bots/botManager.js';
import type { GameMod } from './mod.js';
import {
  DEFAULT_RESET_SCHEDULE,
  delayUntilNextReset,
  type RoomResetSchedule,
} from './resetSchedule.js';
import type { PlayerId, PlayerInput } from './types.js';
import { World } from './world.js';

/** Passé aux auditeurs de mort (voir `onPlayerDeath`) — de quoi construire l'écran de mort
 * personnalisé côté réseau (broadcast.ts) sans que celui-ci ait à recalculer quoi que ce soit
 * lui-même. */
export interface PlayerDeathInfo {
  /** Pseudo du dernier joueur ayant mangé un morceau de la victime — résolu ici (pas seulement
   * l'id) car l'attaquant peut lui-même s'être déconnecté entre-temps ; `undefined` si personne
   * ne l'a mangée cette vie ou si l'attaquant n'est plus dans le monde. */
  killerNickname?: string;
  survivalTimeSec: number;
}

export interface RoomOptions {
  mapSize: number;
  tickRateHz: number;
  kArea?: number;
  maxPlayers?: number;
  bots?: BotConfig;
  /** Planification du reset automatique (Lot 2.4, §2.1 du cahier des charges) — par défaut
   * 1x/24h à 10h heure de Paris (`DEFAULT_RESET_SCHEDULE`). `null` désactive le reset
   * automatique (le salon ne se réinitialise alors que via un appel manuel à `reset()`). */
  resetSchedule?: RoomResetSchedule | null;
}

/**
 * Assemble World + mod + boucle de tick fixe. Une room = une simulation indépendante
 * (cahier des charges §4.3) ; plusieurs rooms peuvent tourner en parallèle dans le même
 * process pour le MVP.
 */
/** Nombre de durées de tick conservées pour `tickMetrics()` (~3s d'historique à 20Hz) — assez
 * pour un p95 représentatif sans faire grossir la mémoire par salon indéfiniment. */
const TICK_DURATION_SAMPLE_SIZE = 60;

/** Un tick est compté comme "en retard" (`tickMetrics().overruns`) si son intervalle réel dépasse
 * 1.5x l'intervalle nominal attendu (`tickIntervalMs`) — signe que l'event loop était occupé
 * ailleurs (autre salon, sérialisation réseau) au moment où ce tick aurait dû démarrer. Voir
 * server/src/net/metrics.ts, qui expose ce compteur via `/api/admin/health`. */
const TICK_OVERRUN_FACTOR = 1.5;

export class Room {
  readonly world: World;
  readonly botManager?: BotManager;
  /** Exposée (pas seulement `tickIntervalMs`) pour que le réseau puisse l'annoncer au client dans
   * `welcome` (écran de diagnostic F3, `Server TPS`) sans dupliquer la constante. */
  readonly tickRateHz: number;
  private readonly mod: GameMod;
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private resetTimer: ReturnType<typeof setTimeout> | undefined;
  private lastTickAt = 0;
  private tickCount = 0;
  private readonly resetSchedule: RoomResetSchedule | undefined;
  private readonly stateListeners: Array<(tick: number) => void> = [];
  private readonly deathListeners: Array<(playerId: PlayerId, info: PlayerDeathInfo) => void> = [];
  private readonly resetListeners: Array<() => void> = [];
  /** Durée (ms) du travail de tick le plus récent (hors attente du timer), la plus ancienne en
   * premier — voir `tickMetrics()`. */
  private readonly recentTickDurationsMs: number[] = [];
  private tickOverruns = 0;

  constructor(mod: GameMod, options: RoomOptions) {
    this.world = new World({ mapSize: options.mapSize, kArea: options.kArea });
    this.mod = mod;
    this.tickRateHz = options.tickRateHz;
    this.tickIntervalMs = 1000 / options.tickRateHz;
    this.resetSchedule =
      options.resetSchedule === null
        ? undefined
        : (options.resetSchedule ?? DEFAULT_RESET_SCHEDULE);

    if (options.bots?.enabled) {
      this.botManager = new BotManager(this, options.bots, options.maxPlayers ?? 50);
    }

    this.mod.onRoomInit?.(this.world);
  }

  start(): void {
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
    this.scheduleReset();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    if (this.resetTimer) clearTimeout(this.resetTimer);
  }

  private scheduleReset(): void {
    if (!this.resetSchedule) return;
    const delay = delayUntilNextReset(this.resetSchedule);
    this.resetTimer = setTimeout(() => {
      this.reset();
      this.scheduleReset(); // reprogrammé à chaque déclenchement (recalcule la prochaine
      // occurrence à partir de l'heure réelle plutôt que d'ajouter bêtement 24h, pour rester
      // correct malgré les changements d'heure — voir resetSchedule.ts).
    }, delay);
  }

  /** Réinitialise le salon (Lot 2.4) : vide entièrement le monde (morceaux ET nourriture — la
   * nourriture repousse ensuite via la logique habituelle du mod, `onTick`) puis fait
   * respawner chaque joueur encore connecté comme s'il venait de rejoindre. Les joueurs restent
   * connectés (pas de déconnexion, pas de perte de pseudo) ; `onReset` notifie le réseau pour
   * qu'il prévienne chaque client (voir net/server.ts, réutilise le message `died` existant —
   * la sensation "je viens de mourir, je respawn" est exactement ce qui se passe). Invocable
   * automatiquement (planification) ou manuellement (tests, admin plus tard). */
  reset(): void {
    for (const entity of this.world.allEntities()) this.world.removeEntity(entity.id);
    for (const player of this.world.allPlayers()) this.mod.onPlayerJoin?.(this.world, player.id);
    this.botManager?.onReset();
    for (const listener of this.resetListeners) listener();
  }

  /** Notifié à chaque reset (automatique ou manuel) — utile au réseau pour prévenir les
   * clients connectés, indépendamment du mod. */
  onReset(listener: () => void): void {
    this.resetListeners.push(listener);
  }

  /** Exécute un seul tick manuellement (utile pour les tests, sans dépendre d'un vrai timer). */
  tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.tickCount += 1;

    if (this.tickCount > 1 && dt > (this.tickIntervalMs / 1000) * TICK_OVERRUN_FACTOR) {
      this.tickOverruns += 1;
    }

    this.mod.onTick?.(this.world, dt);
    this.botManager?.update(dt);

    for (const entity of this.world.allEntities()) {
      entity.position = add(entity.position, scale(entity.velocity, dt));
    }

    this.mod.onPostMove?.(this.world, dt);

    this.world.rebuildSpatialHash();
    for (const [a, b] of this.world.findOverlappingPairs()) {
      // une collision précédente dans cette même passe a pu retirer l'une des deux entités
      if (this.world.getEntity(a.id) && this.world.getEntity(b.id)) {
        this.mod.onCollision?.(this.world, a, b);
      }
    }

    for (const player of this.world.allPlayers()) {
      const currentlyAlive = player.pieceIds.length > 0;
      if (player.alive && !currentlyAlive) {
        this.mod.onPlayerDeath?.(this.world, player.id);
        this.botManager?.onPlayerDeath(player.id);
        const killer = player.lastAttackerId
          ? this.world.getPlayer(player.lastAttackerId)
          : undefined;
        const info: PlayerDeathInfo = {
          killerNickname: killer?.nickname,
          survivalTimeSec: (now - player.spawnedAtMs) / 1000,
        };
        for (const listener of this.deathListeners) listener(player.id, info);
      }
      player.alive = currentlyAlive;
    }

    for (const listener of this.stateListeners) listener(this.tickCount);

    this.recordTickDuration(performance.now() - now);
  }

  private recordTickDuration(durationMs: number): void {
    this.recentTickDurationsMs.push(durationMs);
    if (this.recentTickDurationsMs.length > TICK_DURATION_SAMPLE_SIZE) {
      this.recentTickDurationsMs.shift();
    }
  }

  /** Métriques de charge de ce salon (voir server/src/net/metrics.ts, `/api/admin/health`) —
   * calculées à la demande plutôt que maintenues en continu, un salon n'étant interrogé qu'au
   * rythme des requêtes admin (pas à chaque tick). */
  tickMetrics(): { avgMs: number; p95Ms: number; overruns: number } {
    const samples = this.recentTickDurationsMs;
    if (samples.length === 0) return { avgMs: 0, p95Ms: 0, overruns: this.tickOverruns };

    const sorted = [...samples].sort((a, b) => a - b);
    const avgMs = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const p95Index = Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1);
    return { avgMs, p95Ms: sorted[p95Index]!, overruns: this.tickOverruns };
  }

  private readonly playerJoinListeners: Array<
    (id: PlayerId, nickname: string, skin?: string) => void
  > = [];

  addPlayer(id: PlayerId, nickname: string, skin?: string): void {
    this.world.addPlayer(id, nickname);
    this.mod.onPlayerJoin?.(this.world, id);
    for (const listener of this.playerJoinListeners) {
      listener(id, nickname, skin);
    }
    if (!this.botManager?.isBot(id)) {
      this.botManager?.adjustPopulation();
    }
  }

  onPlayerJoin(
    listener: (id: PlayerId, nickname: string, skin?: string) => void,
  ): void {
    this.playerJoinListeners.push(listener);
  }

  removePlayer(id: PlayerId): void {
    this.mod.onPlayerLeave?.(this.world, id);
    this.world.removePlayer(id);
    if (!this.botManager?.isBot(id)) {
      this.botManager?.adjustPopulation();
    }
  }

  handleInput(playerId: PlayerId, input: PlayerInput): void {
    this.mod.onPlayerInput?.(this.world, playerId, input);
  }

  /** Délègue au mod (voir `GameMod.getAccelerationForMass`) — `undefined` si le mod ne
   * l'implémente pas. */
  getAccelerationForMass(mass: number): number | undefined {
    return this.mod.getAccelerationForMass?.(mass);
  }

  /** Délègue au mod (voir `GameMod.transformScoreForAccount`, Lot 4) — identité si le mod ne
   * l'implémente pas (score/XP bruts inchangés). */
  transformScoreForAccount(rawScore: number, rawXp: number): { score: number; xp: number } {
    return this.mod.transformScoreForAccount?.(rawScore, rawXp) ?? { score: rawScore, xp: rawXp };
  }

  onState(listener: (tick: number) => void): void {
    this.stateListeners.push(listener);
  }

  /** Notifié quand un joueur passe de "a au moins un morceau" à "n'en a plus aucun" — utile au
   * réseau (net/server.ts) pour envoyer un message `died` sans avoir à décorer le mod. */
  onPlayerDeath(listener: (playerId: PlayerId, info: PlayerDeathInfo) => void): void {
    this.deathListeners.push(listener);
  }

  get currentTick(): number {
    return this.tickCount;
  }
}
