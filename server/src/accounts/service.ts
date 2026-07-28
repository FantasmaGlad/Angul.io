import type { Pool } from 'pg';
import { isValidAvatarColor } from '@angulio/shared';
import {
  AccountsRepository,
  PseudoTakenError,
  type AccountRow,
  type AdminAccountPatch,
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
}

/** Vue d'un compte destinée à l'interface admin (Lot 5.2-5.4) — inclut `id` (nécessaire pour
 * cibler les endpoints admin) et `banned`, jamais exposés au profil joueur lui-même
 * (`AccountProfile`) ; n'expose jamais `passwordHash`. */
export interface AdminAccountView {
  id: number;
  pseudo: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
  banned: boolean;
}

/** Vue admin détaillée d'un compte, avec ses meilleurs scores (Lot 5.2, "consultation"). */
export interface AdminAccountDetail extends AdminAccountView {
  bestScores: BestScore[];
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

  // --- Interface admin (Lot 5.2-5.4) --------------------------------------------------------

  /** `query` vide liste les premiers comptes par ordre alphabétique (voir
   * `AccountsRepository.searchByPseudo`) — pratique pour parcourir la base depuis l'admin. */
  async searchAccountsForAdmin(query: string): Promise<AdminAccountView[]> {
    const rows = await this.repository.searchByPseudo(query);
    return rows.map(toAdminView);
  }

  async getAccountForAdmin(accountId: number): Promise<AdminAccountDetail | undefined> {
    const account = await this.repository.findById(accountId);
    if (!account) return undefined;
    const bestScores = await this.repository.getBestScores(accountId);
    return { ...toAdminView(account), bestScores };
  }

  /** Correction manuelle admin (Lot 5.2 bannissement, 5.3 XP/niveau, 5.4 cosmétiques/Premium) —
   * une seule route pour les quatre, le patch ne contient que les champs à modifier. Bannir
   * révoque immédiatement les sessions actives du compte (voir `SessionStore`) : sans ça, un
   * joueur banni resterait connecté jusqu'à sa prochaine reconnexion. */
  async updateAccountForAdmin(
    accountId: number,
    patch: AdminAccountPatch,
  ): Promise<AdminAccountView | undefined> {
    validateAdminPatch(patch);
    const updated = await this.repository.adminUpdateAccount(accountId, patch);
    if (!updated) return undefined;
    if (patch.banned === true) this.sessions.revokeSessionsForAccount(accountId);
    return toAdminView(updated);
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
  };
}

/** Correction manuelle admin : erreurs "attendues" mêmes principes que `validatePseudo`/
 * `validatePassword` (traduites en 400 par net/server.ts), pas des bugs serveur. Bornes larges
 * (pas de vraie règle métier derrière) — juste de quoi empêcher une valeur absurde tapée par
 * erreur dans le formulaire admin (ex. XP négatif) de corrompre durablement un compte. */
function validateAdminPatch(patch: AdminAccountPatch): void {
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
