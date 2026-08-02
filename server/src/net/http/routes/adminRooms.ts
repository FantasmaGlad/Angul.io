import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminRoomAction } from '@angulio/shared';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import { logAdminEvent } from '../../../admin/activityLog.js';
import { resolveBaseRoomCreateOptions } from '../../../engine/baseRoomOptions.js';
import { resolveMod } from '../../../engine/modRegistry.js';
import { ADMIN_TICK_DIVISOR } from '../../../engine/worker/snapshotBuilder.js';
import type { RoomManager } from '../../../engine/roomManager.js';
import {
  loadBaseRoomsConfig,
  saveBaseRoomsConfig,
  type BaseRoomConfig,
} from '../../../roomsConfig.js';
import { diffBaseRooms, validateBaseRoomsPayload, type RoomDiffEntry } from '../../../roomsDiff.js';
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
        // Cadence de SIMULATION brute — utile pour le diagnostic serveur (charge CPU), mais
        // PAS ce qu'un viewer admin/spectateur reçoit réellement (voir `snapshotHz` ci-dessous).
        tickRateHz: roomManager.tickRateHz,
        // Cadence RÉELLE des paquets reçus par le canal admin (§2.3/§8/§17 cahier_des_charges_admin.md :
        // "la cadence affichée ... doit correspondre exactement à la cadence réelle des paquets
        // reçus") — c'est CETTE valeur que "Salons & Écrans" doit afficher, jamais `tickRateHz` brut
        // (qui affichait à tort le taux de simulation, trompeur : un admin voyait "30Hz"/"20Hz" alors
        // que son canva n'était en réalité rafraîchi qu'à `tickRateHz / ADMIN_TICK_DIVISOR`).
        snapshotHz: roomManager.tickRateHz / ADMIN_TICK_DIVISOR,
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
  logAdminEvent('admin_room_action', { roomId, kind: action.kind, ok: result.ok });
  respondJson(res, 200, result);
}

/** Le motif de kick sert de raison de fermeture WebSocket (RFC 6455 : 123 octets UTF-8 max, la
 * lib `ws` lève sinon) — tronque au pire cas plutôt que de risquer un throw sur un motif saisi
 * avec des caractères accentués (2 octets chacun en UTF-8). */
function truncateForWsCloseReason(text: string, maxBytes = 123): string {
  let result = text;
  while (Buffer.byteLength(result, 'utf8') > maxBytes) {
    result = result.slice(0, -1);
  }
  return result;
}

/** `POST /api/admin/rooms/:id/kick` — `{ playerId, reason }` (A1, plan-implementation-admin.md
 * §3.2 : motif désormais obligatoire et transmis au serveur — auparavant capturé côté UI mais
 * jamais envoyé). Ferme directement la socket réseau : plus fiable qu'un message applicatif (le
 * client pourrait ignorer un message, jamais une fermeture de connexion). */
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
  const reason = isRecord(body) && typeof body.reason === 'string' ? body.reason.trim() : '';
  if (!reason) {
    respondJson(res, 400, { error: "Motif d'expulsion requis." });
    return;
  }

  const runtime = runtimes.get(roomId);
  const socket = playerId ? runtime?.sockets.get(playerId) : undefined;
  if (!socket) {
    respondJson(res, 404, { error: 'Joueur introuvable dans ce salon.' });
    return;
  }

  logAdminEvent('admin_kick', { roomId, playerId, reason });
  socket.close(4403, truncateForWsCloseReason(reason));
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

  logAdminEvent('admin_transfer', { roomId, playerId, targetRoomId });
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

  logAdminEvent('admin_broadcast', { roomId: roomId ?? 'global', sent });
  respondJson(res, 200, { success: true, sent });
}

/** `GET /api/admin/base-rooms` (§13 cahier_des_charges_admin.md) — liste actuelle de
 * `server/rooms.json` : les salons permanents créés au démarrage du serveur. */
