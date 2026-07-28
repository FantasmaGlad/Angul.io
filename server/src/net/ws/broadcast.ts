import {
  colorForNickname,
  DEFAULT_DEATH_BANNER_ID,
  DEFAULT_DEATH_MESSAGE,
  getRandomSkin,
  type DeathCustomCard,
  type ServerMessage,
} from '@angulio/shared';
import type { WebSocket } from 'ws';
import type { AccountsService } from '../../accounts/service.js';
import type { ManagedRoom } from '../../engine/roomManager.js';
import type { PlayerId } from '../../engine/types.js';
import { logEvent } from '../../log.js';

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
  };
  runtimes.set(managed.id, runtime);

  managed.handle.onPlayerJoin(({ playerId, nickname, skin }) => {
    runtime.nicknameByPlayer.set(playerId, nickname);
    const assignedSkin =
      skin ?? (playerId.startsWith('bot-') ? getRandomSkin() : colorForNickname(nickname));
    runtime.colorByPlayer.set(playerId, assignedSkin);
    const playerInfo = { type: 'player' as const, playerId, nickname, color: assignedSkin };
    for (const socket of runtime.sockets.values()) send(socket, playerInfo);
  });

  managed.handle.onTick((_tick, payloads) => {
    for (const { playerId, message } of payloads) {
      const socket = runtime.sockets.get(playerId);
      if (socket) send(socket, message);
    }
  });

  managed.handle.onPlayerDeath((playerId, info) => {
    logEvent('player_died', { roomId: managed.id, playerId });

    const accountId = runtime.accountIdByPlayer.get(playerId);
    if (accountsService && accountId !== undefined && (info.transformedScore > 0 || info.transformedXp > 0)) {
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

    const socket = runtime.sockets.get(playerId);
    if (!socket) return;

    void (async () => {
      const card =
        accountId !== undefined ? await accountsService?.getDeathScreenCard(accountId) : undefined;
      send(socket, {
        type: 'died',
        killerNickname: info.killerNickname,
        finalScore: info.finalScore,
        survivalTimeSec: info.survivalTimeSec,
        xpEarned: info.xpEarned,
        customCard: card ? { message: card.message, bannerId: card.bannerId } : DEFAULT_CUSTOM_CARD,
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
  result: { transformedScore: number; transformedXp: number } | undefined,
): void {
  if (!accounts || !result) return;
  if (accountId === undefined) return;
  if (result.transformedScore <= 0 && result.transformedXp <= 0) return;

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

export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}
