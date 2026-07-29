import type { Pool } from 'pg';
import {
  isValidAvatarColor,
  isDeathBannerUnlocked,
  MAX_DEATH_MESSAGE_LENGTH,
} from '@angulio/shared';
import {
  AccountsRepository,
  PseudoTakenError,
  type AccountRow,
  type AdminAccountPatch as RepoAdminAccountPatch,
  type AdminSearchParams,
  type DeathScreenPatch,
} from './accountsRepository.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createSessionStore, type SessionStore } from './sessionStore.js';

const MIN_PSEUDO_LENGTH = 3;
const MAX_PSEUDO_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 8;
const MAX_COSMETIC_LENGTH = 40;
const MAX_COSMETICS_COUNT = 50;

export interface AuthResult {
  token: string;
  pseudo: string;
}

export interface BestScore {
  modeId: string;
  bestScore: number;
}

/** Une ligne du classement public (Lot "Classements") — voir `AccountsService.getLeaderboard`. */
export interface LeaderboardEntry {
  rank: number;
  pseudo: string;
  level: number;
  avatarColor?: string;
  score: number;
}

export interface AccountProfile {
  pseudo: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
  bestScores: BestScore[];
  /** Couleur d'avatar choisie (refonte UI/UX) — `undefined` tant que le joueur n'a rien choisi
   * explicitement, voir `AVATAR_PALETTE`/`colorForNickname`. */
  avatarColor?: string;
  /** Écran de mort personnalisé (cahier des charges fourni) — toujours défini, initialisé aux
   * valeurs par défaut de la migration (`death_message`/`death_banner_id`). */
  deathMessage: string;
  deathBannerId: string;
}

/** Vue d'un compte destinée à l'interface admin (cahier_des_charges_admin.md §3.1-3.2) — inclut
 * `id` (nécessaire pour cibler les endpoints admin), `banned`, IP/dates de connexion et temps de
 * jeu (recherche/tri §3.1), jamais exposés au profil joueur lui-même (`AccountProfile`) ; n'expose
 * jamais `passwordHash`. */
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
  /** Absent d'une réponse `updateAccountForAdmin` (pas requêté, changerait rarement suite à une
   * simple correction de profil) — toujours présent depuis `searchAccountsForAdmin`/
   * `getAccountForAdmin`. */
  bestScore?: number;
}

/** Vue admin détaillée d'un compte, avec ses meilleurs scores (§3.2, "consultation"). */
export interface AdminAccountDetail extends AdminAccountView {
  bestScores: BestScore[];
}

/** Correction manuelle admin (§3.2) — `newPassword` est en clair ici uniquement en transit
 * process (jamais écrit sur disque/log) : haché par `updateAccountForAdmin` avant tout appel au
 * repository, qui ne connaît que des hash (voir `RepoAdminAccountPatch.passwordHash`). */
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
  sortBy?: AdminSearchParams['sortBy'];
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminSearchResponse {
  rows: AdminAccountView[];
  total: number;
}

/** Erreur "attendue" (pseudo pris, identifiants invalides, validation) — distincte d'une erreur
 * technique : la couche HTTP (net/server.ts) la traduit en 400/401 avec `error.message`
 * directement affichable, plutôt que de la traiter comme un bug serveur (500). */
export class AccountError extends Error {}

/**
 * Point d'entrée unique pour tout ce qui touche aux comptes joueurs (Lot 3.2-3.6) : inscription,
 * connexion, résolution de session, profil, écriture des stats en fin de partie. `net/server.ts`
 * ne connaît que cette classe, jamais `AccountsRepository`/`SessionStore` directement — même
 * principe d'indirection que `RoomManager` pour les salons.
 */
export class AccountsService {
  private readonly repository: AccountsRepository;
  private readonly sessions: SessionStore;

  constructor(pool: Pool) {
    this.repository = new AccountsRepository(pool);
    this.sessions = createSessionStore();
  }

  async register(pseudo: string, password: string): Promise<AuthResult> {
    validatePseudo(pseudo);
    validatePassword(password);

    const passwordHash = await hashPassword(password);
    try {
      const account = await this.repository.createAccount(pseudo, passwordHash);
      return { token: this.sessions.createSession(account.id), pseudo: account.pseudo };
    } catch (error) {
      if (error instanceof PseudoTakenError) throw new AccountError(error.message);
      throw error;
    }
  }

