import {
  BOT_KILL_MESSAGES,
  colorForNickname,
  DEFAULT_DEATH_BANNER_ID,
  DEFAULT_DEATH_MESSAGE,
  getRandomSkin,
  isBotId,
  type DeathCustomCard,
  type ServerMessage,
  type WorldStateMessage,
} from '@angulio/shared';
import type { WebSocket } from 'ws';
import type { AccountsService } from '../../accounts/service.js';
import type { ManagedRoom } from '../../engine/roomManager.js';
import type { PlayerId } from '../../engine/types.js';
import { logEvent } from '../../log.js';
import { botKillGifPath } from '../botKillGif.js';

const DEFAULT_CUSTOM_CARD: DeathCustomCard = {
  message: DEFAULT_DEATH_MESSAGE,
  bannerId: DEFAULT_DEATH_BANNER_ID,
};

export interface RoomRuntime {
  sockets: Map<PlayerId, WebSocket>;
  nextPlayerId: number;
  accountIdByPlayer: Map<PlayerId, number>;
  spectatorIds: Set<PlayerId>;
  /** Couleur de blob par joueur (refonte UI/UX, avatar procédural) — résolue une fois au join
   * (compte ou repli déterministe sur le pseudo, voir connectionHandler.ts/RoomHandle.onPlayerJoin)
   * et mémorisée ici pour pouvoir la rediffuser aux nouveaux arrivants (backfill `player`, comme
   * `nickname`). */
  colorByPlayer: Map<PlayerId, string>;
  /** Horodatage (`Date.now()`) du join d'un compte authentifié — sert à créditer
   * `total_playtime_sec` à la déconnexion (§3.1 cahier_des_charges_admin.md, voir
   * connectionHandler.ts). Absent pour un invité (rien à créditer, pas de ligne `players`). */
  joinedAtByPlayer: Map<PlayerId, number>;
  /** Dernière latence (ms, aller-retour) rapportée par le client (voir `ClientLatencyMessage`) —
   * affichée dans "Salons & Écrans" (§3.3), absente tant que le client n'a pas encore mesuré/
   * rapporté de valeur. */
  latencyByPlayer: Map<PlayerId, number>;
  /** Pseudo courant par joueur — nécessaire à la vue admin "Salons & Écrans" (§3.3), qui n'a pas
   * accès à `Room`/`World` pour un salon hébergé par un worker (voir `WorkerRoomHost`). */
  nicknameByPlayer: Map<PlayerId, string>;
  /** Compteur de ticks consécutifs passés en dégradation douce par joueur (voir
   * `admitStateFrame`) — sert uniquement à alterner "envoie/saute" un tick sur deux tant que la
   * socket reste encombrée ; absent d'un joueur = pas actuellement dégradé. */
  stateSkipStreakByPlayer: Map<PlayerId, number>;
}

/** Relaie les événements d'un salon (`RoomHandle`, voir engine/worker/roomHost.ts) vers les
 * sockets réseau — la simulation elle-même (tick, join/mort/reset, construction des messages
 * `state`) vit entièrement derrière `RoomHandle` (même process pour `LocalRoomHost`, thread
 * séparé pour `WorkerRoomHost`) : ce module ne connaît plus `Room`/`World` du tout, uniquement
 * les sockets et les données liées au compte (DB), qui doivent rester sur ce thread. */
