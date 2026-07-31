import type { IncomingMessage, ServerResponse } from 'node:http';
import { AccountError, type AccountsService } from '../../../accounts/service.js';
import { logEvent } from '../../../log.js';
import { RateLimiter } from '../../rateLimiter.js';
import { getBearerToken, getClientIp, isRecord, readJsonBody, respondJson } from '../httpUtils.js';

/** Plafond dédié à `handleUpdateDeathScreen` (une bannière personnalisée en data URL base64 peut
 * dépasser de loin la limite JSON générique, voir httpUtils.ts) — couvre le fichier max accepté
 * côté client (5 Mo, voir ProfilePage.tsx) une fois encodé en base64 (facteur ~4/3) avec de la
 * marge pour l'enveloppe JSON. */
const MAX_DEATH_SCREEN_BODY_BYTES = 8_000_000;

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

/** Réclame le score/XP d'une vie jouée en invité (voir `AccountsService.createScoreClaim`,
 * `DiedMessage.claimId`) pour le compte qui vient de se créer ou de se connecter — appelé par le
 * client juste après `register`/`login` s'il trouve un claim en attente en `localStorage` (voir
 * AccountPage.tsx). Aucun montant dans le corps de la requête : uniquement l'identifiant opaque,
 * le serveur seul connaît/valide le score réel associé (voir le commentaire de
 * `createScoreClaim` sur pourquoi). Un claim inconnu/déjà réclamé/expiré n'est jamais une erreur
 * (`claimed: false`) — l'inscription/connexion elle-même a déjà réussi à ce stade, ce n'est pas à
 * cette route de la faire échouer. */
export async function handleClaimScore(
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

  const claimId = isRecord(body) && typeof body.claimId === 'string' ? body.claimId : '';
  if (!claimId) {
    respondJson(res, 400, { error: 'claimId manquant.' });
    return;
  }

  try {
    const claimed = await accounts.claimScore(claimId, accountId);
    respondJson(res, 200, { claimed });
  } catch (error) {
    logEvent('account_error', { action: 'claim_score', reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
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

/** Personnalisation de l'écran de mort (cahier des charges fourni) — message + bannière,
 * rate-limité séparément de l'auth (10 modifications/minute par IP, un joueur qui teste des
 * bannières en repoussant "Enregistrer" ne doit pas se faire bloquer comme une attaque de
 * force brute sur le login). */
export async function handleUpdateDeathScreen(
  accounts: AccountsService | undefined,
  rateLimiter: RateLimiter,
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
  if (!rateLimiter.consume(clientIp)) {
    logEvent('death_screen_rate_limited', { ip: clientIp });
    respondJson(res, 429, { error: 'Trop de modifications. Réessaie dans une minute.' });
    return;
  }

  const accountId = accounts.resolveToken(getBearerToken(req));
  if (accountId === undefined) {
    respondJson(res, 401, { error: 'Non authentifié.' });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req, MAX_DEATH_SCREEN_BODY_BYTES);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const deathMessage =
    isRecord(body) && typeof body.deathMessage === 'string' ? body.deathMessage : '';
  const deathBannerId =
    isRecord(body) && typeof body.deathBannerId === 'string' ? body.deathBannerId : '';

  try {
    const profile = await accounts.updateDeathScreen(accountId, { deathMessage, deathBannerId });
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
    logEvent('account_error', {
      action: 'update_death_screen',
      reason: (error as Error).message,
    });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}