  async login(pseudo: string, password: string): Promise<AuthResult> {
    const account = await this.repository.findByPseudo(pseudo);
    if (!account || !(await verifyPassword(account.passwordHash, password))) {
      // Même message que le pseudo existe ou non : ne pas révéler quels pseudos sont pris via
      // le message d'erreur de connexion (l'inscription, elle, le révèle nécessairement).
      throw new AccountError('Pseudo ou mot de passe incorrect.');
    }
    // Vérifié après le mot de passe (Lot 5.2) : ce message ne fuit donc rien à qui ne connaît
    // pas déjà le bon mot de passe, contrairement au message générique ci-dessus.
    if (account.banned) throw new AccountError('Ce compte a été banni.');
    return { token: this.sessions.createSession(account.id), pseudo: account.pseudo };
  }

  /** `undefined` si le token est absent/inconnu — appelant traite ça comme "non authentifié",
   * jamais comme une erreur (un salon reste jouable en invité, voir Lot 2). */
  resolveToken(token: string | undefined): number | undefined {
    return token ? this.sessions.resolveSession(token) : undefined;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.revokeSession(token);
  }

  async getProfile(accountId: number): Promise<AccountProfile | undefined> {
    const account = await this.repository.findById(accountId);
    if (!account) return undefined;
    const bestScores = await this.repository.getBestScores(accountId);
    return {
      pseudo: account.pseudo,
      level: account.level,
      xp: account.xp,
      premium: account.premium,
      cosmetics: account.cosmetics,
      bestScores,
      avatarColor: account.avatarColor ?? undefined,
      deathMessage: account.deathMessage,
      deathBannerId: account.deathBannerId,
    };
  }

  /** Couleur de blob à diffuser aux autres joueurs à la connexion (voir connectionHandler.ts) —
   * lecture dédiée, plus légère que `getProfile` (pas de requête `bestScores`) puisqu'elle est
   * appelée à chaque `join`/reconnexion, pas seulement à l'ouverture de la page Profil. */
  async getAvatarColor(accountId: number): Promise<string | undefined> {
    const account = await this.repository.findById(accountId);
    return account?.avatarColor ?? undefined;
  }

  /** Choix d'avatar (refonte UI/UX) — `color` doit appartenir à `AVATAR_PALETTE` (validation
   * stricte côté serveur, même esprit que `validateAdminPatch` : jamais faire confiance à une
   * valeur arbitraire envoyée par le client pour un champ affiché à tous les autres joueurs). */
  async updateAvatarColor(accountId: number, color: string): Promise<AccountProfile | undefined> {
    if (!isValidAvatarColor(color)) {
      throw new AccountError("Couleur d'avatar invalide.");
    }
    const updated = await this.repository.updateAvatarColor(accountId, color);
    if (!updated) return undefined;
    return this.getProfile(accountId);
  }

  /** IP + horodatage de connexion (§3.1, recherche/tri admin) — appelé au join réussi (voir
   * connectionHandler.ts), ne doit jamais faire échouer la connexion elle-même (voir l'appelant,
   * qui n'attend pas cette promesse). */
  async recordLogin(accountId: number, ip: string | undefined): Promise<void> {
    await this.repository.recordLogin(accountId, ip);
  }

  /** Cumule le temps de jeu total (§3.1) — appelé à la déconnexion avec la durée de la session en
   * secondes (voir connectionHandler.ts). */
  async addPlaytime(accountId: number, seconds: number): Promise<void> {
    await this.repository.addPlaytime(accountId, seconds);
  }

  /** Carte d'écran de mort à diffuser au moment où le joueur meurt (voir broadcast.ts) — lecture
   * dédiée, plus légère que `getProfile` (pas de requête `bestScores`) puisqu'elle est appelée à
   * chaque mort, pas seulement à l'ouverture de la page Profil. `undefined` pour un compte
   * introuvable (déconnecté entre-temps) — l'appelant retombe alors sur les valeurs par défaut,
   * comme pour un invité. */
  async getDeathScreenCard(
    accountId: number,
  ): Promise<{ message: string; bannerId: string } | undefined> {
    const account = await this.repository.findById(accountId);
    if (!account) return undefined;
    return { message: account.deathMessage, bannerId: account.deathBannerId };
  }

