import type {
  AdminActionResult,
  AdminPlayerInfo,
  AdminRoomAction,
  ServerMessage,
} from '@angulio/shared';
import type { RoomResetSchedule } from '../resetSchedule.js';
import type { PlayerId, PlayerInput } from '../types.js';

export type { AdminActionResult, AdminPlayerInfo, AdminRoomAction };

/** Description d'un salon à créer, indépendante de l'hébergement (voir `LocalRoomHost`/
 * `WorkerRoomHost`) — uniquement des valeurs sérialisables (jamais un `GameMod` déjà résolu, qui
 * contient des fonctions non clonables via `postMessage`) : un worker reconstruit le mod
 * lui-même à partir du seul `modId` (voir `engine/modRegistry.ts`). */
export interface RoomSpec {
  id: string;
  modId: string;
  tickRateHz: number;
  maxPlayers: number;
  botsEnabled?: boolean;
  /** `null` désactive le reset automatique — jamais `undefined` (voir RoomManager.createRoom, qui
   * résout déjà le "reset par défaut" avant de construire ce spec, pour ne pas dépendre d'une
   * troisième valeur possible côté worker). */
  resetSchedule: RoomResetSchedule | null;
  /** Taille de carte (carrée, px) pour CE salon — remplace `mapSize` du mod résolu (voir
   * `RoomInstance`). Absent = taille par défaut du mod (comportement d'origine). Bornes de
   * validité (1000-50000) appliquées côté HTTP (lobby.ts), pas ici. */
  mapSize?: number;
  /** Population de bots pour CE salon — remplace les réglages du mod résolu (voir `RoomInstance`,
   * `applyRoomBotCountOverride`). `min`/`max` identiques = population FIXE ; `min < max` = la même
   * pyramide Challenger que le comportement par défaut (décroissance de `max` à `min` bots à mesure
   * que des humains rejoignent), mais bornée par ces valeurs plutôt que celles du mod. Absent =
   * réglages du mod inchangés. */
  botCount?: { min: number; max: number };
}

export interface TickPayload {
  playerId: PlayerId;
  message: ServerMessage;
}

export interface RoomStats {
  playerCount: number;
  humanCount: number;
  tickAvgMs: number;
  tickP95Ms: number;
  tickOverruns: number;
}

export interface DeathInfo {
  killerNickname?: string;
  survivalTimeSec: number;
  /** Masse maximale atteinte pendant cette vie, arrondie — figure "score" côté client
   * (`died.finalScore`), avant toute transformation propre au mod (voir `transformedScore`). */
  finalScore: number;
  /** XP brute gagnée pendant cette vie, arrondie — figure côté client (`died.xpEarned`),
   * avant transformation (voir `transformedXp`). */
  xpEarned: number;
  /** Valeurs après `GameMod.transformScoreForAccount` (Lot 4, ex. Hardcore) — ce qui doit
   * effectivement être crédité au compte, jamais renvoyé au client (voir `LeaveResult`, même
   * distinction). */
  transformedScore: number;
  transformedXp: number;
}

export interface LeaveResult {
  rawScore: number;
  transformedScore: number;
  transformedXp: number;
}

// --- Actions admin (cahier_des_charges_admin.md §4.3-4.4) -------------------------------
//
// Traversent la même frontière worker_thread que `input`/`join` ci-dessus (voir
// `RoomHandle.adminAction`, `RoomInstance.adminAction`, `roomWorker.ts`) — un salon hébergé par un
// worker (défaut en production, voir index.ts `ROOM_WORKERS`) n'est autrement joignable que par
// `postMessage`, jamais par accès direct à `Room`/`World` depuis le thread principal.
// `AdminRoomAction`/`AdminActionResult`/`AdminPlayerInfo` vivent dans `@angulio/shared`
// (adminProtocol.ts, ré-exportés ci-dessus) : ce sont aussi les types du message WebSocket admin
// (connectionHandler.ts `?admin=1`), pas seulement du protocole interne worker_threads.

export type JoinResult =
  | {
      ok: true;
      playerId: PlayerId;
      /** Autres joueurs déjà présents au moment du join (avant l'ajout du nouveau) — sert au
       * "backfill" `player` envoyé au nouvel arrivant (voir connectionHandler.ts). Couleur non
       * incluse : résolue côté thread principal (compte/DB ou repli déterministe), voir
       * `RoomRuntime.colorByPlayer`. */
      existingPlayers: Array<{ id: PlayerId; nickname: string; skin?: string }>;
    }
  | { ok: false; reason: 'room_full' | 'nickname_taken' };

/** Émis à chaque `Room.addPlayer` (join initial ET respawn, voir `Room.onPlayerJoin`) — relayé
 * tel quel par `RoomHandle.onPlayerJoin` (broadcast.ts s'y abonne pour diffuser `player` à tous
 * les sockets du salon, y compris pour les bots qui ne passent jamais par `join()`/`respawn()`
 * ci-dessus, voir BotManager.spawnBot). `skin` : uniquement fourni par le thread principal au
 * join initial d'un humain (compte ou repli déterministe) — jamais au respawn (garde le
 * comportement exact d'avant ce refactor, y compris sa dépendance à `colorForNickname` en repli
 * côté broadcast.ts si absent). */
export interface PlayerJoinEvent {
  playerId: PlayerId;
  nickname: string;
  skin?: string;
}

export interface RespawnResult {
  respawned: boolean;
}

// --- Protocole worker_threads (main <-> roomWorker.ts) ----------------------
//
// Uniquement utilisé par `WorkerRoomHost`/`roomWorker.ts` — `LocalRoomHost` appelle `RoomInstance`
// directement (mêmes types de résultat ci-dessus, sans traverser `postMessage`). Les commandes
// `join`/`respawn`/`leave` sont corrélées par `reqId` (compteur global côté `WorkerRoomHost`, pas
// par salon) car une même connexion worker gère plusieurs salons.

export type RoomCommand =
  | ({ type: 'createRoom' } & RoomSpec)
  | { type: 'destroyRoom'; roomId: string }
  | { type: 'connectViewer'; roomId: string; playerId: PlayerId; isSpectator: boolean }
  | { type: 'disconnectViewer'; roomId: string; playerId: PlayerId }
  | { type: 'input'; roomId: string; playerId: PlayerId; input: PlayerInput }
  | { type: 'joinRequest'; reqId: number; roomId: string; nickname: string; skin?: string }
  | { type: 'respawnRequest'; reqId: number; roomId: string; playerId: PlayerId; nickname: string }
  | { type: 'leaveRequest'; reqId: number; roomId: string; playerId: PlayerId }
  | { type: 'adminActionRequest'; reqId: number; roomId: string; action: AdminRoomAction }
  | { type: 'adminListPlayersRequest'; reqId: number; roomId: string };

export type RoomWorkerEvent =
  | { type: 'joinResponse'; reqId: number; result: JoinResult }
  | { type: 'respawnResponse'; reqId: number; result: RespawnResult }
  | { type: 'leaveResponse'; reqId: number; result: LeaveResult | undefined }
  | { type: 'adminActionResponse'; reqId: number; result: AdminActionResult }
  | { type: 'adminListPlayersResponse'; reqId: number; result: AdminPlayerInfo[] }
  | { type: 'tick'; roomId: string; tick: number; payloads: TickPayload[]; stats: RoomStats }
  | { type: 'playerJoin'; roomId: string; event: PlayerJoinEvent }
  | { type: 'playerDeath'; roomId: string; playerId: PlayerId; info: DeathInfo }
  | { type: 'roomReset'; roomId: string }
  | { type: 'workerError'; roomId: string | undefined; message: string };
