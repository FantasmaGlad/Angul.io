import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountsService } from '../../../accounts/service.js';
import type { RoomManager, RoomVisibility } from '../../../engine/roomManager.js';
import { logEvent } from '../../../log.js';
import { getBearerToken, isRecord, readJsonBody, respondJson } from '../httpUtils.js';

const MAX_ROOM_NAME_LENGTH = 40;
const MIN_ROOM_MAX_PLAYERS = 2;
const MAX_ROOM_MAX_PLAYERS = 200;
const MIN_ROOM_DURATION_MS = 60_000;
const MAX_ROOM_DURATION_MS = 24 * 60 * 60_000;

export async function handleCreateRoom(
  roomManager: RoomManager,
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (accounts) {
    const accountId = accounts.resolveToken(getBearerToken(req));
    if (!(await accounts.isPremium(accountId))) {
      logEvent('room_create_rejected', { reason: 'not_premium' });
      respondJson(res, 403, {
        error: 'La création de salon est réservée aux comptes Premium (voir la page Soutien).',
      });
      return;
    }
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    logEvent('room_create_rejected', { reason: (error as Error).message });
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const nameRaw = isRecord(body) ? body.name : undefined;
  const modId = isRecord(body) ? body.modId : undefined;
  const visibilityRaw = isRecord(body) ? body.visibility : undefined;
  const name = typeof nameRaw === 'string' ? nameRaw.trim().slice(0, MAX_ROOM_NAME_LENGTH) : '';
  const visibility: RoomVisibility = visibilityRaw === 'private' ? 'private' : 'public';

  const maxPlayersRaw = isRecord(body) ? body.maxPlayers : undefined;
  const maxPlayers =
    typeof maxPlayersRaw === 'number' &&
    Number.isInteger(maxPlayersRaw) &&
    maxPlayersRaw >= MIN_ROOM_MAX_PLAYERS &&
    maxPlayersRaw <= MAX_ROOM_MAX_PLAYERS
      ? maxPlayersRaw
      : undefined;

  const durationMsRaw = isRecord(body) ? body.durationMs : undefined;
  const durationMs =
    typeof durationMsRaw === 'number' &&
    durationMsRaw >= MIN_ROOM_DURATION_MS &&
    durationMsRaw <= MAX_ROOM_DURATION_MS
      ? durationMsRaw
      : undefined;

  const botsEnabled =
    isRecord(body) && typeof body.botsEnabled === 'boolean' ? body.botsEnabled : undefined;
  const inviteCode =
    isRecord(body) && typeof body.inviteCode === 'string' ? body.inviteCode : undefined;

  if (!name) {
    logEvent('room_create_rejected', { reason: 'missing_name' });
    respondJson(res, 400, { error: 'Le nom du salon est requis.' });
    return;
  }
  if (typeof modId !== 'string' || !modId) {
    logEvent('room_create_rejected', { reason: 'missing_modId' });
    respondJson(res, 400, { error: 'Le mode de jeu (modId) est requis.' });
    return;
  }

  try {
    const summary = roomManager.createRoom({
      name,
      modId,
      visibility,
      maxPlayers,
      durationMs,
      botsEnabled,
      inviteCode,
    });
    respondJson(res, 201, summary);
  } catch (error) {
    logEvent('room_create_rejected', { reason: (error as Error).message });
    respondJson(res, 400, { error: (error as Error).message });
  }
}

export function handleGetRooms(roomManager: RoomManager, res: ServerResponse): void {
  respondJson(res, 200, roomManager.listPublicRooms());
}

export function handleGetModes(availableModIds: string[], res: ServerResponse): void {
  respondJson(res, 200, availableModIds);
}

export function handleGetStats(roomManager: RoomManager, res: ServerResponse): void {
  const playersOnline = roomManager
    .allManagedRooms()
    .reduce((sum, managed) => sum + roomManager.playerCountOf(managed), 0);
  respondJson(res, 200, { playersOnline });
}

const DEFAULT_LEADERBOARD_LIMIT = 50;

/** Classement public (Lot "Classements") — `?mode=` omis ou `global` renvoie le classement par
 * XP totale, un id de mode (`vanilla`/`hardcore`/...) renvoie le classement par meilleur score de
 * ce mode. Pas d'authentification requise (même esprit que `/api/rooms`) : c'est une vitrine
 * publique. Tableau vide (pas d'erreur) si les comptes joueurs sont désactivés (pas de base de
 * données configurée) — un classement vide reste un affichage valide, contrairement aux routes de
 * compte qui, elles, ont vraiment besoin d'un compte pour répondre.
 */
export async function handleGetLeaderboard(
  accounts: AccountsService | undefined,
  url: URL,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 200, []);
    return;
  }
  const modeParam = url.searchParams.get('mode');
  const modeId = modeParam && modeParam !== 'global' ? modeParam : undefined;
  const limitParam = Number(url.searchParams.get('limit'));
  const limit = Number.isFinite(limitParam) && limitParam > 0 ? limitParam : DEFAULT_LEADERBOARD_LIMIT;
  try {
    const entries = await accounts.getLeaderboard(modeId, limit);
    respondJson(res, 200, entries);
  } catch (error) {
    logEvent('leaderboard_error', { reason: (error as Error).message });
    respondJson(res, 200, []);
  }
}
