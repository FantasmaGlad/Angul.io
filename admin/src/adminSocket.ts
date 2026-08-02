/** Connexion WebSocket admin dédiée (`?admin=1`, cahier_des_charges_admin.md §4-§5.2) — un seul
 * canal réutilisé par "Salons & Écrans" (POV) et l'Espace Créatif : diffusion en continu de
 * toutes les entités du salon (comme un spectateur, jamais de Blob propre — §4.2, invisibilité
 * absolue) et envoi d'actions (`admin_action`) corrélées par `actionId`. */
import type {
  AdminActionResult,
  AdminPlayerInfo,
  AdminRoomAction,
  EntitySnapshot,
  LeaderboardEntry,
  MovementConfig,
} from '@angulio/shared';

/** `welcome` admin complet (A5 corrigé, plan-implementation-admin.md §1/§3.8) — le serveur envoie
 * déjà tous ces champs pour la connexion admin (`connectionHandler.ts`, identique à la branche
 * spectateur) ; jusqu'ici seul `tickRateHz` était lu ici, le reste (dont `mapSize`, la vraie
 * cause des caméras de repli codées en dur 7500/7500) était silencieusement jeté. */
export interface AdminWelcomeInfo {
  tickRateHz: number;
  mapSize: number;
  movement: MovementConfig;
  buildVersion?: string;
  nextResetAtMs?: number;
}

/** `state` admin complet (P2, plan-implementation-admin.md §4.1) — le canal admin porte les mêmes
 * champs que le `state` joueur/spectateur (`tick`, `entitiesFull`, `removedFoodIds`, voir
 * `shared/src/protocol.ts` `WorldStateMessage`), nécessaires au `RenderEngine` partagé
 * (`pushSnapshot`) désormais utilisé par le Studio — jusqu'ici seul `entities`/`leaderboard`
 * étaient lus, le reste silencieusement jeté (sans conséquence avant, l'admin utilisait son propre
 * `AdminSnapshotBuffer` simplifié, qui n'en avait pas besoin). */
export interface AdminStateInfo {
  entities: EntitySnapshot[];
  tick: number;
  entitiesFull?: boolean;
  removedFoodIds?: string[];
  leaderboard?: LeaderboardEntry[];
}

export interface AdminSocketCallbacks {
  onState?: (state: AdminStateInfo) => void;
  /** Le champ réel du message `player` s'appelle `color`, jamais `skin` (voir
   * `connectionHandler.ts`/`broadcast.ts`) — un ancien nommage `skin` ici faisait que ce
   * callback ne recevait jamais rien, et donc que l'admin n'affichait jamais les vrais skins. */
  onPlayerInfo?: (playerId: string, nickname: string, color?: string) => void;
  onWelcome?: (welcome: AdminWelcomeInfo) => void;
  /** État fiable des joueurs (A3, plan-implementation-admin.md §3.9) — poussé par le serveur à
   * ~1Hz, source du badge GELÉ (et futurs badges MARIONNETTE/DIEU, §9.5) : remplace la dérivation
   * depuis les snapshots `state`, qui ne portent aucun état "gelé". */
  onAdminPlayers?: (players: AdminPlayerInfo[]) => void;
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
      callbacks.onState?.(message as AdminStateInfo);
    } else if (typed.type === 'welcome') {
      const welcome = message as Partial<AdminWelcomeInfo>;
      if (
        typeof welcome.tickRateHz === 'number' &&
        welcome.tickRateHz > 0 &&
        typeof welcome.mapSize === 'number' &&
        welcome.movement
      ) {
        callbacks.onWelcome?.({
          tickRateHz: welcome.tickRateHz,
          mapSize: welcome.mapSize,
          movement: welcome.movement,
          buildVersion: welcome.buildVersion,
          nextResetAtMs: welcome.nextResetAtMs,
        });
      }
    } else if (typed.type === 'player') {
      const info = message as { playerId: string; nickname: string; color?: string };
      callbacks.onPlayerInfo?.(info.playerId, info.nickname, info.color);
    } else if (typed.type === 'adminPlayers') {
      const payload = message as { players: AdminPlayerInfo[] };
      callbacks.onAdminPlayers?.(payload.players);
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
