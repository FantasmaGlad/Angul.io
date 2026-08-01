import type { IncomingMessage, ServerResponse } from 'node:http';
import {
  AccountError,
  type AccountsService,
  type AdminAccountPatch,
  type AdminSearchQuery,
} from '../../../accounts/service.js';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import { logEvent } from '../../../log.js';
import { RateLimiter } from '../../rateLimiter.js';
import { getBearerToken, getClientIp, isRecord, readJsonBody, respondJson } from '../httpUtils.js';

export async function handleAdminLogin(
  admin: AdminAuth | undefined,
  adminRateLimiter: RateLimiter,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!admin?.isConfigured) {
    respondJson(res, 503, {
      error: 'Interface admin indisponible (ADMIN_PASSWORD_HASH non configuré).',
    });
    return;
  }

  const clientIp = getClientIp(req);
  if (!adminRateLimiter.consume(clientIp)) {
    logEvent('admin_login_rate_limited', { ip: clientIp });
    respondJson(res, 429, {
      error: 'Trop de tentatives de connexion admin. Réessayez dans une minute.',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const username = isRecord(body) && typeof body.username === 'string' ? body.username : '';
  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';
  const token = await admin.login(username, password);
  if (!token) {
    logEvent('admin_login_failed', { username });
    respondJson(res, 401, { error: "Nom d'utilisateur ou mot de passe incorrect." });
    return;
  }
  logEvent('admin_login', { username });
  respondJson(res, 200, { token });
}

export function handleAdminLogout(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!admin?.isConfigured) {
    respondJson(res, 503, {
      error: 'Interface admin indisponible (ADMIN_PASSWORD_HASH non configuré).',
    });
    return;
  }

  const token = getBearerToken(req);
  admin.logout(token);
  respondJson(res, 200, { success: true });
}

export function requireAdmin(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!admin?.isConfigured) {
    respondJson(res, 503, {
      error: 'Interface admin indisponible (ADMIN_PASSWORD_HASH non configuré).',
    });
    return false;
  }
  if (!admin.isAuthenticated(getBearerToken(req))) {
    respondJson(res, 401, { error: 'Non authentifié (admin).' });
    return false;
  }
  return true;
}

export async function handleAdminSearchPlayers(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }
  respondJson(res, 200, await accounts.searchAccountsForAdmin(parseAdminSearchQuery(url)));
}

function parseAdminSearchQuery(url: URL): AdminSearchQuery {
  const params = url.searchParams;
  const query: AdminSearchQuery = {};
  const q = params.get('q')?.trim();
  if (q) query.q = q;
  const ip = params.get('ip')?.trim();
  if (ip) query.ip = ip;
  if (params.has('premium')) query.premium = params.get('premium') === 'true';
  if (params.has('banned')) query.banned = params.get('banned') === 'true';
  const minLevel = Number(params.get('minLevel'));
  if (Number.isFinite(minLevel) && params.has('minLevel')) query.minLevel = minLevel;
  const maxLevel = Number(params.get('maxLevel'));
  if (Number.isFinite(maxLevel) && params.has('maxLevel')) query.maxLevel = maxLevel;
  const minXp = Number(params.get('minXp'));
  if (Number.isFinite(minXp) && params.has('minXp')) query.minXp = minXp;
  const maxXp = Number(params.get('maxXp'));
  if (Number.isFinite(maxXp) && params.has('maxXp')) query.maxXp = maxXp;
  const sortBy = params.get('sortBy');
  const validSortBy = ['pseudo', 'level', 'xp', 'createdAt', 'lastLoginAt', 'totalPlaytimeSec', 'bestScore'];
  if (sortBy && validSortBy.includes(sortBy)) {
    query.sortBy = sortBy as NonNullable<AdminSearchQuery['sortBy']>;
  }
  if (params.get('sortDir') === 'desc') query.sortDir = 'desc';
  const limit = Number(params.get('limit'));
  if (Number.isFinite(limit)) query.limit = limit;
  const offset = Number(params.get('offset'));
  if (Number.isFinite(offset)) query.offset = offset;
  return query;
}

export async function handleAdminGetPlayer(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  accountId: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }
  const account = await accounts.getAccountForAdmin(accountId);
  if (!account) {
    respondJson(res, 404, { error: 'Compte introuvable.' });
    return;
  }
  respondJson(res, 200, account);
}

export async function handleAdminUpdatePlayer(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  accountId: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, 10_000_000);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  try {
    const updated = await accounts.updateAccountForAdmin(accountId, parseAdminPatch(body));
    if (!updated) {
      respondJson(res, 404, { error: 'Compte introuvable.' });
      return;
    }
    logEvent('admin_account_updated', { accountId });
    respondJson(res, 200, updated);
  } catch (error) {
    if (error instanceof AccountError) {
      respondJson(res, 400, { error: error.message });
      return;
    }
    logEvent('account_error', { action: 'admin_update', reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}

function parseAdminPatch(body: unknown): AdminAccountPatch {
  if (!isRecord(body)) return {};
  const patch: AdminAccountPatch = {};
  if (typeof body.pseudo === 'string') patch.pseudo = body.pseudo;
  if (typeof body.level === 'number') patch.level = body.level;
  if (typeof body.xp === 'number') patch.xp = body.xp;
  if (typeof body.premium === 'boolean') patch.premium = body.premium;
  if (typeof body.banned === 'boolean') patch.banned = body.banned;
  if (typeof body.avatarColor === 'string') patch.avatarColor = body.avatarColor;
  if (typeof body.deathMessage === 'string') patch.deathMessage = body.deathMessage;
  if (typeof body.deathBannerId === 'string') patch.deathBannerId = body.deathBannerId;
  if (typeof body.newPassword === 'string' && body.newPassword.length > 0) {
    patch.newPassword = body.newPassword;
  }
  if (Array.isArray(body.cosmetics) && body.cosmetics.every((c) => typeof c === 'string')) {
    patch.cosmetics = body.cosmetics;
  }
  return patch;
}

/** `POST /api/admin/players/:id/reset-best-score` — `{ modeId? }` : réinitialise un mode précis,
 * ou tous si omis (§3.2). */
export async function handleAdminResetBestScore(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  accountId: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const modeId = isRecord(body) && typeof body.modeId === 'string' ? body.modeId : undefined;
  await accounts.resetBestScoreForAdmin(accountId, modeId);
  logEvent('admin_best_score_reset', { accountId, modeId });
  respondJson(res, 200, { success: true });
}