export function handleAdminGetBaseRooms(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  try {
    respondJson(res, 200, loadBaseRoomsConfig());
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}

function isValidBaseRoomsPayload(body: unknown, availableModIds: string[]): body is BaseRoomConfig[] {
  if (!Array.isArray(body) || body.length === 0) return false;
  return body.every(
    (entry) =>
      isRecord(entry) &&
      typeof entry.name === 'string' &&
      entry.name.trim().length > 0 &&
      typeof entry.modId === 'string' &&
      availableModIds.includes(entry.modId),
  );
}

/** `PUT /api/admin/base-rooms` — `BaseRoomConfig[]` (§13) : réécrit `server/rooms.json` SANS
 * l'appliquer aux salons vivants (voir décision §2.3 plan-implementation-admin.md : reste séparée
 * des routes `diff`/`apply` ci-dessous, qui persistent ET appliquent). Conservée telle quelle pour
 * un usage programmatique direct (script, outillage externe) ; l'interface admin elle-même passe
 * désormais exclusivement par `diff`/`apply` (§8.5, ConfigurationView.tsx). */
export async function handleAdminUpdateBaseRooms(
  admin: AdminAuth | undefined,
  availableModIds: string[],
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

  if (!isValidBaseRoomsPayload(body, availableModIds)) {
    respondJson(res, 400, {
      error: 'Chaque salon nécessite un nom non vide et un modId parmi les modes disponibles.',
    });
    return;
  }

  // Complète les ids manquants (P6, §8.1) — cette route reste un simple write (jamais d'apply),
  // mais ne doit jamais écrire une entrée sans id : `loadBaseRoomsConfig` migrerait sinon
  // silencieusement au prochain chargement, avec un id DIFFÉRENT de celui que cet appel pensait
  // avoir écrit (rupture de l'appariement `baseRoomId` pour tout salon déjà vivant).
  const rooms = body.map((room) => (room.id ? room : { ...room, id: randomUUID() }));

  try {
    saveBaseRoomsConfig(rooms);
    logAdminEvent('admin_base_rooms_updated', { count: rooms.length });
    respondJson(res, 200, {
      success: true,
      rooms,
      note: 'Sauvegardé. Utilisez « Appliquer les changements » pour synchroniser les salons vivants sans redémarrage.',
    });
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}

/** Annonce en jeu avant une fermeture/recréation (§12.1 cahier_des_charges_admin.md : "annonce
 * préalable de 10 s") — même forme de message que `handleAdminBroadcast` ci-dessus, mais ciblée
 * sur UN SEUL salon sans passer par la route HTTP publique (appelée en interne par `apply`). */
function announceToRoom(runtimes: Map<string, RoomRuntime>, roomId: string, text: string, durationMs: number): void {
  const runtime = runtimes.get(roomId);
  if (!runtime) return;
  const message = JSON.stringify({ type: 'announcement', text, color: '#ffffff', durationMs });
  for (const [playerId, socket] of runtime.sockets) {
    if (runtime.spectatorIds.has(playerId)) continue;
    if (socket.readyState === socket.OPEN) socket.send(message);
  }
}

/** Délai (s) entre l'annonce en jeu et la fermeture/recréation effective d'un salon impacté par
 * `apply` (§12.1 cahier_des_charges_admin.md : "annonce préalable de 10 s"). */
const APPLY_ANNOUNCE_DELAY_SEC = 10;
const APPLY_ANNOUNCE_DURATION_MS = 8000;

/** `POST /api/admin/base-rooms/diff` (P6, §8.4 plan-implementation-admin.md) — AUCUNE écriture :
 * calcule le plan de diff (créé/fermé/reconfiguré à chaud/recréé) entre `rooms.json` actuel et la
 * config proposée, pour la modale de confirmation côté UI (§8.5) avant tout `apply`. */
export async function handleAdminDiffBaseRooms(
  roomManager: RoomManager,
  admin: AdminAuth | undefined,
  availableModIds: string[],
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

  const rooms = isRecord(body) ? body.rooms : undefined;
  const validated = validateBaseRoomsPayload(rooms, availableModIds);
  if (!validated.ok) {
    respondJson(res, 400, { errors: validated.errors });
    return;
  }

  const previous = loadBaseRoomsConfig();
  const diff = diffBaseRooms(previous, validated.value);
  const enriched = diff.map((entry) => {
    const live = entry.id ? roomManager.findByBaseRoomId(entry.id) : undefined;
    const affectedPlayers =
      live && (entry.status === 'closed' || entry.status === 'recreated')
        ? roomManager.playerCountOf(live)
        : 0;
    return { ...entry, affectedPlayers };
  });
  respondJson(res, 200, enriched);
}

/** `POST /api/admin/base-rooms/apply` (P6, §8.4) — persiste `rooms.json` PUIS exécute le diff :
 * création (`roomManager.createRoom`), fermeture (`closeRoom`, §8.2), reconfiguration à chaud
 * (`switchMod`+`reset` pour `modId`, `setRoomResetSchedule` pour `resetDurationMin` — jamais les
 * deux en même temps que `mapSize`/`maxPlayers`, qui déclenchent une recréation à la place),
 * recréation (`closeRoom` puis `createRoom` avec les nouvelles valeurs, après le même délai
 * d'annonce que `closeRoom` seul). Chaque salon fermé/recréé reçoit d'abord une annonce en jeu
 * (§12.1, "10 s") ; la reconfiguration à chaud (mode/reset) n'expulse personne, aucune annonce. */
export async function handleAdminApplyBaseRooms(
  roomManager: RoomManager,
  runtimes: Map<string, RoomRuntime>,
  admin: AdminAuth | undefined,
  availableModIds: string[],
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

  const roomsInput = isRecord(body) ? body.rooms : undefined;
  const validated = validateBaseRoomsPayload(roomsInput, availableModIds);
  if (!validated.ok) {
    respondJson(res, 400, { errors: validated.errors });
    return;
  }

  // Ids fraîchement assignés AVANT le diff (pas après) : une entrée 'created' ne doit jamais
  // matcher accidentellement une entrée précédente, voir diffBaseRooms (appariement PAR ID).
  const finalRooms: BaseRoomConfig[] = validated.value.map((room) =>
    room.id ? room : { ...room, id: randomUUID() },
  );
  const previous = loadBaseRoomsConfig();
  const diff = diffBaseRooms(previous, finalRooms);
  const previousById = new Map(previous.map((room) => [room.id, room]));
  const finalById = new Map(finalRooms.map((room) => [room.id, room]));

  // Persisté AVANT d'appliquer (pas après) : si le process s'arrête au milieu de l'application,
  // l'état sur disque reflète déjà l'intention — un redémarrage recrée alors depuis `rooms.json`
  // exactement ce qui restait à faire, plutôt que de revenir en arrière.
  saveBaseRoomsConfig(finalRooms);

  const results: Array<RoomDiffEntry & { applied: boolean }> = [];

  for (const entry of diff) {
    switch (entry.status) {
      case 'unchanged':
        results.push({ ...entry, applied: true });
        break;

      case 'created': {
        const base = finalById.get(entry.id);
        if (base) {
          roomManager.createRoom({
            ...resolveBaseRoomCreateOptions(base, resolveMod),
            visibility: 'public',
            permanent: true,
          });
        }
        results.push({ ...entry, applied: Boolean(base) });
        break;
      }

      case 'hot-reconfigured': {
        const base = finalById.get(entry.id);
        const prevBase = previousById.get(entry.id);
        const live = roomManager.findByBaseRoomId(entry.id);
        if (base && prevBase && live) {
          if (prevBase.modId !== base.modId) {
            await live.handle.adminAction({ kind: 'switchMod', modId: base.modId });
            await live.handle.adminAction({ kind: 'reset' });
          }
          if (prevBase.resetDurationMin !== base.resetDurationMin) {
            const schedule =
              base.resetDurationMin && base.resetDurationMin > 0
                ? ({ type: 'everyNMinutes', minutes: base.resetDurationMin, timeZone: 'Europe/Paris' } as const)
                : null;
            await roomManager.setRoomResetSchedule(live.id, schedule);
          }
        }
        results.push({ ...entry, applied: Boolean(base && prevBase && live) });
        break;
      }

      case 'closed': {
        const live = roomManager.findByBaseRoomId(entry.id);
        if (live) {
          announceToRoom(
            runtimes,
            live.id,
            `Ce salon ferme pour maintenance dans ${APPLY_ANNOUNCE_DELAY_SEC} secondes...`,
            APPLY_ANNOUNCE_DURATION_MS,
          );
          roomManager.closeRoom(live.id, { reason: 'admin_closed', delaySeconds: APPLY_ANNOUNCE_DELAY_SEC });
        }
        results.push({ ...entry, applied: Boolean(live) });
        break;
      }

      case 'recreated': {
        const base = finalById.get(entry.id);
        const live = roomManager.findByBaseRoomId(entry.id);
        if (base && live) {
          announceToRoom(
            runtimes,
            live.id,
            `Ce salon redémarre pour maintenance dans ${APPLY_ANNOUNCE_DELAY_SEC} secondes...`,
            APPLY_ANNOUNCE_DURATION_MS,
          );
          roomManager.closeRoom(live.id, { reason: 'admin_recreated', delaySeconds: APPLY_ANNOUNCE_DELAY_SEC });
          setTimeout(
            () => {
              roomManager.createRoom({
                ...resolveBaseRoomCreateOptions(base, resolveMod),
                visibility: 'public',
                permanent: true,
              });
            },
            APPLY_ANNOUNCE_DELAY_SEC * 1000 + 250,
          );
        }
        results.push({ ...entry, applied: Boolean(base && live) });
        break;
      }
    }
  }

  logAdminEvent('admin_base_rooms_applied', {
    count: finalRooms.length,
    created: results.filter((r) => r.status === 'created').length,
    closed: results.filter((r) => r.status === 'closed').length,
    recreated: results.filter((r) => r.status === 'recreated').length,
    hotReconfigured: results.filter((r) => r.status === 'hot-reconfigured').length,
  });
  respondJson(res, 200, { success: true, rooms: finalRooms, diff: results });
}
