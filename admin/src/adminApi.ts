/** Client de l'API HTTP admin (cahier_des_charges_admin.md) — servie par le même process que le
 * jeu (`net/server.ts`, routes `/api/admin/*`), pas de configuration d'origine à faire. Même
 * principe que `client/src/auth.ts`/`lobby.ts` côté client joueur, mais un token totalement
 * distinct (voir `AdminAuth`, jamais interchangeable avec un token de compte joueur). */
import type { AdminActionResult, AdminPlayerInfo, AdminRoomAction } from '@angulio/shared';

export interface BestScore {
  modeId: string;
  bestScore: number;
}

/** Attribution ponctuelle d'un boost à un compte (§12 cahier_des_charges_admin.md) — type réservé
 * pour la future Économie & Boosts, non exploité en v1 (aucun serveur n'envoie encore ce champ,
 * voir EconomyView.tsx) : présent uniquement pour éviter une migration de type le jour où la
 * fonctionnalité sera conçue. */
export interface BoostInstance {
  boostId: string;
  grantedAt: string;
  expiresAt?: string;
}

export interface AdminAccountView {
  id: number;
  pseudo: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
  banned: boolean;
  avatarColor?: string;
  deathMessage: string;
  deathBannerId: string;
  createdAt: string;
  lastLoginAt?: string;
  lastIp?: string;
  totalPlaytimeSec: number;
  bestScore?: number;
  /** Réservé §12 — non affiché tant qu'aucun serveur n'envoie de valeur (jamais présent en v1). */
  currencyBalance?: number;
  /** Réservé §12 — idem. */
  activeBoosts?: BoostInstance[];
}

export interface AdminAccountDetail extends AdminAccountView {
  bestScores: BestScore[];
}

export interface AdminAccountPatch {
  pseudo?: string;
  level?: number;
  xp?: number;
  premium?: boolean;
  cosmetics?: string[];
  banned?: boolean;
  avatarColor?: string;
  deathMessage?: string;
  deathBannerId?: string;
  newPassword?: string;
}