export function wireRoom(
  managed: ManagedRoom,
  accountsService: AccountsService | undefined,
  runtimes: Map<string, RoomRuntime>,
): RoomRuntime {
  const runtime: RoomRuntime = {
    sockets: new Map(),
    nextPlayerId: 1,
    accountIdByPlayer: new Map(),
    spectatorIds: new Set(),
    colorByPlayer: new Map(),
    joinedAtByPlayer: new Map(),
    latencyByPlayer: new Map(),
    nicknameByPlayer: new Map(),
    stateSkipStreakByPlayer: new Map(),
  };
  runtimes.set(managed.id, runtime);

  managed.handle.onPlayerJoin(({ playerId, nickname, skin }) => {
    runtime.nicknameByPlayer.set(playerId, nickname);
    const assignedSkin =
      skin ?? (isBotId(playerId) ? getRandomSkin() : colorForNickname(nickname));
    runtime.colorByPlayer.set(playerId, assignedSkin);
    const playerInfo = { type: 'player' as const, playerId, nickname, color: assignedSkin };
    for (const socket of runtime.sockets.values()) send(socket, playerInfo);
  });

  let lastPeakMassSyncAt = Date.now();

  managed.handle.onTick((_tick, payloads) => {
    const now = Date.now();
    if (accountsService && now - lastPeakMassSyncAt >= 10000) {
      lastPeakMassSyncAt = now;
      for (const [pId, accountId] of runtime.accountIdByPlayer.entries()) {
        const peakMass = managed.handle.getPlayerMaxMass?.(pId);
        if (peakMass && peakMass > 0) {
          accountsService.recordBestMass(accountId, managed.modId, peakMass).catch(() => {});
        }
      }
    }

    let cachedSpectatorJson: string | undefined;
    // Partie JSON PARTAGÉE (`type`/`tick`/`entities`/`leaderboard`) du message `state` de CE
    // tick, identique pour tous les joueurs (pas les spectateurs, déjà couverts par
    // `cachedSpectatorJson` ci-dessus) — seul `self` diffère d'un joueur à l'autre (voir
    // `buildStateMessage`, snapshotBuilder.ts). Calculée à la demande à partir du PREMIER message
    // joueur rencontré ce tick (voir `sharedStatePrefix`), puis réutilisée pour tous les
    // suivants : sans ce partage, `JSON.stringify(message)` re-sérialisait `entities` EN ENTIER
    // (potentiellement plusieurs milliers d'éléments, le salon complet étant envoyé à chaque
    // joueur — chargement dynamique par intérêt retiré, demande utilisateur antérieure) une fois
    // PAR JOUEUR CONNECTÉ à chaque tick, alors que son contenu est rigoureusement identique pour
    // tous — un coût CPU proportionnel à (nb entités × nb joueurs) plutôt qu'à (nb entités + nb
    // joueurs).
    let sharedStatePrefix: string | undefined;
    for (const { playerId, message } of payloads) {
      const socket = runtime.sockets.get(playerId);
      if (!socket) continue;
      if (!admitStateFrame(playerId, socket, runtime.stateSkipStreakByPlayer)) continue;

      if (runtime.spectatorIds.has(playerId)) {
        if (cachedSpectatorJson === undefined) {
          cachedSpectatorJson = JSON.stringify(message);
        }
        sendRaw(socket, cachedSpectatorJson);
      } else if (message.type === 'state') {
        sharedStatePrefix ??= stateMessageSharedJsonPrefix(message);
        sendRaw(socket, sharedStatePrefix + stateMessageSelfJsonSuffix(message.self));
      } else {
        // Jamais atteint en pratique dans la boucle de tick (voir RoomInstance.handleTick, qui
        // ne construit que des `state`) — filet de sécurité si un jour un autre type de message y
        // transitait, pour ne jamais mal sérialiser un message dont la forme n'a pas été prévue
        // ci-dessus.
        send(socket, message);
      }
    }
  });

  managed.handle.onPlayerDeath((playerId, info) => {
    logEvent('player_died', { roomId: managed.id, playerId });

    const accountId = runtime.accountIdByPlayer.get(playerId);
    if (accountsService && accountId !== undefined) {
      if (info.finalScore > 0) {
        accountsService
          .recordBestMass(accountId, managed.modId, info.finalScore)
          .catch((error: unknown) => {
            logEvent('account_stats_write_failed', {
              roomId: managed.id,
              playerId,
              reason: (error as Error).message,
            });
          });
      }
      if (info.transformedScore > 0 || info.transformedXp > 0) {
        accountsService
          .recordGameResult(accountId, managed.modId, info.transformedScore, info.transformedXp)
          .catch((error: unknown) => {
            logEvent('account_stats_write_failed', {
              roomId: managed.id,
              playerId,
              reason: (error as Error).message,
            });
          });
      }
    }

    const socket = runtime.sockets.get(playerId);
    if (!socket) return;

    void (async () => {
      const card =
        accountId !== undefined ? await accountsService?.getDeathScreenCard(accountId) : undefined;
      // Réplique de bot (demande utilisateur) : un bot nommé (BOT_IDENTITIES) a sa propre punchline
      // de victoire, affichée à la place de l'écran de mort personnalisé du joueur — celui-ci reste
      // utilisé pour toute autre cause de mort (joueur humain, reset de salon). `botKillGifPath`
      // ne renvoie une bannière que si un GIF a réellement été déposé pour CE bot (voir son
      // commentaire) ; sinon la bannière retombe sur le dégradé par défaut plutôt que de référencer la bannière du joueur tué.
      const botMessage = info.killerNickname ? BOT_KILL_MESSAGES[info.killerNickname] : undefined;
      const customCard: DeathCustomCard = botMessage
        ? {
            message: botMessage,
            bannerId: botKillGifPath(info.killerNickname!) ?? DEFAULT_DEATH_BANNER_ID,
          }
        : card
          ? { message: card.message, bannerId: card.bannerId }
          : DEFAULT_CUSTOM_CARD;
      send(socket, {
        type: 'died',
        killerNickname: info.killerNickname,
        finalScore: info.finalScore,
        survivalTimeSec: info.survivalTimeSec,
        xpEarned: info.xpEarned,
        customCard,
      });
    })();
  });

  managed.handle.onReset(() => {
    logEvent('room_reset', { roomId: managed.id });
    for (const socket of runtime.sockets.values()) {
      send(socket, {
        type: 'died',
        finalScore: 0,
        survivalTimeSec: 0,
        xpEarned: 0,
        customCard: DEFAULT_CUSTOM_CARD,
      });
    }
  });

  return runtime;
}

