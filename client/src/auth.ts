/** Client de l'API de comptes joueurs (Lot 3.2-3.6) — servie par le même process que le jeu
 * et le lobby (net/server.ts), pas de configuration d'origine à faire. */
import { SKIN_IMAGE_MAP, SKINS } from '@angulio/shared';

export interface AuthResult {
  token: string;
  pseudo: string;
}

export interface AvatarItem {
  id: string;
  name: string;
  url: string;
}

export async function fetchAvatars(): Promise<AvatarItem[]> {
  try {
    const res = await fetch('/api/avatars');
    if (res.ok) {
      const data = (await res.json()) as { avatars?: AvatarItem[] };
      if (Array.isArray(data.avatars) && data.avatars.length > 0) {
        for (const item of data.avatars) {
          SKIN_IMAGE_MAP[item.id] = item.url;
        }
        return data.avatars;
      }
    }
  } catch {}

  return SKINS.map((skin) => ({
    id: skin,
    name: skin,
    url: SKIN_IMAGE_MAP[skin] ?? `/assets/Profil/${skin}.png`,
  }));
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
  /** Écran de mort personnalisé (cahier des charges fourni) — toujours défini (valeurs par
   * défaut de la migration tant que le joueur n'a rien changé). */
  deathMessage: string;
  deathBannerId: string;
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

/** Réclame le score/XP d'une vie jouée en invité (voir `PENDING_SCORE_CLAIM_STORAGE_KEY` plus bas)
 * pour le compte qui vient de se créer ou de se connecter — `claimed: false` (jamais une erreur
 * levée) si le claim est inconnu/déjà réclamé/expiré côté serveur, voir routes/auth.ts
 * `handleClaimScore`. */
export async function claimScore(token: string, claimId: string): Promise<boolean> {
  const response = await fetch('/api/account/claim-score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ claimId }),
  });
  if (!response.ok) return false;
  const body = (await response.json().catch(() => ({}))) as { claimed?: boolean };
  return body.claimed ?? false;
}

/** Personnalisation de l'écran de mort (cahier des charges fourni) — renvoie le profil à jour. */
export async function updateDeathScreen(
  token: string,
  deathMessage: string,
  deathBannerId: string,
): Promise<AccountProfile> {
  const response = await fetch('/api/account/death-screen', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ deathMessage, deathBannerId }),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? "Impossible d'enregistrer l'écran de mort.");
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

const PENDING_SCORE_CLAIM_STORAGE_KEY = 'angulio.pendingScoreClaim';

/** Persiste l'identifiant de réclamation reçu à la mort (voir `DiedMessage.claimId`,
 * GameView.tsx) — survit à la navigation vers `/compte` (et à un rechargement de page) pour être
 * réclamé dès l'inscription/la connexion réussie (voir AccountPage.tsx). Jamais le score lui-même
 * (voir le commentaire de `claimScore`) : uniquement cet identifiant opaque. */
export function savePendingScoreClaim(claimId: string): void {
  localStorage.setItem(PENDING_SCORE_CLAIM_STORAGE_KEY, claimId);
}

export function loadPendingScoreClaim(): string | undefined {
  return localStorage.getItem(PENDING_SCORE_CLAIM_STORAGE_KEY) ?? undefined;
}

export function clearPendingScoreClaim(): void {
  localStorage.removeItem(PENDING_SCORE_CLAIM_STORAGE_KEY);
}
