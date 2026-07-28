/** Connexion WebSocket admin dédiée (`?admin=1`, cahier_des_charges_admin.md §4-§5.2) — un seul
 * canal réutilisé par "Salons & Écrans" (POV) et l'Espace Créatif : diffusion en continu de
 * toutes les entités du salon (comme un spectateur, jamais de Blob propre — §4.2, invisibilité
 * absolue) et envoi d'actions (`admin_action`) corrélées par `actionId`. */
import type {
  AdminActionResult,
  AdminRoomAction,
  EntitySnapshot,
  LeaderboardEntry,
} from '@angulio/shared';

export interface AdminSocketCallbacks {
  onState?: (entities: EntitySnapshot[], leaderboard?: LeaderboardEntry[]) => void;
  onPlayerInfo?: (playerId: string, nickname: string, skin?: string) => void;
  onClose?: (reason: string) => void;
}

export interface AdminSocketHandle {
  sendAction(action: AdminRoomAction): Promise<AdminActionResult>;
  close(): void;
}

export function connectAdminSocket(
  token: string,
  roomId: string,
  callbacks: AdminSocketCallbacks,
): AdminSocketHandle {
  const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
  const socket = new WebSocket(
    `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomId)}&admin=1&token=${encodeURIComponent(token)}`,
  );

  const pending = new Map<string, { resolve: (result: AdminActionResult) => void }>();
  let nextActionId = 0;

  socket.addEventListener('message', (event: MessageEvent<string>) => {
    let message: unknown;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    if (!message || typeof message !== 'object') return;
    const typed = message as { type?: string };

    if (typed.type === 'state') {
      const state = message as { entities: EntitySnapshot[]; leaderboard?: LeaderboardEntry[] };
      callbacks.onState?.(state.entities, state.leaderboard);
    } else if (typed.type === 'player') {
      const info = message as { playerId: string; nickname: string; skin?: string };
      callbacks.onPlayerInfo?.(info.playerId, info.nickname, info.skin);
    } else if (typed.type === 'admin_action_result') {
      const response = message as { actionId: string; result: AdminActionResult };
      const request = pending.get(response.actionId);
      if (request) {
        pending.delete(response.actionId);
        request.resolve(response.result);
      }
    }
  });

  socket.addEventListener('close', (event: CloseEvent) => {
    callbacks.onClose?.(
      event.code === 4401 ? 'Session admin expirée — reconnecte-toi.' : 'Connexion perdue.',
    );
  });

  return {
    sendAction(action: AdminRoomAction): Promise<AdminActionResult> {
      const actionId = String(nextActionId++);
      return new Promise((resolve) => {
        pending.set(actionId, { resolve });
        if (socket.readyState === socket.OPEN) {
          socket.send(JSON.stringify({ type: 'admin_action', actionId, action }));
        } else {
          pending.delete(actionId);
          resolve({ ok: false });
        }
      });
    },
    close(): void {
      socket.close();
    },
  };
}

/** Génère un id de Blob Dieu valide (§4.5) — le serveur reconnaît ce préfixe pour l'invincibilité
 * et l'exemption du classement (voir `engine/godmode.ts`, `isGodPlayerId`), n'importe quel
 * suffixe convient tant qu'il reste unique par session. */
export function generateGodPlayerId(): string {
  return `admin-god-${Math.random().toString(36).slice(2, 10)}`;
}