/** Crédite un compte à la déconnexion d'un joueur encore en vie (voir connectionHandler.ts) —
 * pendant de `RoomHandle.onPlayerDeath` ci-dessus pour le cas "part avant de mourir" plutôt que
 * "meurt en jeu". `result` vient de `RoomHandle.leave`, déjà transformé par le mod
 * (`transformScoreForAccount`, voir RoomInstance.leave) — ce module n'a plus jamais besoin de
 * `Room` pour ça. */
export function recordAccountStatsOnLeave(
  accounts: AccountsService | undefined,
  managed: ManagedRoom,
  accountId: number | undefined,
  playerId: PlayerId,
  result: { rawScore?: number; transformedScore: number; transformedXp: number } | undefined,
): void {
  if (!accounts || !result) return;
  if (accountId === undefined) return;

  if (result.rawScore && result.rawScore > 0) {
    accounts
      .recordBestMass(accountId, managed.modId, result.rawScore)
      .catch((error: unknown) => {
        logEvent('account_stats_write_failed', {
          roomId: managed.id,
          playerId,
          reason: (error as Error).message,
        });
      });
  }

  if (result.transformedScore > 0 || result.transformedXp > 0) {
    accounts
      .recordGameResult(accountId, managed.modId, result.transformedScore, result.transformedXp)
      .catch((error: unknown) => {
        logEvent('account_stats_write_failed', {
          roomId: managed.id,
          playerId,
          reason: (error as Error).message,
        });
      });
  }
}

/** Seuil maximal de données accumulées dans le buffer de la socket avant de sauter un envoi (64 Ko)
 * — au-delà, le client n'absorbe déjà pas ce qu'il a reçu, inutile de continuer à lui envoyer des
 * ticks qu'il ne pourra pas afficher à temps. */
