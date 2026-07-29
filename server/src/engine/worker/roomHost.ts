import type { MovementConfig } from '@angulio/shared';
import { resolveMod as defaultResolveMod } from '../modRegistry.js';
import type { Room } from '../room.js';
import type { ModResolver } from '../roomManager.js';
import type { PlayerId, PlayerInput } from '../types.js';
import type {
  AdminActionResult,
  AdminPlayerInfo,
  AdminRoomAction,
  DeathInfo,
  JoinResult,
  LeaveResult,
  PlayerJoinEvent,
  RespawnResult,
  RoomSpec,
  RoomStats,
  TickPayload,
} from './protocol.js';
import { RoomInstance } from './roomInstance.js';

export interface RoomHandle {
  readonly id: string;
  /** Connue synchroniquement dès la création, quel que soit l'hébergement (voir
   * `WorkerRoomHost.createRoom`, qui résout le mod une fois sur le thread principal — en plus de
   * la résolution faite par le worker lui-même — uniquement pour cette valeur) : le réseau en a
   * besoin immédiatement pour le message `welcome` (connectionHandler.ts), avant même qu'un
   * salon hébergé par un worker n'ait eu le temps de démarrer sa simulation. */
  readonly mapSize: number;
  /** Sous-ensemble du modèle de mouvement du mod actif, transmis au client dans `welcome.movement`
   * pour la prédiction locale (client/src/prediction.ts, plan_performance_reseau.md Phase 1) —
   * connue synchroniquement dès la création comme `mapSize`, pour la même raison (message
   * `welcome`, avant même qu'un salon hébergé par un worker n'ait démarré sa simulation). */
  readonly movement: MovementConfig;
  /** Uniquement peuplé par `LocalRoomHost` (même process) — permet aux tests existants de
   * continuer à manipuler `Room` directement (tick manuel, lecture de `.world`) sans changement
   * tant que `ROOM_WORKERS` reste à 0 (comportement par défaut, voir index.ts). Toujours
   * `undefined` pour un salon hébergé par `WorkerRoomHost` : aucune instance `Room` n'existe dans
   * le thread principal dans ce cas. */
  readonly localRoom?: Room;

  join(nickname: string, skin?: string): Promise<JoinResult>;
  respawn(playerId: PlayerId, nickname: string): Promise<RespawnResult>;
  leave(playerId: PlayerId): Promise<LeaveResult | undefined>;
  input(playerId: PlayerId, input: PlayerInput): void;
  connectViewer(playerId: PlayerId, isSpectator: boolean): void;
  disconnectViewer(playerId: PlayerId): void;

  /** Action admin générique (§4.3-4.4 cahier_des_charges_admin.md) — voir `AdminRoomAction`. */
  adminAction(action: AdminRoomAction): Promise<AdminActionResult>;
  /** Liste des joueurs du salon pour "Salons & Écrans" (§3.3). */
  adminListPlayers(): Promise<AdminPlayerInfo[]>;

  onTick(listener: (tick: number, payloads: TickPayload[], stats: RoomStats) => void): void;
  onPlayerJoin(listener: (event: PlayerJoinEvent) => void): void;
  onPlayerDeath(listener: (playerId: PlayerId, info: DeathInfo) => void): void;
  onReset(listener: () => void): void;

  destroy(): void;
}

export interface RoomHost {
  createRoom(spec: RoomSpec): RoomHandle;
}

class LocalRoomHandle implements RoomHandle {
  readonly id: string;
  readonly mapSize: number;
  readonly movement: MovementConfig;
  readonly localRoom: Room;
  private readonly instance: RoomInstance;

  constructor(instance: RoomInstance) {
    this.instance = instance;
    this.id = instance.id;
    this.localRoom = instance.room;
    this.mapSize = instance.room.world.mapSize;
    this.movement = instance.movement;
  }

  join(nickname: string, skin?: string): Promise<JoinResult> {
    return Promise.resolve(this.instance.join(nickname, skin));
  }

  respawn(playerId: PlayerId, nickname: string): Promise<RespawnResult> {
    return Promise.resolve(this.instance.respawn(playerId, nickname));
  }

  leave(playerId: PlayerId): Promise<LeaveResult | undefined> {
    return Promise.resolve(this.instance.leave(playerId));
  }

  input(playerId: PlayerId, input: PlayerInput): void {
    this.instance.input(playerId, input);
  }

  connectViewer(playerId: PlayerId, isSpectator: boolean): void {
    this.instance.connectViewer(playerId, isSpectator);
  }

  disconnectViewer(playerId: PlayerId): void {
    this.instance.disconnectViewer(playerId);
  }

  adminAction(action: AdminRoomAction): Promise<AdminActionResult> {
    return Promise.resolve(this.instance.adminAction(action));
  }

  adminListPlayers(): Promise<AdminPlayerInfo[]> {
    return Promise.resolve(this.instance.adminListPlayers());
  }

  onTick(listener: (tick: number, payloads: TickPayload[], stats: RoomStats) => void): void {
    this.instance.onTick(listener);
  }

  onPlayerJoin(listener: (event: PlayerJoinEvent) => void): void {
    this.instance.onPlayerJoin(listener);
  }

  onPlayerDeath(listener: (playerId: PlayerId, info: DeathInfo) => void): void {
    this.instance.onPlayerDeath(listener);
  }

  onReset(listener: () => void): void {
    this.instance.onReset(listener);
  }

  destroy(): void {
    this.instance.destroy();
  }
}

/** Hébergement historique (MVP) : chaque salon est une `RoomInstance` ordinaire dans le même
 * process/thread que le réseau — comportement strictement identique à l'ancien `new Room(...)`
 * direct dans `RoomManager.createRoom`, juste réorganisé derrière l'interface `RoomHost` pour
 * pouvoir un jour cohabiter avec `WorkerRoomHost` sans toucher à `RoomManager`/`broadcast.ts`/
 * `connectionHandler.ts`. Défaut (`ROOM_WORKERS=0`, voir index.ts) : aucun changement de
 * comportement observable par rapport à avant ce refactor. */
export function createLocalRoomHost(resolveMod: ModResolver = defaultResolveMod): RoomHost {
  return {
    createRoom(spec: RoomSpec): RoomHandle {
      const instance = new RoomInstance(spec, resolveMod);
      return new LocalRoomHandle(instance);
    },
  };
}
