import type { IncomingMessage } from 'node:http';
import {
  colorForNickname,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_FULL,
  WS_CLOSE_ROOM_NOT_FOUND,
  type ClientMessage,
} from '@angulio/shared';
import type { WebSocket } from 'ws';
import type { AccountsService } from '../../accounts/service.js';
import type { RoomManager } from '../../engine/roomManager.js';
import type { PlayerId } from '../../engine/types.js';
import { logEvent } from '../../log.js';
import { getClientIp } from '../http/httpUtils.js';
import { RateLimiter } from '../rateLimiter.js';
import { recordAccountStats, send, type RoomRuntime } from './broadcast.js';

const MAX_NICKNAME_LENGTH = 20;

export function handleWsConnection(
  socket: WebSocket,
  request: IncomingMessage,
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  accounts: AccountsService | undefined,
  wsRateLimiter: RateLimiter,
): void {
  const clientIp = getClientIp(request);
  if (!wsRateLimiter.consume(clientIp)) {
    logEvent('ws_rate_limited', { ip: clientIp });
    socket.close(1008, 'Trop de connexions WebSocket. Réessayez dans une minute.');
    return;
  }

  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const roomId = requestUrl.searchParams.get('roomId');
  const managed = roomId ? roomManager.getManagedRoom(roomId) : undefined;
  if (!managed) {
    logEvent('join_rejected', { requestedRoomId: roomId });
    socket.close(WS_CLOSE_ROOM_NOT_FOUND, 'Salon introuvable');
    return;
  }

  const runtime = runtimes.get(managed.id)!;

  // Mode spectateur (`?spectate=1`)
  if (requestUrl.searchParams.get('spectate') === '1') {
    const spectatorId = `spec-${runtime.nextPlayerId++}`;
    runtime.sockets.set(spectatorId, socket);
    runtime.spectatorIds.add(spectatorId);
    logEvent('spectator_join', { roomId: managed.id, spectatorId });
    send(socket, {
      type: 'welcome',
      playerId: spectatorId,
      mapSize: managed.room.world.mapSize,
    });
    socket.on('close', () => {
      runtime.sockets.delete(spectatorId);
      runtime.spectatorIds.delete(spectatorId);
    });
    return;
  }

  const accountId = accounts?.resolveToken(requestUrl.searchParams.get('token') ?? undefined);

  let playerId: PlayerId | undefined;

  socket.on('message', (raw: Buffer): void => {
    void handleMessage(raw);
  });

  // Fonction fléchée assignée (pas une déclaration hoistée) : nécessaire pour que TypeScript
  // conserve le rétrécissement de type de `managed` (non-`undefined`, vérifié plus haut) à
  // l'intérieur — une déclaration `function` classique perd ce rétrécissement (elle pourrait en
  // théorie être appelée avant, via hoisting).
  const handleMessage = async (raw: Buffer): Promise<void> => {
    const message = parseClientMessage(raw);
    if (!message) {
      logEvent('malformed_message', { roomId: managed.id, playerId });
      return;
    }

    if (message.type === 'join') {
      const nickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || 'Joueur';

      if (!playerId) {
        // Premier Join sur cette connexion
        const humanCount = Array.from(managed.room.world.allPlayers()).filter(
          (p) => !managed.room.botManager?.isBot(p.id),
        ).length;

        if (humanCount >= managed.maxPlayers) {
          logEvent('join_rejected', { roomId: managed.id, reason: 'room_full' });
          socket.close(WS_CLOSE_ROOM_FULL, 'Salon complet.');
          return;
        }

        // Libérer la place d'un bot si le salon est plein
        while (managed.room.world.allPlayers().length >= managed.maxPlayers) {
          if (managed.room.botManager && managed.room.botManager.activeBotCount > 0) {
            managed.room.botManager.removeSmallestBot();
          } else {
            break;
          }
        }

        const nicknameTaken = managed.room.world
          .allPlayers()
          .some((player) => player.nickname.toLowerCase() === nickname.toLowerCase());
        if (nicknameTaken) {
          logEvent('join_rejected', { roomId: managed.id, reason: 'nickname_taken', nickname });
          socket.close(WS_CLOSE_NICKNAME_TAKEN, 'Pseudo déjà utilisé sur ce salon.');
          return;
        }

        playerId = String(runtime.nextPlayerId++);
        runtime.sockets.set(playerId, socket);
        if (accountId !== undefined) {
          runtime.accountIdByPlayer.set(playerId, accountId);
          runtime.maxMassByPlayer.set(playerId, 0);
        }
        // Avatar procédural (refonte UI/UX) : couleur choisie par le compte, sinon dérivée du
        // pseudo pour un invité — résolue une fois ici et mémorisée (`colorByPlayer`) pour
        // pouvoir la rediffuser aux prochains arrivants.
        const avatarColor =
          (accountId !== undefined ? await accounts?.getAvatarColor(accountId) : undefined) ??
          colorForNickname(nickname);
        runtime.colorByPlayer.set(playerId, avatarColor);
        managed.room.addPlayer(playerId, nickname);
        logEvent('player_join', { roomId: managed.id, playerId, nickname });
        send(socket, { type: 'welcome', playerId, mapSize: managed.room.world.mapSize });

        for (const existingPlayer of managed.room.world.allPlayers()) {
          if (existingPlayer.id === playerId) continue;
          send(socket, {
            type: 'player',
            playerId: existingPlayer.id,
            nickname: existingPlayer.nickname,
            color: runtime.colorByPlayer.get(existingPlayer.id),
          });
        }
        const playerInfo = { type: 'player' as const, playerId, nickname, color: avatarColor };
        for (const s of runtime.sockets.values()) send(s, playerInfo);
      } else {
        // Re-Join (Respawn)
        const existingPlayer = managed.room.world.getPlayer(playerId);
        if (!existingPlayer || existingPlayer.pieceIds.length === 0) {
          managed.room.addPlayer(playerId, nickname);
          logEvent('player_respawn', { roomId: managed.id, playerId, nickname });
          send(socket, { type: 'welcome', playerId, mapSize: managed.room.world.mapSize });
        }
      }
      return;
    }

    if (message.type === 'input' && playerId) {
      const validatedInput = validateInputMessage(message);
      if (!validatedInput) {
        logEvent('invalid_input_message', { roomId: managed.id, playerId });
        return;
      }

      if (validatedInput.split)
        logEvent('player_split_requested', { roomId: managed.id, playerId });
      managed.room.handleInput(playerId, validatedInput);
      return;
    }

    if (message.type === 'ping') {
      send(socket, { type: 'pong', t: message.t });
    }
  };

  socket.on('close', () => {
    if (!playerId) return;
    logEvent('player_leave', { roomId: managed.id, playerId });
    recordAccountStats(accounts, managed, runtime, playerId);
    managed.room.removePlayer(playerId);
    runtime.sockets.delete(playerId);
    runtime.accountIdByPlayer.delete(playerId);
    runtime.maxMassByPlayer.delete(playerId);
    runtime.colorByPlayer.delete(playerId);
  });
}

function parseClientMessage(raw: Buffer): ClientMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as ClientMessage;
    }
  } catch {
    // message malformé ignoré silencieusement
  }
  return undefined;
}

/**
 * Validation stricte et sécurisée des messages input pour éviter le speed-hack ou l'injection de NaN.
 */
function validateInputMessage(message: ClientMessage & { type: 'input' }):
  | {
      target: { x: number; y: number };
      intensity: number;
      split: boolean;
    }
  | undefined {
  if (!message.target || typeof message.target !== 'object') return undefined;

  const targetX = Number(message.target.x);
  const targetY = Number(message.target.y);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return undefined;

  const rawIntensity = Number(message.intensity);
  const intensity = Number.isFinite(rawIntensity) ? Math.min(1.0, Math.max(0.0, rawIntensity)) : 0;

  const split = Boolean(message.split);

  return {
    target: { x: targetX, y: targetY },
    intensity,
    split,
  };
}
