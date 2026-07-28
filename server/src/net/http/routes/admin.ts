import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountError, type AccountsService } from '../../../accounts/service.js';
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

  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';
  const token = await admin.login(password);
  if (!token) {
    logEvent('admin_login_failed', {});
    respondJson(res, 401, { error: 'Mot de passe incorrect.' });
    return;
  }
  logEvent('admin_login', {});
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
  const query = url.searchParams.get('q')?.trim() ?? '';
  respondJson(res, 200, await accounts.searchAccountsForAdmin(query));
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
    body = await readJsonBody(req);
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

function parseAdminPatch(body: unknown): {
  level?: number;
  xp?: number;
  premium?: boolean;
  cosmetics?: string[];
  banned?: boolean;
} {
  if (!isRecord(body)) return {};
  const patch: {
    level?: number;
    xp?: number;
    premium?: boolean;
    cosmetics?: string[];
    banned?: boolean;
  } = {};
  if (typeof body.level === 'number') patch.level = body.level;
  if (typeof body.xp === 'number') patch.xp = body.xp;
  if (typeof body.premium === 'boolean') patch.premium = body.premium;
  if (typeof body.banned === 'boolean') patch.banned = body.banned;
  if (Array.isArray(body.cosmetics) && body.cosmetics.every((c) => typeof c === 'string')) {
    patch.cosmetics = body.cosmetics;
  }
  return patch;
}