export interface AdminSearchQuery {
  q?: string;
  ip?: string;
  premium?: boolean;
  banned?: boolean;
  minLevel?: number;
  maxLevel?: number;
  minXp?: number;
  maxXp?: number;
  sortBy?: 'pseudo' | 'level' | 'xp' | 'createdAt' | 'lastLoginAt' | 'totalPlaytimeSec' | 'bestScore';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminSearchResponse {
  rows: AdminAccountView[];
  total: number;
}

export interface AdminRoomView {
  id: string;
  name: string;
  modId: string;
  visibility: 'public' | 'private';
  maxPlayers: number;
  /** Cadence de SIMULATION brute (charge CPU) — PAS ce qu'un viewer reçoit réellement, voir
   * `snapshotHz` (cahier_des_charges_admin.md §2.3/§17 : "la cadence affichée doit toujours être
   * la cadence réellement reçue"). */
  tickRateHz: number;
  /** Cadence RÉELLE des paquets `state` reçus par le canal admin — c'est CETTE valeur à afficher
   * dans "Salons & Écrans", jamais `tickRateHz`. */
  snapshotHz: number;
  stats: { playerCount: number; tickAvgMs: number; tickP95Ms: number; tickOverruns: number };
  players: Array<AdminPlayerInfo & { ping?: number }>;
}

async function parseErrorOr<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return (await response.json()) as T;
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

export async function adminLogin(username: string, password: string): Promise<string> {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const { token } = await parseErrorOr<{ token: string }>(response, 'Connexion impossible.');
  return token;
}

export async function searchAccounts(
  token: string,
  query: AdminSearchQuery,
): Promise<AdminSearchResponse> {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  const response = await fetch(`/api/admin/players?${params.toString()}`, {
    headers: authHeaders(token),
  });
  return parseErrorOr<AdminSearchResponse>(response, 'Recherche impossible.');
}

export async function getAccount(token: string, id: number): Promise<AdminAccountDetail> {
  const response = await fetch(`/api/admin/players/${id}`, { headers: authHeaders(token) });
  return parseErrorOr<AdminAccountDetail>(response, 'Compte introuvable.');
}

export async function updateAccount(
  token: string,
  id: number,
  patch: AdminAccountPatch,
): Promise<AdminAccountView> {
  const response = await fetch(`/api/admin/players/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(patch),
  });
  return parseErrorOr<AdminAccountView>(response, 'Mise à jour impossible.');
}

export async function resetBestScore(token: string, id: number, modeId?: string): Promise<void> {
  const response = await fetch(`/api/admin/players/${id}/reset-best-score`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ modeId }),
  });
  await parseErrorOr(response, 'Réinitialisation impossible.');
}

export async function listRooms(token: string): Promise<AdminRoomView[]> {
  const response = await fetch('/api/admin/rooms', { headers: authHeaders(token) });
  return parseErrorOr<AdminRoomView[]>(response, 'Liste des salons impossible.');
}

export interface BaseRoomConfig {
  name: string;
  modId: string;
}

/** Salons permanents de l'accueil (§8.4/§13 cahier_des_charges_admin.md, `server/rooms.json`) —
 * un changement ne prend effet qu'au prochain redémarrage du serveur (voir la note renvoyée par
 * `updateBaseRooms`, affichée telle quelle côté UI plutôt que de laisser croire à un effet
 * immédiat). */
export async function getBaseRooms(token: string): Promise<BaseRoomConfig[]> {
  const response = await fetch('/api/admin/base-rooms', { headers: authHeaders(token) });
  return parseErrorOr<BaseRoomConfig[]>(response, 'Liste des salons de base impossible.');
}

export async function updateBaseRooms(
  token: string,
  rooms: BaseRoomConfig[],
): Promise<{ success: boolean; note: string }> {
  const response = await fetch('/api/admin/base-rooms', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify(rooms),
  });
  return parseErrorOr<{ success: boolean; note: string }>(response, 'Mise à jour impossible.');
}

/** `GET /api/modes` — même route publique que le lobby joueur (pas d'info sensible, juste la
 * liste des ids de mods chargés côté serveur), réutilisée en lecture seule pour le module
 * Configuration (§13) : l'édition de profil demande une route admin dédiée, pas encore faite. */
export async function listModes(): Promise<string[]> {
  const response = await fetch('/api/modes');
  return parseErrorOr<string[]>(response, 'Liste des modes impossible.');
}

export async function runRoomAction(
  token: string,
  roomId: string,
  action: AdminRoomAction,
): Promise<AdminActionResult> {
  const response = await fetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/action`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ action }),
  });
  return parseErrorOr<AdminActionResult>(response, 'Action impossible.');
}

export async function kickPlayer(token: string, roomId: string, playerId: string): Promise<void> {
  const response = await fetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/kick`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ playerId }),
  });
  await parseErrorOr(response, 'Expulsion impossible.');
}

export async function transferPlayer(
  token: string,
  roomId: string,
  playerId: string,
  targetRoomId: string,
): Promise<void> {
  const response = await fetch(`/api/admin/rooms/${encodeURIComponent(roomId)}/transfer`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ playerId, targetRoomId }),
  });
  await parseErrorOr(response, 'Transfert impossible.');
}

export async function broadcastMessage(
  token: string,
  text: string,
  options: { color?: string; durationMs?: number; roomId?: string } = {},
): Promise<{ sent: number }> {
  const response = await fetch('/api/admin/broadcast', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders(token) },
    body: JSON.stringify({ text, ...options }),
  });
  return parseErrorOr<{ sent: number }>(response, 'Diffusion impossible.');
}

const TOKEN_STORAGE_KEY = 'angulio.adminToken';

export function saveAdminSession(token: string): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, token);
}

export function loadAdminSession(): string | undefined {
  return localStorage.getItem(TOKEN_STORAGE_KEY) ?? undefined;
}

export function clearAdminSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
}
