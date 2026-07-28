import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminRoomAction } from '@angulio/shared';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import type { RoomManager } from '../../../engine/roomManager.js';
import { logEvent } from '../../../log.js';
import type { RoomRuntime } from '../../ws/broadcast.js';
import { isRecord, readJsonBody, respondJson } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

/** `GET /api/admin/rooms` (§3.3 cahier_des_charges_admin.md) — tous les salons (y compris privés,
 * contrairement à `GET /api/rooms`), avec le détail des joueurs connectés (pseudo, masse, bot,
 * gelé, ping) : la vue "Salons & Écrans" en a besoin pour le kick/transfert/POV, `GET /api/rooms`
 * (public, lobby) non. */
export async function handleAdminListRooms(
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  const rooms = await Promise.all(
    roomManager.allManagedRooms().map(async (managed) => {
      const stats = roomManager.roomStatsOf(managed);
      const runtime = runtimes.get(managed.id);
      const players = await managed.handle.adminListPlayers();
      return {
        id: managed.id,
        name: managed.name,
        modId: managed.modId,
        visibility: managed.visibility,
        maxPlayers: managed.maxPlayers,
        tickRateHz: roomManager.tickRateHz,
        stats,
        players: players.map((player) => ({
          ...player,
          ping: runtime?.latencyByPlayer.get(player.playerId),
        })),
      };
    }),
  );
  respondJson(res, 200, rooms);
}

/** `POST /api/admin/rooms/:id/action` — `{ action: AdminRoomAction }` (§4.3-4.4), même type
 * d'action que le canal WebSocket admin (`?admin=1`) : cette route REST couvre les actions
 * ponctuelles (reset, spawn, changement de mode…) déclenchées depuis "Salons & Écrans" plutôt que
 * depuis l'Espace Créatif temps réel, sans avoir à maintenir une connexion WS pour ça. */
export async function handleAdminRoomAction(
  roomManager: RoomManager,
  admin: AdminAuth | undefined,
  roomId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  const managed = roomManager.allManagedRooms().find((room) => room.id === roomId);
  if (!managed) {
    respondJson(res, 404, { error: 'Salon introuvable.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  if (!isRecord(body) || !isRecord(body.action) || typeof body.action.kind !== 'string') {
    respondJson(res, 400, { error: 'Action invalide.' });
    return;
  }

  const action = body.action as unknown as AdminRoomAction;
  const result = await managed.handle.adminAction(action);
  logEvent('admin_room_action', { roomId, kind: action.kind, ok: result.ok });
  respondJson(res, 200, result);
}

/** `POST /api/admin/rooms/:id/kick` — `{ playerId }` (§3.3, "Expulsion"). Ferme directement la
 * socket réseau : plus fiable qu'un message applicatif (le client pourrait ignorer un message,
 * jamais une fermeture de connexion). */
export async function handleAdminKick(
  runtimes: Map<string, RoomRuntime>,
  admin: AdminAuth | undefined,
  roomId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const playerId = isRecord(body) && typeof body.playerId === 'string' ? body.playerId : undefined;
  const runtime = runtimes.get(roomId);
  const socket = playerId ? runtime?.sockets.get(playerId) : undefined;
  if (!socket) {
    respondJson(res, 404, { error: 'Joueur introuvable dans ce salon.' });
    return;
  }

  logEvent('admin_kick', { roomId, playerId });
  socket.close(4403, 'Expulsé par un administrateur.');
  respondJson(res, 200, { success: true });
}

/** `POST /api/admin/rooms/:id/transfer` — `{ playerId, targetRoomId }` (§3.3, "Changement de
 * salon"). Le serveur ne migre pas la connexion lui-même (les deux salons peuvent vivre dans des
 * workers différents, voir WorkerRoomHost) : il prévient le client (`forceRoomChange`), qui ferme
 * puis rouvre lui-même vers le nouveau salon (voir GameView.tsx) — même mécanique que rejoindre
 * un salon normalement, juste déclenchée par le serveur plutôt qu'un clic. */
export async function handleAdminTransfer(
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  admin: AdminAuth | undefined,
  roomId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const playerId = isRecord(body) && typeof body.playerId === 'string' ? body.playerId : undefined;
  const targetRoomId =
    isRecord(body) && typeof body.targetRoomId === 'string' ? body.targetRoomId : undefined;
  if (!playerId || !targetRoomId) {
    respondJson(res, 400, { error: 'playerId et targetRoomId requis.' });
    return;
  }

  const targetExists = roomManager.allManagedRooms().some((room) => room.id === targetRoomId);
  if (!targetExists) {
    respondJson(res, 404, { error: 'Salon cible introuvable.' });
    return;
  }

  const runtime = runtimes.get(roomId);
  const socket = runtime?.sockets.get(playerId);
  if (!socket) {
    respondJson(res, 404, { error: 'Joueur introuvable dans ce salon.' });
    return;
  }

  logEvent('admin_transfer', { roomId, playerId, targetRoomId });
  socket.send(JSON.stringify({ type: 'forceRoomChange', roomId: targetRoomId }));
  respondJson(res, 200, { success: true });
}

/** `POST /api/admin/broadcast` — `{ text, color?, durationMs?, roomId? }` (§4.6). `roomId` absent
 * = diffusion globale (tous les salons), sinon limitée au salon indiqué. */
export async function handleAdminBroadcast(
  runtimes: Map<string, RoomRuntime>,
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const text = isRecord(body) && typeof body.text === 'string' ? body.text.trim() : '';
  if (!text || text.length > 200) {
    respondJson(res, 400, { error: 'Message requis (200 caractères maximum).' });
    return;
  }
  const color = isRecord(body) && typeof body.color === 'string' ? body.color : '#ffffff';
  const durationMs =
    isRecord(body) && typeof body.durationMs === 'number' && body.durationMs > 0
      ? Math.min(body.durationMs, 60_000)
      : 5000;
  const roomId = isRecord(body) && typeof body.roomId === 'string' ? body.roomId : undefined;

  const message = JSON.stringify({ type: 'announcement', text, color, durationMs });
  const targetRuntimes = roomId
    ? [runtimes.get(roomId)].filter((r): r is RoomRuntime => r !== undefined)
    : [...runtimes.values()];

  let sent = 0;
  for (const runtime of targetRuntimes) {
    for (const [playerId, socket] of runtime.sockets) {
      if (runtime.spectatorIds.has(playerId)) continue; // jamais aux spectateurs/admins connectés
      if (socket.readyState === socket.OPEN) {
        socket.send(message);
        sent++;
      }
    }
  }

  logEvent('admin_broadcast', { roomId: roomId ?? 'global', sent });
  respondJson(res, 200, { success: true, sent });
}
