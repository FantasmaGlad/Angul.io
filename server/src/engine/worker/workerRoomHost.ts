import { Worker } from 'node:worker_threads';
import { DEFAULT_MOVEMENT_CONFIG, type MovementConfig } from '@angulio/shared';
import { resolveMod } from '../modRegistry.js';
import type { PlayerId, PlayerInput } from '../types.js';
import { logEvent } from '../../log.js';
import type { RoomHandle, RoomHost } from './roomHost.js';
import type {
  AdminActionResult,
  AdminPlayerInfo,
  AdminRoomAction,
  DeathInfo,
  JoinResult,
  LeaveResult,
  PlayerJoinEvent,
  RespawnResult,
  RoomCommand,
  RoomSpec,
  RoomStats,
  RoomWorkerEvent,
  TickPayload,
} from './protocol.js';

const ROOM_WORKER_URL = new URL('./roomWorker.js', import.meta.url);

interface PendingRequest {
  resolve: (value: never) => void;
}

interface WorkerEntry {
  worker: Worker;
  roomCount: number;
}

class WorkerRoomHandle implements RoomHandle {
  readonly id: string;
  readonly mapSize: number;
  readonly movement: MovementConfig;
  readonly localRoom = undefined;

  private readonly tickListeners: Array<
    (tick: number, payloads: TickPayload[], stats: RoomStats) => void
  > = [];
  private readonly playerJoinListeners: Array<(event: PlayerJoinEvent) => void> = [];
  private readonly deathListeners: Array<(playerId: PlayerId, info: DeathInfo) => void> = [];
  private readonly resetListeners: Array<() => void> = [];

  constructor(
    id: string,
    mapSize: number,
    movement: MovementConfig,
    private readonly worker: Worker,
    private readonly nextReqId: () => number,
    private readonly pending: Map<number, PendingRequest>,
    private readonly onDestroy?: () => void,
  ) {
    this.id = id;
    this.mapSize = mapSize;
    this.movement = movement;
  }

  private post(command: RoomCommand): void {
    this.worker.postMessage(command);
  }

  private request<T>(build: (reqId: number) => RoomCommand): Promise<T> {
    const reqId = this.nextReqId();
    return new Promise<T>((resolve) => {
      this.pending.set(reqId, { resolve: resolve as (value: never) => void });
      this.post(build(reqId));
    });
  }

  join(nickname: string, skin?: string): Promise<JoinResult> {
    return this.request<JoinResult>((reqId) => ({
      type: 'joinRequest',
      reqId,
      roomId: this.id,
      nickname,
      skin,
    }));
  }

  respawn(playerId: PlayerId, nickname: string): Promise<RespawnResult> {
    return this.request<RespawnResult>((reqId) => ({
      type: 'respawnRequest',
      reqId,
      roomId: this.id,
      playerId,
      nickname,
    }));
  }

  leave(playerId: PlayerId): Promise<LeaveResult | undefined> {
    return this.request<LeaveResult | undefined>((reqId) => ({
      type: 'leaveRequest',
      reqId,
      roomId: this.id,
      playerId,
    }));
  }

  input(playerId: PlayerId, input: PlayerInput): void {
    this.post({ type: 'input', roomId: this.id, playerId, input });
  }

  connectViewer(playerId: PlayerId, isSpectator: boolean): void {
    this.post({ type: 'connectViewer', roomId: this.id, playerId, isSpectator });
  }

  disconnectViewer(playerId: PlayerId): void {
    this.post({ type: 'disconnectViewer', roomId: this.id, playerId });
  }

  adminAction(action: AdminRoomAction): Promise<AdminActionResult> {
    return this.request<AdminActionResult>((reqId) => ({
      type: 'adminActionRequest',
      reqId,
      roomId: this.id,
      action,
    }));
  }

  adminListPlayers(): Promise<AdminPlayerInfo[]> {
    return this.request<AdminPlayerInfo[]>((reqId) => ({
      type: 'adminListPlayersRequest',
      reqId,
      roomId: this.id,
    }));
  }

  onTick(listener: (tick: number, payloads: TickPayload[], stats: RoomStats) => void): void {
    this.tickListeners.push(listener);
  }

  onPlayerJoin(listener: (event: PlayerJoinEvent) => void): void {
    this.playerJoinListeners.push(listener);
  }

  onPlayerDeath(listener: (playerId: PlayerId, info: DeathInfo) => void): void {
    this.deathListeners.push(listener);
  }

