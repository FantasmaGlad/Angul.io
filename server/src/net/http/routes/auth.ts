import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountError, type AccountsService } from '../../../accounts/service.js';
import { logEvent } from '../../../log.js';
import { RateLimiter } from '../../rateLimiter.js';
import { getBearerToken, getClientIp, isRecord, readJsonBody, respondJson } from '../httpUtils.js';

export async function handleRegisterOrLogin(
  accounts: AccountsService | undefined,
  authRateLimiter: RateLimiter,
  action: 'register' | 'login',
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  const clientIp = getClientIp(req);
  if (!authRateLimiter.consume(clientIp)) {
    logEvent('auth_rate_limited', { action, ip: clientIp });
    respondJson(res, 429, {
      error: 'Trop de tentatives d’authentification. Réessayez dans une minute.',
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

  const pseudo = isRecord(body) && typeof body.pseudo === 'string' ? body.pseudo.trim() : '';
  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';

  try {
    const result =
      action === 'register'
        ? await accounts.register(pseudo, password)
        : await accounts.login(pseudo, password);
    logEvent(action === 'register' ? 'account_registered' : 'account_login', { pseudo });
    respondJson(res, action === 'register' ? 201 : 200, result);
  } catch (error) {
    const statusCode = action === 'login' ? 401 : 400;
    if (error instanceof AccountError) {
      respondJson(res, statusCode, { error: error.message });
      return;
    }
    logEvent('account_error', { action, reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}

export function handleLogout(
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  const token = getBearerToken(req);
  accounts.logout(token);
  respondJson(res, 200, { success: true });
}

export async function handleGetProfile(
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  const accountId = accounts.resolveToken(getBearerToken(req));
  if (accountId === undefined) {
    respondJson(res, 401, { error: 'Non authentifié.' });
    return;
  }

  const profile = await accounts.getProfile(accountId);
  if (!profile) {
    respondJson(res, 404, { error: 'Compte introuvable.' });
    return;
  }
  respondJson(res, 200, profile);
}

/** Choix d'avatar (refonte UI/UX, couleur de blob) — même schéma d'authentification que
 * `handleGetProfile` (token porteur), écrit puis renvoie le profil à jour. */
export async function handleUpdateAvatarColor(
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  const accountId = accounts.resolveToken(getBearerToken(req));
  if (accountId === undefined) {
    respondJson(res, 401, { error: 'Non authentifié.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const avatarColor =
    isRecord(body) && typeof body.avatarColor === 'string' ? body.avatarColor : '';

  try {
    const profile = await accounts.updateAvatarColor(accountId, avatarColor);
    if (!profile) {
      respondJson(res, 404, { error: 'Compte introuvable.' });
      return;
    }
    respondJson(res, 200, profile);
  } catch (error) {
    if (error instanceof AccountError) {
      respondJson(res, 400, { error: error.message });
      return;
    }
    logEvent('account_error', { action: 'update_avatar_color', reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}