  /** Personnalisation de l'écran de mort (cahier des charges fourni) — sanitisation du message
   * (balises HTML retirées, longueur bornée) et bannière vérifiée contre le catalogue ET le
   * niveau du compte (jamais faire confiance à un id envoyé par le client, même s'il correspond
   * à une bannière qui existe : encore faut-il qu'elle soit déverrouillée pour CE compte). */
  async updateDeathScreen(
    accountId: number,
    patch: DeathScreenPatch,
  ): Promise<AccountProfile | undefined> {
    const message = sanitizeDeathMessage(patch.deathMessage);
    const account = await this.repository.findById(accountId);
    if (!account) return undefined;
    if (!isDeathBannerUnlocked(patch.deathBannerId, account.level)) {
      throw new AccountError("Cette bannière n'est pas déverrouillée à ton niveau actuel.");
    }
    const updated = await this.repository.updateDeathScreen(accountId, {
      deathMessage: message,
      deathBannerId: patch.deathBannerId,
    });
    if (!updated) return undefined;
    return this.getProfile(accountId);
  }

  /** Lot 3.5 — appelé à la mort/déconnexion d'un joueur authentifié : `score` est la masse
   * maximale atteinte pendant cette vie (crédité à `player_best_scores`), `xpEarned` est l'XP
   * accumulée pendant cette même vie (masse mangée + joueurs mangés + combo, voir
   * `engine/xp.ts` — déjà calculée par le moteur, pas recalculée ici) ; les deux transitent déjà
   * par `GameMod.transformScoreForAccount` côté appelant (net/server.ts) avant d'arriver ici. */
  async recordGameResult(
    accountId: number,
    modeId: string,
    score: number,
    xpEarned: number,
  ): Promise<void> {
    await this.repository.recordGameResult(
      accountId,
      modeId,
      Math.round(score),
      Math.max(0, Math.round(xpEarned)),
    );
  }

  /** Lot 6.4 — un compte non-Premium (ou un invité, `accountId` `undefined`) ne peut pas créer
   * de salon (cahier des charges §5.3) ; `false` pour un compte introuvable plutôt qu'une
   * exception, net/server.ts traite les deux cas de la même façon (403). */
  async isPremium(accountId: number | undefined): Promise<boolean> {
    if (accountId === undefined) return false;
    const account = await this.repository.findById(accountId);
    return account?.premium ?? false;
  }

  /** Classement public (Lot "Classements") — `modeId` omis pour le classement global (par XP
   * totale), fourni pour le classement d'un mode précis (par meilleur score). `limit` est borné
   * ici (pas seulement côté route) : point d'entrée unique, une future autre route ne doit pas
   * pouvoir redemander un classement de 10 000 lignes par erreur. */
  async getLeaderboard(modeId: string | undefined, limit: number): Promise<LeaderboardEntry[]> {
    const boundedLimit = Math.min(Math.max(Math.trunc(limit) || 50, 1), 100);
    const rows = await this.repository.getLeaderboard(modeId, boundedLimit);
    return rows.map((row, index) => ({
      rank: index + 1,
      pseudo: row.pseudo,
      level: row.level,
      avatarColor: row.avatarColor ?? undefined,
      score: row.score,
    }));
  }

  // --- Interface admin (cahier_des_charges_admin.md §3.1-3.2) --------------------------------

  /** Recherche/filtrage/tri paginé (§3.1) — voir `AccountsRepository.searchAdmin`. */
  async searchAccountsForAdmin(query: AdminSearchQuery): Promise<AdminSearchResponse> {
    const { rows, total } = await this.repository.searchAdmin(query as AdminSearchParams);
    return { rows: rows.map((row) => ({ ...toAdminView(row), bestScore: row.bestScore })), total };
  }

  async getAccountForAdmin(accountId: number): Promise<AdminAccountDetail | undefined> {
    const account = await this.repository.findById(accountId);
    if (!account) return undefined;
    const bestScores = await this.repository.getBestScores(accountId);
    const bestScore = bestScores.reduce((max, s) => Math.max(max, s.bestScore), 0);
    return { ...toAdminView(account), bestScore, bestScores };
  }

  /** Correction manuelle admin (§3.2 : pseudo, bannissement, XP/niveau, cosmétiques,
   * Premium, couleur d'avatar, écran de mort, réinitialisation de mot de passe) — une seule
   * route pour tous ces champs, le patch ne contient que ceux à modifier. Bannir révoque
   * immédiatement les sessions actives du compte (voir `SessionStore`) : sans ça, un joueur banni
   * resterait connecté jusqu'à sa prochaine reconnexion. Un changement de mot de passe révoque de
   * la même façon ses sessions actives (cohérent avec un changement de mot de passe volontaire). */
  async updateAccountForAdmin(
    accountId: number,
    patch: AdminAccountPatch,
  ): Promise<AdminAccountView | undefined> {
    validateAdminPatch(patch);
    const repoPatch: RepoAdminAccountPatch = {
      pseudo: patch.pseudo,
      level: patch.level,
      xp: patch.xp,
      premium: patch.premium,
      cosmetics: patch.cosmetics,
      banned: patch.banned,
      avatarColor: patch.avatarColor,
      deathMessage: patch.deathMessage,
      deathBannerId: patch.deathBannerId,
      passwordHash: patch.newPassword ? await hashPassword(patch.newPassword) : undefined,
    };
    try {
      const updated = await this.repository.adminUpdateAccount(accountId, repoPatch);
      if (!updated) return undefined;
      if (patch.banned === true || patch.newPassword) {
        this.sessions.revokeSessionsForAccount(accountId);
      }
      return toAdminView(updated);
    } catch (error) {
      if (error instanceof PseudoTakenError) throw new AccountError(error.message);
      throw error;
    }
  }

