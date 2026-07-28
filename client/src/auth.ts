/** Client de l'API de comptes joueurs (Lot 3.2-3.6) — servie par le même process que le jeu
 * et le lobby (net/server.ts), pas de configuration d'origine à faire. */
export interface AuthResult {
  token: string;
  pseudo: string;
}

export interface BestScore {
  modeId: string;
  bestScore: number;
}

export interface AccountProfile {
  pseudo: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
  bestScores: BestScore[];
  /** Couleur d'avatar choisie (refonte UI/UX, avatar procédural) — `undefined` tant que le
   * joueur n'a rien choisi explicitement (voir `AVATAR_PALETTE`, `updateAvatarColor`). */
  avatarColor?: string;
}

async function postAuth(path: string, pseudo: string, password: string): Promise<AuthResult> {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pseudo, password }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Requête impossible.');
  }
  return (await response.json()) as AuthResult;
}

export function register(pseudo: string, password: string): Promise<AuthResult> {
  return postAuth('/api/auth/register', pseudo, password);
}

export function login(pseudo: string, password: string): Promise<AuthResult> {
  return postAuth('/api/auth/login', pseudo, password);
}

export async function fetchProfile(token: string): Promise<AccountProfile> {
  const response = await fetch('/api/account/me', {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'Profil inaccessible.');
  }
  return (await response.json()) as AccountProfile;
}

/** Choix d'avatar (refonte UI/UX) — renvoie le profil à jour, comme `fetchProfile`. */
export async function updateAvatarColor(
  token: string,
  avatarColor: string,
): Promise<AccountProfile> {
  const response = await fetch('/api/account/me', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ avatarColor }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Impossible d'enregistrer la couleur d'avatar.");
  }
  return (await response.json()) as AccountProfile;
}

const TOKEN_STORAGE_KEY = 'angulio.authToken';
const PSEUDO_STORAGE_KEY = 'angulio.authPseudo';

/** Persistée dans `localStorage` : survit à un rechargement de page (contrairement à une
 * variable en mémoire) — un joueur connecté le reste après un F5, jusqu'à déconnexion
 * explicite (pas d'expiration, voir sessionStore.ts côté serveur). */
export function saveSession(result: AuthResult): void {
  localStorage.setItem(TOKEN_STORAGE_KEY, result.token);
  localStorage.setItem(PSEUDO_STORAGE_KEY, result.pseudo);
}

export function loadSession(): AuthResult | undefined {
  const token = localStorage.getItem(TOKEN_STORAGE_KEY);
  const pseudo = localStorage.getItem(PSEUDO_STORAGE_KEY);
  return token && pseudo ? { token, pseudo } : undefined;
}

export function clearSession(): void {
  localStorage.removeItem(TOKEN_STORAGE_KEY);
  localStorage.removeItem(PSEUDO_STORAGE_KEY);
}
