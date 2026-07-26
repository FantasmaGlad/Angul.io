import { add, scale } from '@angulio/shared';
import type { GameMod } from './mod.js';
import type { PlayerId, PlayerInput } from './types.js';
import { World } from './world.js';

export interface RoomOptions {
  mapSize: number;
  tickRateHz: number;
  kArea?: number;
}

/**
 * Assemble World + mod + boucle de tick fixe. Une room = une simulation indépendante
 * (cahier des charges §4.3) ; plusieurs rooms peuvent tourner en parallèle dans le même
 * process pour le MVP.
 */
export class Room {
  readonly world: World;
  private readonly mod: GameMod;
  private readonly tickIntervalMs: number;
  private timer: ReturnType<typeof setInterval> | undefined;
  private lastTickAt = 0;
  private tickCount = 0;
  private readonly stateListeners: Array<(tick: number) => void> = [];

  constructor(mod: GameMod, options: RoomOptions) {
    this.world = new World({ mapSize: options.mapSize, kArea: options.kArea });
    this.mod = mod;
    this.tickIntervalMs = 1000 / options.tickRateHz;
    this.mod.onRoomInit?.(this.world);
  }

  start(): void {
    this.lastTickAt = performance.now();
    this.timer = setInterval(() => this.tick(), this.tickIntervalMs);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Exécute un seul tick manuellement (utile pour les tests, sans dépendre d'un vrai timer). */
  tick(): void {
    const now = performance.now();
    const dt = (now - this.lastTickAt) / 1000;
    this.lastTickAt = now;
    this.tickCount += 1;

    this.mod.onTick?.(this.world, dt);

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
      }
      player.alive = currentlyAlive;
    }

    for (const listener of this.stateListeners) listener(this.tickCount);
  }

  addPlayer(id: PlayerId, nickname: string): void {
    this.world.addPlayer(id, nickname);
    this.mod.onPlayerJoin?.(this.world, id);
  }

  removePlayer(id: PlayerId): void {
    this.mod.onPlayerLeave?.(this.world, id);
    this.world.removePlayer(id);
  }

  handleInput(playerId: PlayerId, input: PlayerInput): void {
    this.mod.onPlayerInput?.(this.world, playerId, input);
  }

  onState(listener: (tick: number) => void): void {
    this.stateListeners.push(listener);
  }

  get currentTick(): number {
    return this.tickCount;
  }
}
