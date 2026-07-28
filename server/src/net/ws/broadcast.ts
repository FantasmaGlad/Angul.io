import {
  distance,
  type EntitySnapshot,
  type LeaderboardEntry,
  type ServerMessage,
} from '@angulio/shared';
import type { WebSocket } from 'ws';
import type { AccountsService } from '../../accounts/service.js';
import type { ManagedRoom } from '../../engine/roomManager.js';
import { SpatialHash } from '../../engine/spatialHash.js';
import type { Entity, PlayerId } from '../../engine/types.js';
import { activeComboLevel } from '../../engine/xp.js';
import { logEvent } from '../../log.js';

export interface RoomRuntime {
  sockets: Map<PlayerId, WebSocket>;
  interestHash: SpatialHash;
  nextPlayerId: number;
  accountIdByPlayer: Map<PlayerId, number>;
  maxMassByPlayer: Map<PlayerId, number>;
  spectatorIds: Set<PlayerId>;
  /** Couleur de blob par joueur (refonte UI/UX, avatar procédural) — résolue une fois au join
   * (compte ou repli déterministe sur le pseudo, voir connectionHandler.ts) et mémorisée ici
   * pour pouvoir la rediffuser aux nouveaux arrivants (backfill `player`, comme `nickname`). */
  colorByPlayer: Map<PlayerId, string>;
}

export function wireRoom(
  managed: ManagedRoom,
  interestRadiusPx: number,
  accountsService: AccountsService | undefined,
  runtimes: Map<string, RoomRuntime>,
): RoomRuntime {
  const runtime: RoomRuntime = {
    sockets: new Map(),
    interestHash: new SpatialHash(interestRadiusPx),
    nextPlayerId: 1,
    accountIdByPlayer: new Map(),
    maxMassByPlayer: new Map(),
    spectatorIds: new Set(),
    colorByPlayer: new Map(),
  };
  runtimes.set(managed.id, runtime);

  managed.room.onState((tick) => {
    if (runtime.sockets.size === 0) return;

    runtime.interestHash.clear();
    for (const entity of managed.room.world.allEntities()) runtime.interestHash.insert(entity);

    for (const [playerId, socket] of runtime.sockets) {
      const ownPieces = managed.room.world.getPiecesByOwner(playerId);
      const center = centroidOf(ownPieces) ?? {
        x: managed.room.world.mapSize / 2,
        y: managed.room.world.mapSize / 2,
      };

      const visible = new Map<string, Entity>();
      for (const piece of ownPieces) visible.set(piece.id, piece);

      if (runtime.spectatorIds.has(playerId)) {
        for (const entity of managed.room.world.allEntities()) {
          visible.set(entity.id, entity);
        }
      } else {
        for (const id of runtime.interestHash.queryNearby(center)) {
          const entity = managed.room.world.getEntity(id);
          if (entity && distance(entity.position, center) <= interestRadiusPx) {
            visible.set(entity.id, entity);
          }
        }
      }

      const entities: EntitySnapshot[] = [...visible.values()].map(toSnapshot);

      const totalMass = ownPieces.reduce((sum, piece) => sum + piece.mass, 0);
      const accelerationPerSec2 =
        totalMass > 0 ? managed.room.getAccelerationForMass(totalMass) : undefined;

      const player = managed.room.world.getPlayer(playerId);
      const comboLevel = player
        ? activeComboLevel(player.lifeStats.combo, performance.now())
        : undefined;

      const selfFields: { accelerationPerSec2?: number; combo?: { level: number } } = {};
      if (accelerationPerSec2 !== undefined) selfFields.accelerationPerSec2 = accelerationPerSec2;
      if (comboLevel !== undefined) selfFields.combo = { level: comboLevel };
      const self = Object.keys(selfFields).length > 0 ? selfFields : undefined;

      const allPlayersList = Array.from(managed.room.world.allPlayers());
      const playerScores = allPlayersList
        .map((p) => {
          let score = 0;
          for (const pieceId of p.pieceIds) {
            const piece = managed.room.world.getEntity(pieceId);
            if (piece) score += piece.mass;
          }
          return { id: p.id, nickname: p.nickname, score: Math.floor(score) };
        })
        .filter((p) => p.score > 0)
        .sort((a, b) => b.score - a.score);

      const leaderboard: LeaderboardEntry[] = playerScores.slice(0, 10).map((entry, idx) => ({
        rank: idx + 1,
        nickname: entry.nickname,
        score: entry.score,
        isSelf: entry.id === playerId,
      }));

      send(socket, { type: 'state', tick, entities, leaderboard, self });

      if (runtime.accountIdByPlayer.has(playerId)) {
        const previousMax = runtime.maxMassByPlayer.get(playerId) ?? 0;
        if (totalMass > previousMax) runtime.maxMassByPlayer.set(playerId, totalMass);
      }
    }
  });

  managed.room.onPlayerDeath((playerId) => {
    logEvent('player_died', { roomId: managed.id, playerId });
    recordAccountStats(accountsService, managed, runtime, playerId);
    if (runtime.accountIdByPlayer.has(playerId)) runtime.maxMassByPlayer.set(playerId, 0);
    const socket = runtime.sockets.get(playerId);
    if (socket) send(socket, { type: 'died' });
  });

  managed.room.onReset(() => {
    logEvent('room_reset', { roomId: managed.id });
    for (const socket of runtime.sockets.values()) send(socket, { type: 'died' });
  });

  return runtime;
}

export function recordAccountStats(
  accounts: AccountsService | undefined,
  managed: ManagedRoom,
  runtime: RoomRuntime,
  playerId: PlayerId,
): void {
  if (!accounts) return;
  const accountId = runtime.accountIdByPlayer.get(playerId);
  if (accountId === undefined) return;

  const rawScore = runtime.maxMassByPlayer.get(playerId) ?? 0;
  const player = managed.room.world.getPlayer(playerId);
  const rawXp = player?.lifeStats.xpEarned ?? 0;

  if (player) managed.room.world.resetLifeStats(playerId);

  const { score, xp } = managed.room.transformScoreForAccount(rawScore, rawXp);
  if (score <= 0 && xp <= 0) return;

  accounts.recordGameResult(accountId, managed.modId, score, xp).catch((error: unknown) => {
    logEvent('account_stats_write_failed', {
      roomId: managed.id,
      playerId,
      reason: (error as Error).message,
    });
  });
}

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

function centroidOf(pieces: Entity[]): { x: number; y: number } | undefined {
  if (pieces.length === 0) return undefined;

  let totalMass = 0;
  let x = 0;
  let y = 0;
  for (const piece of pieces) {
    totalMass += piece.mass;
    x += piece.position.x * piece.mass;
    y += piece.position.y * piece.mass;
  }
  return { x: x / totalMass, y: y / totalMass };
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function roundMass(value: number): number {
  return Math.round(value);
}

function toSnapshot(entity: Entity): EntitySnapshot {
  return {
    i: entity.id,
    k: entity.kind === 'particle' ? 'f' : 'c',
    x: round1(entity.position.x),
    y: round1(entity.position.y),
    r: round1(entity.radius),
    m: roundMass(entity.mass),
    p: entity.ownerId,
  };
}
