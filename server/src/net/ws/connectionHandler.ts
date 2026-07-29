import type { IncomingMessage } from 'node:http';
import {
  colorForNickname,
  getRandomSkin,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_FULL,
  WS_CLOSE_ROOM_NOT_FOUND,
  type AdminClientActionMessage,
  type ClientMessage,
} from '@angulio/shared';
import type { WebSocket } from 'ws';
import type { AccountsService } from '../../accounts/service.js';
import type { AdminAuth } from '../../admin/adminAuth.js';
import type { RoomManager } from '../../engine/roomManager.js';
import type { PlayerId } from '../../engine/types.js';
import { logEvent } from '../../log.js';
import { getClientIp } from '../http/httpUtils.js';
import { RateLimiter } from '../rateLimiter.js';
import { recordAccountStatsOnLeave, send, type RoomRuntime } from './broadcast.js';

const MAX_NICKNAME_LENGTH = 20;
/** Plafond de connexions `?spectate=1` par salon (fond animé de l'accueil,
 * SpectatorBackground.tsx) — filet de sécurité pendant que la régulation de cadence/densité
 * (SPECTATOR_TICK_DIVISOR/SPECTATOR_FOOD_SAMPLE_EVERY, voir snapshotBuilder.ts) absorbe la charge
 * normale : au-delà, un visiteur d'accueil supplémentaire n'apporte rien (personne ne joue) et ne
 * doit plus pouvoir dégrader la bande passante des salons réellement joués. Voir
 * plan_performance_reseau.md §4.1/Phase 0.4. */
const MAX_SPECTATORS_PER_ROOM = 60;
/** Code de fermeture WebSocket applicatif "trop de spectateurs" — RFC 6455 1013 ("Try Again
 * Later") : le client (fond décoratif, pas une session de jeu) n'a rien de spécifique à faire de
 * ce code, contrairement aux codes 4xxx dédiés au joueur (voir WS_CLOSE_* de `@angulio/shared`). */
const WS_CLOSE_TOO_MANY_SPECTATORS = 1013;
/** Code de fermeture WebSocket applicatif pour un token admin absent/invalide sur `?admin=1` —
 * plage privée 4000-4999 (RFC 6455), comme les codes joueur de `@angulio/shared`, mais réservé au
 * canal admin (jamais transmis à un client joueur, pas de constante partagée nécessaire). */
const WS_CLOSE_ADMIN_UNAUTHORIZED = 4401;