  /** Réinitialise le meilleur score d'un mode (ou de tous les modes si omis) — §3.2. */
  async resetBestScoreForAdmin(accountId: number, modeId?: string): Promise<void> {
    await this.repository.resetBestScore(accountId, modeId);
  }
}

function toAdminView(account: AccountRow): AdminAccountView {
  return {
    id: account.id,
    pseudo: account.pseudo,
    level: account.level,
    xp: account.xp,
    premium: account.premium,
    cosmetics: account.cosmetics,
    banned: account.banned,
    avatarColor: account.avatarColor ?? undefined,
    deathMessage: account.deathMessage,
    deathBannerId: account.deathBannerId,
    createdAt: account.createdAt,
    lastLoginAt: account.lastLoginAt ?? undefined,
    lastIp: account.lastIp ?? undefined,
    totalPlaytimeSec: account.totalPlaytimeSec,
  };
}

/** Correction manuelle admin : erreurs "attendues" mêmes principes que `validatePseudo`/
 * `validatePassword` (traduites en 400 par net/server.ts), pas des bugs serveur. Bornes larges
 * (pas de vraie règle métier derrière) — juste de quoi empêcher une valeur absurde tapée par
 * erreur dans le formulaire admin (ex. XP négatif) de corrompre durablement un compte. */
function validateAdminPatch(patch: AdminAccountPatch): void {
  if (patch.pseudo !== undefined) validatePseudo(patch.pseudo);
  if (patch.newPassword !== undefined) validatePassword(patch.newPassword);
  if (patch.level !== undefined && (!Number.isInteger(patch.level) || patch.level < 1)) {
    throw new AccountError('Le niveau doit être un entier positif.');
  }
  if (patch.xp !== undefined && (!Number.isInteger(patch.xp) || patch.xp < 0)) {
    throw new AccountError("L'XP doit être un entier positif ou nul.");
  }
  if (patch.cosmetics !== undefined) {
    if (patch.cosmetics.length > MAX_COSMETICS_COUNT) {
      throw new AccountError(`Au maximum ${MAX_COSMETICS_COUNT} cosmétiques par compte.`);
    }
    if (
      patch.cosmetics.some(
        (c) => typeof c !== 'string' || c.length === 0 || c.length > MAX_COSMETIC_LENGTH,
      )
    ) {
      throw new AccountError(
        `Chaque cosmétique doit être un texte de 1 à ${MAX_COSMETIC_LENGTH} caractères.`,
      );
    }
  }
}

/** Retire toute balise HTML (anti-XSS, cahier des charges fourni) et borne la longueur — défense
 * en profondeur : React échappe déjà le texte affiché (`{message}` en JSX, jamais
 * `dangerouslySetInnerHTML`), mais ce champ est un texte libre écrit par un joueur et lu par
 * d'autres, autant ne jamais faire confiance à ce qu'il contient une fois stocké. */
function sanitizeDeathMessage(raw: string): string {
  const stripped = raw.replace(/<[^>]*>/g, '').trim();
  if (stripped.length === 0) {
    throw new AccountError('Le message ne peut pas être vide.');
  }
  if (stripped.length > MAX_DEATH_MESSAGE_LENGTH) {
    throw new AccountError(
      `Le message doit faire au maximum ${MAX_DEATH_MESSAGE_LENGTH} caractères.`,
    );
  }
  return stripped;
}

function validatePseudo(pseudo: string): void {
  if (pseudo.length < MIN_PSEUDO_LENGTH || pseudo.length > MAX_PSEUDO_LENGTH) {
    throw new AccountError(
      `Le pseudo doit faire entre ${MIN_PSEUDO_LENGTH} et ${MAX_PSEUDO_LENGTH} caractères.`,
    );
  }
}

function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new AccountError(
      `Le mot de passe doit faire au moins ${MIN_PASSWORD_LENGTH} caractères.`,
    );
  }
}
