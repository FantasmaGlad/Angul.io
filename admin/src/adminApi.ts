/** Client de l'API HTTP admin (Lot 5) — servie par le même process que le jeu (`net/server.ts`,
 * routes `/api/admin/*`), pas de configuration d'origine à faire. Même principe que
 * `client/src/auth.ts`/`lobby.ts` côté client joueur, mais un token totalement distinct (voir
 * `AdminAuth`, jamais interchangeable avec un token de compte joueur). */

export interface BestScore {
  modeId: string;
  bestScore: number;
}

export interface AdminAccountView {
  id: number;
  pseudo: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
  banned: boolean;
}

export interface AdminAccountDetail extends AdminAccountView {
  bestScores: BestScore[];
}

export interface AdminAccountPatch {
  level?: number;
  xp?: number;
  premium?: boolean;
  cosmetics?: string[];
  banned?: boolean;
}

async function parseErrorOr<T>(response: Response, fallback: string): Promise<T> {
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? fallback);
  }
  return (await response.json()) as T;
}

export async function adminLogin(password: string): Promise<string> {
  const response = await fetch('/api/admin/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  });
  const { token } = await parseErrorOr<{ token: string }>(response, 'Connexion impossible.');
  return token;
}

export async function searchAccounts(token: string, query: string): Promise<AdminAccountView[]> {
  const response = await fetch(`/api/admin/players?q=${encodeURIComponent(query)}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseErrorOr<AdminAccountView[]>(response, 'Recherche impossible.');
}

export async function getAccount(token: string, id: number): Promise<AdminAccountDetail> {
  const response = await fetch(`/api/admin/players/${id}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  return parseErrorOr<AdminAccountDetail>(response, 'Compte introuvable.');
}

export async function updateAccount(
  token: string,
  id: number,
  patch: AdminAccountPatch,
): Promise<AdminAccountView> {
  const response = await fetch(`/api/admin/players/${id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify(patch),
  });
  return parseErrorOr<AdminAccountView>(response, 'Mise à jour impossible.');
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