export function handleWsConnection(
  socket: WebSocket,
  request: IncomingMessage,
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  accounts: AccountsService | undefined,
  wsRateLimiter: RateLimiter,
  admin: AdminAuth | undefined,
): void {
  const requestUrl = new URL(request.url ?? '/', 'http://localhost');
  const isAdmin = requestUrl.searchParams.get('admin') === '1';
  const isSpectator = requestUrl.searchParams.get('spectate') === '1';

  if (!isSpectator && !isAdmin) {
    const clientIp = getClientIp(request);
    if (!wsRateLimiter.consume(clientIp)) {
      logEvent('ws_rate_limited', { ip: clientIp });
      socket.close(1008, 'Trop de connexions WebSocket. Réessayez dans une minute.');
      return;
    }
  }
  const roomId = requestUrl.searchParams.get('roomId');
  const managed = roomId ? roomManager.getManagedRoom(roomId) : undefined;
  if (!managed) {
    logEvent('join_rejected', { requestedRoomId: roomId });
    socket.close(WS_CLOSE_ROOM_NOT_FOUND, 'Salon introuvable');
    return;
  }

  const runtime = runtimes.get(managed.id)!;

  // Canal admin dédié (`?admin=1&token=…`, cahier_des_charges_admin.md §4-§5.2) : "Salons &
  // Écrans" (POV) et Espace Créatif — authentifié par le même token Bearer que l'API REST admin
  // (voir AdminAuth), diffusé comme un spectateur (toutes les entités, jamais de Blob propre —
  // §4.2 "invisibilité absolue") mais avec en plus la possibilité d'envoyer des actions
  // (`admin_action`, voir RoomHandle.adminAction).
  if (isAdmin) {
    const token = requestUrl.searchParams.get('token') ?? undefined;
    if (!admin?.isAuthenticated(token)) {
      logEvent('admin_ws_rejected', { roomId: managed.id });
      socket.close(WS_CLOSE_ADMIN_UNAUTHORIZED, 'Non authentifié (admin).');
      return;
    }

    const adminViewerId = `admin-view-${runtime.nextPlayerId++}`;
    runtime.sockets.set(adminViewerId, socket);
    runtime.spectatorIds.add(adminViewerId);
    managed.handle.connectViewer(adminViewerId, true);
    logEvent('admin_ws_join', { roomId: managed.id, adminViewerId });
    send(socket, {
      type: 'welcome',
      playerId: adminViewerId,
      mapSize: managed.handle.mapSize,
      tickRateHz: roomManager.tickRateHz,
      movement: managed.handle.movement,
    });

    socket.on('message', (raw: Buffer): void => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (
        !parsed ||
        typeof parsed !== 'object' ||
        (parsed as { type?: unknown }).type !== 'admin_action'
      ) {
        return;
      }
      const message = parsed as AdminClientActionMessage;
      void managed.handle.adminAction(message.action).then((result) => {
        if (socket.readyState === socket.OPEN) {
          socket.send(
            JSON.stringify({ type: 'admin_action_result', actionId: message.actionId, result }),
          );
        }
      });
    });

    socket.on('close', () => {
      runtime.sockets.delete(adminViewerId);
      runtime.spectatorIds.delete(adminViewerId);
      managed.handle.disconnectViewer(adminViewerId);
    });
    return;
  }

  // Mode spectateur (`?spectate=1`)
  if (requestUrl.searchParams.get('spectate') === '1') {
    if (runtime.spectatorIds.size >= MAX_SPECTATORS_PER_ROOM) {
      logEvent('spectator_rejected', { roomId: managed.id, reason: 'too_many_spectators' });
      socket.close(WS_CLOSE_TOO_MANY_SPECTATORS, 'Trop de spectateurs sur ce salon.');
      return;
    }
    const spectatorId = `spec-${runtime.nextPlayerId++}`;
    runtime.sockets.set(spectatorId, socket);
    runtime.spectatorIds.add(spectatorId);
    managed.handle.connectViewer(spectatorId, true);
    logEvent('spectator_join', { roomId: managed.id, spectatorId });
    send(socket, {
      type: 'welcome',
      playerId: spectatorId,
      mapSize: managed.handle.mapSize,
      tickRateHz: roomManager.tickRateHz,
      movement: managed.handle.movement,
      modId: managed.modId,
    });
    socket.on('close', () => {
      runtime.sockets.delete(spectatorId);
      runtime.spectatorIds.delete(spectatorId);
      managed.handle.disconnectViewer(spectatorId);
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
        // Premier Join sur cette connexion — décisions (plafond de joueurs humains, éviction de
        // bot, pseudo déjà pris) désormais prises atomiquement par `RoomHandle.join` (voir
        // RoomInstance.join, engine/worker/) plutôt qu'ici : pour un salon hébergé par un worker,
        // deux joins concurrents traités par ce même thread ne doivent jamais tous les deux
        // passer la vérification "salon plein" avant qu'aucun des deux n'ait encore ajouté son
        // joueur (TOCTOU) — un seul appel atomique élimine ce risque par construction.
        //
        // Avatar procédural (refonte UI/UX) : couleur choisie par le compte, sinon dérivée du
        // pseudo pour un invité — résolue avant le join (coût d'une requête DB inutile en cas de
        // refus, accepté : rare, et la résolution doit de toute façon précéder l'ajout au monde).
        const avatarColor =
          (accountId !== undefined ? await accounts?.getAvatarColor(accountId) : undefined) ??
          getRandomSkin();

        const result = await managed.handle.join(nickname, avatarColor);
        if (!result.ok) {
          if (result.reason === 'room_full') {
            logEvent('join_rejected', { roomId: managed.id, reason: 'room_full' });
            socket.close(WS_CLOSE_ROOM_FULL, 'Salon complet.');
          } else {
            logEvent('join_rejected', { roomId: managed.id, reason: 'nickname_taken', nickname });
            socket.close(WS_CLOSE_NICKNAME_TAKEN, 'Pseudo déjà utilisé sur ce salon.');
          }
          return;
        }

        playerId = result.playerId;
        runtime.sockets.set(playerId, socket);
        managed.handle.connectViewer(playerId, false);
        if (accountId !== undefined) {
          runtime.accountIdByPlayer.set(playerId, accountId);
          runtime.joinedAtByPlayer.set(playerId, Date.now());
          void accounts?.recordLogin(accountId, getClientIp(request));
        }
        // Mémorisée ici en plus de `RoomHandle.onPlayerJoin` (broadcast.ts) : ce dernier ne fait
        // que rediffuser aux AUTRES sockets déjà connectées, jamais au nouvel arrivant
        // lui-même — le backfill ci-dessous (couleur des joueurs déjà présents) a besoin de la
        // sienne propre disponible immédiatement, sans dépendre de l'ordre d'arrivée de
        // l'événement `onPlayerJoin` correspondant.
        runtime.colorByPlayer.set(playerId, avatarColor);
        logEvent('player_join', { roomId: managed.id, playerId, nickname });
        send(socket, {
          type: 'welcome',
          playerId,
          mapSize: managed.handle.mapSize,
          tickRateHz: roomManager.tickRateHz,
          movement: managed.handle.movement,
          modId: managed.modId,
        });

        for (const existingPlayer of result.existingPlayers) {
          let existingColor = runtime.colorByPlayer.get(existingPlayer.id);
          if (!existingColor) {
            existingColor = getRandomSkin();
            runtime.colorByPlayer.set(existingPlayer.id, existingColor);
          }
          send(socket, {
            type: 'player',
            playerId: existingPlayer.id,
            nickname: existingPlayer.nickname,
            color: existingColor,
          });
        }
        // Le nouvel arrivant lui-même : `RoomHandle.onPlayerJoin` (broadcast.ts) a déjà diffusé
        // cette info à toutes les AUTRES sockets déjà connectées au moment où `join()` a muté le
        // salon — mais la sienne propre n'était pas encore dans `runtime.sockets` à cet instant
        // (voir `runtime.sockets.set` ci-dessus, après la résolution du join), donc jamais
        // atteinte par cette diffusion. Envoyé explicitement ici pour couvrir ce cas.
        send(socket, { type: 'player', playerId, nickname, color: avatarColor });
      } else {
        // Re-Join (Respawn)
        const result = await managed.handle.respawn(playerId, nickname);
        if (result.respawned) {
          logEvent('player_respawn', { roomId: managed.id, playerId, nickname });
          send(socket, {
            type: 'welcome',
            playerId,
            mapSize: managed.handle.mapSize,
            tickRateHz: roomManager.tickRateHz,
            movement: managed.handle.movement,
          });
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
      managed.handle.input(playerId, validatedInput);
      return;
    }

    if (message.type === 'ping') {
      send(socket, { type: 'pong', t: message.t });
      return;
    }

    if (message.type === 'latency' && playerId) {
      const ms = Number(message.ms);
      if (Number.isFinite(ms) && ms >= 0) runtime.latencyByPlayer.set(playerId, ms);
    }
  };

  socket.on('close', () => {
    if (!playerId) return;
    const leavingPlayerId = playerId;
    logEvent('player_leave', { roomId: managed.id, playerId: leavingPlayerId });

    // Capturé avant nettoyage de `runtime` ci-dessous : `leave()` est asynchrone (round-trip
    // possible vers un worker, voir WorkerRoomHost), la callback qui écrit en base ne doit pas
    // lire `accountIdByPlayer` après sa suppression, sans quoi le compte ne serait jamais
    // crédité (l'id de compte serait déjà introuvable au moment de l'écriture).
    const accountId = runtime.accountIdByPlayer.get(leavingPlayerId);
    const joinedAt = runtime.joinedAtByPlayer.get(leavingPlayerId);
    if (accountId !== undefined && joinedAt !== undefined) {
      void accounts?.addPlaytime(accountId, (Date.now() - joinedAt) / 1000);
    }

    managed.handle.disconnectViewer(leavingPlayerId);
    runtime.sockets.delete(leavingPlayerId);
    runtime.accountIdByPlayer.delete(leavingPlayerId);
    runtime.colorByPlayer.delete(leavingPlayerId);
    runtime.joinedAtByPlayer.delete(leavingPlayerId);
    runtime.latencyByPlayer.delete(leavingPlayerId);
    runtime.nicknameByPlayer.delete(leavingPlayerId);
    runtime.stateSkipStreakByPlayer.delete(leavingPlayerId);

    void (async () => {
      const result = await managed.handle.leave(leavingPlayerId);
      recordAccountStatsOnLeave(accounts, managed, accountId, leavingPlayerId, result);
    })();
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
      dash?: boolean;
    }
  | undefined {
  if (!message.target || typeof message.target !== 'object') return undefined;

  const targetX = Number(message.target.x);
  const targetY = Number(message.target.y);
  if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return undefined;

  const rawIntensity = Number(message.intensity);
  const intensity = Number.isFinite(rawIntensity) ? Math.min(1.0, Math.max(0.0, rawIntensity)) : 0;

  const split = Boolean(message.split);
  const dash = message.dash ? true : undefined;

  return {
    target: { x: targetX, y: targetY },
    intensity,
    split,
    ...(dash ? { dash } : {}),
  };
}
