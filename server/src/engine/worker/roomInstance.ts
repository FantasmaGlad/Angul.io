import { Room } from '../room.js';
import type { ModResolver } from '../roomManager.js';
import { SpatialHash } from '../spatialHash.js';
import type { PlayerId, PlayerInput } from '../types.js';
import { buildStateMessage, computeTopScores, SPECTATOR_TICK_DIVISOR } from './snapshotBuilder.js';
import type {
  DeathInfo,
  JoinResult,
  LeaveResult,
  PlayerJoinEvent,
  RespawnResult,
  RoomSpec,
  RoomStats,
  TickPayload,
} from './protocol.js';

/**
 * Toute la logique d'un salon indépendante de son hébergement (même process pour
 * `LocalRoomHost`, thread séparé pour `WorkerRoomHost` via `roomWorker.ts`) — reprend telle
 * quelle la logique aujourd'hui éparpillée entre `connectionHandler.ts` (décisions de
 * join/respawn/leave) et `broadcast.ts` (construction des messages `state`), regroupée ici pour
 * n'exister qu'à un seul endroit quel que soit l'hébergement (voir plan_implementation,
 * "worker_threads"). Ne connaît rien du réseau (pas de WebSocket, pas de compte joueur/DB) :
 * seulement le salon (`Room`/`World`) et les ids des joueurs/spectateurs à qui envoyer un état à
 * chaque tick (`viewerIds`) — les sockets elles-mêmes, la couleur d'avatar et l'écriture en base
 * restent uniquement du ressort du thread principal (voir broadcast.ts/connectionHandler.ts).
 */
export class RoomInstance {
  readonly id: string;
  readonly room: Room;
  private readonly maxPlayers: number;
  private readonly interestRadiusPx: number;
  private readonly interestHash: SpatialHash;
  private nextPlayerId = 1;
  private readonly viewerIds = new Set<PlayerId>();
  private readonly spectatorIds = new Set<PlayerId>();
  private readonly maxMassByPlayer = new Map<PlayerId, number>();

  private readonly tickListeners: Array<
    (tick: number, payloads: TickPayload[], stats: RoomStats) => void
  > = [];
  private readonly playerJoinListeners: Array<(event: PlayerJoinEvent) => void> = [];
  private readonly deathListeners: Array<(playerId: PlayerId, info: DeathInfo) => void> = [];
  private readonly resetListeners: Array<() => void> = [];