  onReset(listener: () => void): void {
    this.resetListeners.push(listener);
  }

  destroy(): void {
    this.onDestroy?.();
    this.post({ type: 'destroyRoom', roomId: this.id });
  }

  /** Appelé par `createWorkerRoomHost` quand un événement (tick/join/mort/reset) concernant ce
   * salon arrive du worker qui l'héberge — jamais pour les réponses `join`/`respawn`/`leave`
   * (corrélées par `reqId`, résolues directement sans passer par une instance de salon, voir
   * plus bas). */
  dispatch(event: RoomWorkerEvent): void {
    switch (event.type) {
      case 'tick':
        for (const listener of this.tickListeners) listener(event.tick, event.payloads, event.stats);
        break;
      case 'playerJoin':
        for (const listener of this.playerJoinListeners) listener(event.event);
        break;
      case 'playerDeath':
        for (const listener of this.deathListeners) listener(event.playerId, event.info);
        break;
      case 'roomReset':
        for (const listener of this.resetListeners) listener();
        break;
      default:
        break;
    }
  }
}

/**
 * Répartit les salons sur `workerCount` threads séparés (voir plan_implementation,
 * "worker_threads") — chaque salon est épinglé à vie au worker qui l'a créé (pas de
 * rééquilibrage à chaud, inutile à l'échelle visée ici, voir plan). Assignation au worker le
 * moins chargé (nombre de salons) au moment de la création.
 *
 * Un worker qui crashe perd ses salons (non redémarrés automatiquement) — acceptable pour cette
 * première version, loggé via `room_worker_crashed` pour rester visible en prod (voir
 * `/api/admin/health`, server/src/net/metrics.ts, pour repérer une charge anormale AVANT qu'un
 * crash ne survienne).
 */
export function createWorkerRoomHost(workerCount: number): RoomHost {
  const count = Math.max(1, workerCount);
  const workers: WorkerEntry[] = [];
  const pending = new Map<number, PendingRequest>();
  const handlesByRoomId = new Map<string, WorkerRoomHandle>();
  let reqCounter = 0;
  const nextReqId = (): number => ++reqCounter;

  for (let i = 0; i < count; i++) {
    const worker = new Worker(ROOM_WORKER_URL);

    worker.on('message', (event: RoomWorkerEvent) => {
      if (event.type === 'workerError') {
        logEvent('room_worker_error', { workerIndex: i, roomId: event.roomId, reason: event.message });
        return;
      }
      if ('reqId' in event) {
        const request = pending.get(event.reqId);
        if (request) {
          pending.delete(event.reqId);
          request.resolve((event as { result: unknown }).result as never);
        }
        return;
      }
      if ('roomId' in event && typeof (event as { roomId: string }).roomId === 'string') {
        handlesByRoomId.get((event as { roomId: string }).roomId)?.dispatch(event);
      }
    });

    worker.on('error', (error: Error) => {
      logEvent('room_worker_crashed', { workerIndex: i, reason: error.message });
    });

    workers.push({ worker, roomCount: 0 });
  }

  function leastLoadedWorkerIndex(): number {
    let bestIndex = 0;
    for (let i = 1; i < workers.length; i++) {
      if (workers[i]!.roomCount < workers[bestIndex]!.roomCount) bestIndex = i;
    }
    return bestIndex;
  }

  return {
    createRoom(spec: RoomSpec): RoomHandle {
      const workerIndex = leastLoadedWorkerIndex();
      const entry = workers[workerIndex]!;
      entry.roomCount += 1;

      // Résolution redondante mais volontaire (voir RoomHandle.mapSize/movement) : seulement pour
      // connaître `mapSize`/`movement` synchroniquement sur le thread principal (nécessaire au
      // message `welcome`, voir connectionHandler.ts) sans attendre un aller-retour avec le
      // worker, qui résout le mod une seconde fois de son côté pour la simulation elle-même
      // (roomWorker.ts).
      const { mapSize, movement } = resolveMod(spec.modId);

      const handle = new WorkerRoomHandle(
        spec.id,
        mapSize,
        movement ?? DEFAULT_MOVEMENT_CONFIG,
        entry.worker,
        nextReqId,
        pending,
        () => {
          entry.roomCount = Math.max(0, entry.roomCount - 1);
          handlesByRoomId.delete(spec.id);
        },
      );
      handlesByRoomId.set(spec.id, handle);
      entry.worker.postMessage({ type: 'createRoom', ...spec });
      return handle;
    },
  };
}