const MAX_BUFFERED_AMOUNT = 65536;
/** Seuil "encombrement naissant" (16 Ko, un quart du seuil dur ci-dessus) à partir duquel un
 * client précis voit sa cadence réduite de moitié PLUTÔT que de basculer d'un coup de "tout
 * reçoit" à "plus rien ne passe" en franchissant `MAX_BUFFERED_AMOUNT` — dégradation progressive
 * au lieu d'un drop silencieux brutal (voir plan_performance_reseau.md §4.3/Phase 4.1 : cause
 * probable des "petits sauts/avant-arrières" sur une connexion imparfaite, le client se
 * retrouvant à interpoler entre deux snapshots séparés par un grand trou de temps serveur). Ne
 * s'applique qu'au flux `state` (voir `admitStateFrame`, seul appelant) — jamais aux messages
 * rares et importants (`died`, `player`, `announcement`...), qui continuent de passer par `send`
 * directement sans dégradation. */
const SOFT_BUFFERED_AMOUNT = 16384;

/** Décide si le `state` de ce tick doit être envoyé à `playerId` — `true` en dessous du seuil
 * doux, un tick sur deux entre les deux seuils (dégradation progressive), jamais au-dessus du
 * seuil dur (comportement historique, voir `MAX_BUFFERED_AMOUNT`). `streaks` vit sur le
 * `RoomRuntime` de l'appelant, une entrée par joueur actuellement en dégradation. */
export function admitStateFrame(
  playerId: PlayerId,
  socket: WebSocket,
  streaks: Map<PlayerId, number>,
): boolean {
  if (socket.readyState !== socket.OPEN) return false;
  const buffered = socket.bufferedAmount;
  if (buffered > MAX_BUFFERED_AMOUNT) return false;

  if (buffered <= SOFT_BUFFERED_AMOUNT) {
    if (streaks.has(playerId)) streaks.delete(playerId);
    return true;
  }

  const streak = (streaks.get(playerId) ?? 0) + 1;
  streaks.set(playerId, streak);
  return streak % 2 === 0;
}

export function sendRaw(socket: WebSocket, jsonString: string): void {
  if (socket.readyState === socket.OPEN && socket.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
    socket.send(jsonString);
  }
}

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN && socket.bufferedAmount <= MAX_BUFFERED_AMOUNT) {
    socket.send(JSON.stringify(message));
  }
}

/** JSON du message `state` SANS `self` (`type`/`tick`/`entities`/`leaderboard`), tronqué juste
 * avant son accolade fermante — pas un JSON valide en soi, prévu pour être complété par
 * `stateMessageSelfJsonSuffix` ci-dessous. Voir le commentaire de `sharedStatePrefix` (appelant,
 * `wireRoom`) pour pourquoi ce découpage existe : `entities`/`leaderboard` sont identiques pour
 * tous les joueurs d'un même tick, seul `self` diffère. */
function stateMessageSharedJsonPrefix(message: WorldStateMessage): string {
  const { self: _self, ...shared } = message;
  const json = JSON.stringify(shared);
  return json.slice(0, -1); // retire le '}' final pour pouvoir y ajouter "self" ensuite
}

/** Complète le JSON tronqué de `stateMessageSharedJsonPrefix` — `,"self":{...}}` si `self` est
 * défini (voir `WorldStateMessage.self`, absent si le joueur n'a plus aucun morceau), sinon
 * simplement `}`. Le résultat concaténé reproduit EXACTEMENT `JSON.stringify(message)` (même
 * ordre de clés que `WorldStateMessage` : `type`, `tick`, `entities`, `leaderboard`, `self`). */
function stateMessageSelfJsonSuffix(self: WorldStateMessage['self']): string {
  return self === undefined ? '}' : `,"self":${JSON.stringify(self)}}`;
}
