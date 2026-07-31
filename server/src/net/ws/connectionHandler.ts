import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import {
  getRandomSkin,
  isValidSkin,
  skinForNickname,
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
import { SPECTATOR_TICK_DIVISOR } from '../../engine/worker/snapshotBuilder.js';
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
/** Délai de grâce (ms) avant qu'une déconnexion ne devienne définitive (voir `pendingLeaves`,
 * broadcast.ts) — correctif "déconnexion = perte immédiate de la vie/XP en cours" (retour
 * utilisateur) : une micro-coupure Wi-Fi/4G, ou l'App Nap de Safari/macOS qui suspend un onglet en
 * arrière-plan, ne doit pas coûter la vie en cours si le joueur revient vite. Volontairement court
 * (le joueur reste un blob IMMOBILE mais toujours mangeable pendant ce délai, voir `Room.setFrozen`
 * via l'action admin 'freeze' réutilisée ici) : ni trop court (raterait une vraie micro-coupure),
 * ni trop long (un abandon volontaire resterait visible trop longtemps comme un blob figé). */
const DEFAULT_GRACE_PERIOD_MS = 8000;

export function handleWsConnection(
  socket: WebSocket,
  request: IncomingMessage,
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  accounts: AccountsService | undefined,
  wsRateLimiter: RateLimiter,
  admin: AdminAuth | undefined,
  buildVersion: string,
  // Surchargeable pour les tests (délai de grâce court plutôt que d'attendre 8s dans une suite
  // vitest) — voir GameServerOptions.disconnectGraceMs, net/server.ts.
  disconnectGraceMs: number = DEFAULT_GRACE_PERIOD_MS,
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
      // Cadence RÉELLE d'envoi pour ce viewer (spectateur/admin, un tick sur SPECTATOR_TICK_DIVISOR
      // seulement, voir roomInstance.ts `shouldSendSpectatorTick`) — annoncer le tick rate de
      // SIMULATION brut ici faisait sous-dimensionner le buffer d'interpolation du client
      // (RenderEngine.getInterpolatedEntities), qui tombait alors bien plus souvent en
      // extrapolation que pour un vrai joueur (retour utilisateur : lag du fond spectateur/vue
      // admin).
      tickRateHz: roomManager.tickRateHz / SPECTATOR_TICK_DIVISOR,
      movement: managed.handle.movement,
      nextResetAtMs: roomManager.nextResetAtMsOf(managed),
      buildVersion,
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
      // Voir le commentaire équivalent de la branche admin ci-dessus — même correctif.
      tickRateHz: roomManager.tickRateHz / SPECTATOR_TICK_DIVISOR,
      movement: managed.handle.movement,
      modId: managed.modId,
      nextResetAtMs: roomManager.nextResetAtMsOf(managed),
      buildVersion,
    });
    for (const [pId, nickname] of runtime.nicknameByPlayer.entries()) {
      const color = runtime.colorByPlayer.get(pId) ?? skinForNickname(nickname);
      send(socket, {
        type: 'player',
        playerId: pId,
        nickname,
        color,
      });
    }
    socket.on('close', () => {
      runtime.sockets.delete(spectatorId);
      runtime.spectatorIds.delete(spectatorId);
      managed.handle.disconnectViewer(spectatorId);
    });
    return;
  }

  const accountId = accounts?.resolveToken(requestUrl.searchParams.get('token') ?? undefined);

  let playerId: PlayerId | undefined;

  /** Termine une vie DÉFINITIVEMENT (identique à une vraie mort côté crédit XP/score, voir
   * RoomInstance.leave) — factorisé pour être appelable soit à l'expiration naturelle du délai de
   * grâce (voir `close` plus bas), soit immédiatement si un NOUVEAU join réclame le même pseudo
   * pendant qu'un fantôme (ancienne connexion) est encore en grâce (voir la branche `join` plus
   * bas) : un pseudo ne doit jamais rester indisponible jusqu'à `disconnectGraceMs` pour quelqu'un
   * d'autre à cause d'une reconnexion qui, de toute façon, n'arrivera jamais avec ce pseudo précis
   * (elle utiliserait son propre `resumeToken`, pas un nouveau join "à vide"). */
  // Async (et non fire-and-forget en interne) : le pré-contrôle "fantôme" de la branche `join`
  // ci-dessous a besoin d'ATTENDRE que `managed.handle.leave` ait réellement retiré le joueur du
  // monde avant de poursuivre son propre `join` — sans ça, le nouveau join pourrait encore trouver
  // l'ancien joueur "présent" (retrait pas encore effectif) et le rejeter à tort comme pseudo pris.
  // Le handler `close` (fire-and-forget, `void finalizeLeave(...)`) n'a pas besoin d'attendre.
  const finalizeLeave = async (pId: PlayerId): Promise<void> => {
    logEvent('player_leave', { roomId: managed.id, playerId: pId });

    const leavingAccountId = runtime.accountIdByPlayer.get(pId);
    const joinedAt = runtime.joinedAtByPlayer.get(pId);
    if (leavingAccountId !== undefined && joinedAt !== undefined) {
      void accounts?.addPlaytime(leavingAccountId, (Date.now() - joinedAt) / 1000);
    }

    runtime.accountIdByPlayer.delete(pId);
    runtime.colorByPlayer.delete(pId);
    runtime.joinedAtByPlayer.delete(pId);
    runtime.latencyByPlayer.delete(pId);
    runtime.nicknameByPlayer.delete(pId);
    runtime.resumeTokenByPlayer.delete(pId);

    const result = await managed.handle.leave(pId);
    recordAccountStatsOnLeave(accounts, managed, leavingAccountId, pId, result);
  };

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
      // Filet de sécurité serveur (le client, voir App.tsx, envoie déjà un suffixe aléatoire pour
      // un pseudo laissé vide) : un "Joueur" fixe pour tout le monde ferait rejeter en boucle tout
      // second client anonyme sur le même salon (deux pseudos identiques dans un même salon sont
      // refusés, voir WS_CLOSE_NICKNAME_TAKEN plus bas).
      const trimmedNickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH);
      const nickname =
        trimmedNickname || `Joueur ${Math.floor(Math.random() * 1000).toString().padStart(3, '0')}`;

      if (!playerId) {
        // Reconnexion transitoire reconnue (voir GRACE_PERIOD_MS/pendingLeaves, broadcast.ts) :
        // reprend la vie EN COURS (même playerId, même masse — jamais retirée du monde, juste
        // gelée le temps de la grâce) plutôt que d'en créer une nouvelle. Un jeton absent/inconnu/
        // expiré retombe silencieusement sur un join normal ci-dessous (comportement historique).
        const resumeToken =
          typeof message.resumeToken === 'string' ? message.resumeToken : undefined;
        const pending = resumeToken ? runtime.pendingLeaves.get(resumeToken) : undefined;

        if (pending) {
          clearTimeout(pending.timer);
          // `resumeToken` est forcément défini ici : `pending` ne peut être truthy que si l'appel
          // `runtime.pendingLeaves.get(resumeToken)` ci-dessus l'a été avec un `resumeToken`
          // défini (TypeScript ne relie pas cette implication à travers la variable `pending`).
          runtime.pendingLeaves.delete(resumeToken!);

          playerId = pending.playerId;
          runtime.sockets.set(playerId, socket);
          managed.handle.connectViewer(playerId, false);
          void managed.handle.adminAction({ kind: 'unfreeze', playerId });

          const newResumeToken = randomUUID();
          runtime.resumeTokenByPlayer.set(playerId, newResumeToken);

          logEvent('player_resume', { roomId: managed.id, playerId });
          send(socket, {
            type: 'welcome',
            playerId,
            mapSize: managed.handle.mapSize,
            tickRateHz: roomManager.tickRateHz,
            movement: managed.handle.movement,
            modId: managed.modId,
            nextResetAtMs: roomManager.nextResetAtMsOf(managed),
            buildVersion,
            resumeToken: newResumeToken,
          });

          // Backfill identique au join normal ci-dessous : reconstruit les maps pseudo/couleur
          // côté client au cas où d'autres joueurs auraient rejoint/quitté pendant la grâce.
          for (const [pId, existingNickname] of runtime.nicknameByPlayer.entries()) {
            if (pId === playerId) continue;
            const existingColor = runtime.colorByPlayer.get(pId) ?? skinForNickname(existingNickname);
            send(socket, { type: 'player', playerId: pId, nickname: existingNickname, color: existingColor });
          }
          const ownNickname = runtime.nicknameByPlayer.get(playerId) ?? nickname;
          const ownColor = runtime.colorByPlayer.get(playerId) ?? skinForNickname(ownNickname);
          send(socket, { type: 'player', playerId, nickname: ownNickname, color: ownColor });
          return;
        }

        // Un fantôme en délai de grâce (voir `pendingLeaves`/close ci-dessous) qui détient déjà CE
        // pseudo ne doit jamais bloquer un NOUVEAU join (pas une reprise : celle-ci a déjà été
        // traitée ci-dessus via `resumeToken`) jusqu'à l'expiration de `disconnectGraceMs` — une
        // vraie reconnexion sans jeton (nouvel onglet, ou double montage React StrictMode en dev)
        // doit pouvoir reprendre IMMÉDIATEMENT ce pseudo plutôt que se voir opposer un "pseudo déjà
        // utilisé" par un fantôme qui, de toute façon, ne reviendra jamais avec ce même pseudo sans
        // son propre `resumeToken`. Termine ce fantôme sur-le-champ avant de tenter le join normal.
        for (const [ghostToken, pending] of runtime.pendingLeaves.entries()) {
          const ghostNickname = runtime.nicknameByPlayer.get(pending.playerId);
          if (ghostNickname && ghostNickname.toLowerCase() === nickname.toLowerCase()) {
            clearTimeout(pending.timer);
            runtime.pendingLeaves.delete(ghostToken);
            await finalizeLeave(pending.playerId);
          }
        }

        // Premier Join sur cette connexion — décisions (plafond de joueurs humains, éviction de
        // bot, pseudo déjà pris) désormais prises atomiquement par `RoomHandle.join` (voir
        // RoomInstance.join, engine/worker/) plutôt qu'ici : pour un salon hébergé par un worker,
        // deux joins concurrents traités par ce même thread ne doivent jamais tous les deux
        // passer la vérification "salon plein" avant qu'aucun des deux n'ait encore ajouté son
        // joueur (TOCTOU) — un seul appel atomique élimine ce risque par construction.
        //
        // Avatar procédural (refonte UI/UX) : couleur choisie par le compte (source de vérité,
        // toujours prioritaire), sinon le skin explicitement choisi par un invité et envoyé dans ce
        // `join` (`message.skin`, voir ClientJoinMessage/ProfilePage.tsx — auparavant absent du
        // protocole : un invité se voyait réassigner un skin ALÉATOIRE à chaque connexion, ignorant
        // son choix), sinon un skin aléatoire en dernier recours — résolue avant le join (coût
        // d'une requête DB inutile en cas de refus, accepté : rare, et la résolution doit de toute
        // façon précéder l'ajout au monde).
        const requestedSkin =
          typeof message.skin === 'string' && isValidSkin(message.skin) ? message.skin : undefined;
        const avatarColor =
          (accountId !== undefined ? await accounts?.getAvatarColor(accountId) : undefined) ??
          requestedSkin ??
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
        const newResumeToken = randomUUID();
        runtime.resumeTokenByPlayer.set(playerId, newResumeToken);
        logEvent('player_join', { roomId: managed.id, playerId, nickname });
        send(socket, {
          type: 'welcome',
          playerId,
          mapSize: managed.handle.mapSize,
          tickRateHz: roomManager.tickRateHz,
          movement: managed.handle.movement,
          modId: managed.modId,
          nextResetAtMs: roomManager.nextResetAtMsOf(managed),
          buildVersion,
          resumeToken: newResumeToken,
        });

        for (const existingPlayer of result.existingPlayers) {
          const existingColor =
            existingPlayer.skin ??
            runtime.colorByPlayer.get(existingPlayer.id) ??
            skinForNickname(existingPlayer.nickname);
          runtime.colorByPlayer.set(existingPlayer.id, existingColor);
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
            // Absent ici jusqu'à ce correctif (contrairement au `welcome` du join initial,
            // ci-dessus) : le client sélectionne la musique du mode à partir de CE champ (voir
            // GameView.tsx, `message.modId === 'hardcore'`) — son absence faisait toujours
            // retomber sur la musique Vanilla après un respawn, y compris en salon Hardcore.
            modId: managed.modId,
            nextResetAtMs: roomManager.nextResetAtMsOf(managed),
            buildVersion,
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

    // La socket est bel et bien partie : on arrête tout de suite de lui envoyer des ticks et on
    // oublie son historique de dégradation réseau (`admitStateFrame`) — mais PAS le reste
    // (compte/couleur/pseudo/jeton), gardé le temps du délai de grâce pour une éventuelle reprise.
    managed.handle.disconnectViewer(leavingPlayerId);
    runtime.sockets.delete(leavingPlayerId);
    runtime.stateSkipStreakByPlayer.delete(leavingPlayerId);

    // Délai de grâce (voir GRACE_PERIOD_MS) : le joueur reste dans le monde, gelé (toujours
    // mangeable, immobile) plutôt que retiré instantanément — correctif "déconnexion = perte
    // immédiate de la vie/XP en cours" (retour utilisateur), une simple micro-coupure réseau ne
    // doit plus coûter la vie si le joueur revient dans les temps (voir plus haut, branche
    // `pending` du traitement de `join`).
    const resumeToken = runtime.resumeTokenByPlayer.get(leavingPlayerId);
    if (!resumeToken) {
      // Ne devrait plus arriver (un jeton est toujours assigné au join/à la reprise, voir plus
      // haut) — filet de sécurité : sans jeton à présenter au retour, pas de délai de grâce
      // possible, on retombe sur le comportement historique (leave immédiat).
      void finalizeLeave(leavingPlayerId);
      return;
    }

    void managed.handle.adminAction({ kind: 'freeze', playerId: leavingPlayerId });
    const timer = setTimeout(() => {
      runtime.pendingLeaves.delete(resumeToken);
      void finalizeLeave(leavingPlayerId);
    }, disconnectGraceMs);
    runtime.pendingLeaves.set(resumeToken, { playerId: leavingPlayerId, timer });
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
      eject?: boolean;
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
  const eject = message.eject ? true : undefined;

  return {
    target: { x: targetX, y: targetY },
    intensity,
    split,
    ...(dash ? { dash } : {}),
    ...(eject ? { eject } : {}),
  };
}