  constructor(spec: RoomSpec, resolveMod: ModResolver, interestRadiusPx: number) {
    this.id = spec.id;
    this.maxPlayers = spec.maxPlayers;
    this.interestRadiusPx = interestRadiusPx;
    this.interestHash = new SpatialHash(interestRadiusPx);

    const { mod, mapSize, kArea, bots } = resolveMod(spec.modId);
    const botConfig = bots ? { ...bots, enabled: spec.botsEnabled ?? bots.enabled } : undefined;
    this.room = new Room(mod, {
      mapSize,
      tickRateHz: spec.tickRateHz,
      kArea,
      maxPlayers: spec.maxPlayers,
      bots: botConfig,
      resetSchedule: spec.resetSchedule,
    });

    this.room.onState((tick) => this.handleTick(tick));
    this.room.onPlayerJoin((id, nickname, skin) => {
      for (const listener of this.playerJoinListeners) listener({ playerId: id, nickname, skin });
    });
    this.room.onPlayerDeath((playerId, info) => this.handleDeath(playerId, info));
    this.room.onReset(() => {
      this.maxMassByPlayer.clear();
      for (const listener of this.resetListeners) listener();
    });

    this.room.start();
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

  /** Décisions identiques à l'ancien `connectionHandler.ts` (join initial) : plafond de joueurs
   * humains, éviction du plus petit bot pour libérer une place, pseudo déjà pris — reprises ici
   * telles quelles, juste relocalisées. */
  join(nickname: string, skin?: string): JoinResult {
    const world = this.room.world;
    const botManager = this.room.botManager;

    const humanCount = world.allPlayers().filter((p) => !botManager?.isBot(p.id)).length;
    if (humanCount >= this.maxPlayers) return { ok: false, reason: 'room_full' };

    while (world.allPlayers().length >= this.maxPlayers) {
      if (botManager && botManager.activeBotCount > 0) botManager.removeSmallestBot();
      else break;
    }

    const nicknameTaken = world
      .allPlayers()
      .some((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (nicknameTaken) return { ok: false, reason: 'nickname_taken' };

    const existingPlayers = world.allPlayers().map((p) => ({ id: p.id, nickname: p.nickname }));
    const playerId = String(this.nextPlayerId++);
    this.maxMassByPlayer.set(playerId, 0);
    this.room.addPlayer(playerId, nickname, skin);

    return { ok: true, playerId, existingPlayers };
  }

  respawn(playerId: PlayerId, nickname: string): RespawnResult {
    const existingPlayer = this.room.world.getPlayer(playerId);
    if (!existingPlayer || existingPlayer.pieceIds.length === 0) {
      this.room.addPlayer(playerId, nickname);
      return { respawned: true };
    }
    return { respawned: false };
  }

  /** `undefined` si `playerId` est inconnu (déjà retiré, ou jamais un vrai joueur — un spectateur
   * n'appelle jamais `leave`, voir `disconnectViewer`). */
  leave(playerId: PlayerId): LeaveResult | undefined {
    const player = this.room.world.getPlayer(playerId);
    if (!player) return undefined;

    const rawScore = this.maxMassByPlayer.get(playerId) ?? 0;
    const rawXp = player.lifeStats.xpEarned ?? 0;
    const { score: transformedScore, xp: transformedXp } = this.room.transformScoreForAccount(
      rawScore,
      rawXp,
    );

    this.room.removePlayer(playerId);
    this.maxMassByPlayer.delete(playerId);
    this.viewerIds.delete(playerId);
    this.spectatorIds.delete(playerId);

    return { transformedScore, transformedXp };
  }

  input(playerId: PlayerId, input: PlayerInput): void {
    this.room.handleInput(playerId, input);
  }

  /** Enregistre un destinataire d'état par tick — joueur réel (après un `join` accepté) ou
   * spectateur (`?spectate=1`, jamais ajouté à `world`, voir SpectatorBackground.tsx côté
   * client) : les deux cas passent par ici, seul `isSpectator` distingue le traitement
   * (fréquence réduite + nourriture échantillonnée, voir snapshotBuilder.ts). */
  connectViewer(playerId: PlayerId, isSpectator: boolean): void {
    this.viewerIds.add(playerId);
    if (isSpectator) this.spectatorIds.add(playerId);
  }

  disconnectViewer(playerId: PlayerId): void {
    this.viewerIds.delete(playerId);
    this.spectatorIds.delete(playerId);
  }

  destroy(): void {
    this.room.stop();
  }

  private handleTick(tick: number): void {
    const world = this.room.world;
    const metrics = this.room.tickMetrics();
    const stats: RoomStats = {
      playerCount: world.allPlayers().length,
      tickAvgMs: metrics.avgMs,
      tickP95Ms: metrics.p95Ms,
      tickOverruns: metrics.overruns,
    };

    // Le calcul des payloads par spectateur/joueur ne sert à rien si personne n'observe ce
    // salon (voir l'ancien `if (runtime.sockets.size === 0) return;` de broadcast.ts) — mais
    // `stats` doit malgré tout être émis à chaque tick, y compris pour un salon sans aucun
    // spectateur/joueur humain connecté (ex. rempli de bots) : `RoomManager.pruneEmptyRooms()`
    // et `/api/admin/health` en dépendent pour un salon hébergé par un worker (pas d'accès
    // synchrone à `world` depuis le thread principal dans ce cas, voir `WorkerRoomHost`).
    if (this.viewerIds.size === 0) {
      for (const listener of this.tickListeners) listener(tick, [], stats);
      return;
    }

    const allEntities = world.allEntities();
    const topScores = computeTopScores(world, Array.from(world.allPlayers()));

    this.interestHash.clear();
    for (const entity of allEntities) this.interestHash.insert(entity);

    const payloads: TickPayload[] = [];
    for (const playerId of this.viewerIds) {
      const isSpectator = this.spectatorIds.has(playerId);
      if (isSpectator && tick % SPECTATOR_TICK_DIVISOR !== 0) continue;

      const { message, totalMass } = buildStateMessage({
        room: this.room,
        playerId,
        isSpectator,
        tick,
        allEntities,
        topScores,
        interestHash: this.interestHash,
        interestRadiusPx: this.interestRadiusPx,
      });
      payloads.push({ playerId, message });

      if (!isSpectator) {
        const previousMax = this.maxMassByPlayer.get(playerId) ?? 0;
        if (totalMass > previousMax) this.maxMassByPlayer.set(playerId, totalMass);
      }
    }

    for (const listener of this.tickListeners) listener(tick, payloads, stats);
  }

  private handleDeath(playerId: PlayerId, info: { killerNickname?: string; survivalTimeSec: number }): void {
    const player = this.room.world.getPlayer(playerId);
    const rawScore = this.maxMassByPlayer.get(playerId) ?? 0;
    const rawXp = player?.lifeStats.xpEarned ?? 0;
    const { score: transformedScore, xp: transformedXp } = this.room.transformScoreForAccount(
      rawScore,
      rawXp,
    );

    const finalScore = Math.round(rawScore);
    const xpEarned = Math.round(rawXp);

    if (player) this.room.world.resetLifeStats(playerId);
    this.maxMassByPlayer.set(playerId, 0);

    const death: DeathInfo = {
      killerNickname: info.killerNickname,
      survivalTimeSec: Math.round(info.survivalTimeSec),
      finalScore,
      xpEarned,
      transformedScore,
      transformedXp,
    };
    for (const listener of this.deathListeners) listener(playerId, death);
  }
}
