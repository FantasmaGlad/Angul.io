import type { Pool } from 'pg';
import { AccountsRepository, PseudoTakenError } from './accountsRepository.js';
import { xpForScore } from './levels.js';
import { hashPassword, verifyPassword } from './passwords.js';
import { createSessionStore, type SessionStore } from './sessionStore.js';

const MIN_PSEUDO_LENGTH = 3;
const MAX_PSEUDO_LENGTH = 20;
const MIN_PASSWORD_LENGTH = 8;

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
    return { token: this.sessions.createSession(account.id), pseudo: account.pseudo };
  }

  /** `undefined` si le token est absent/inconnu — appelant traite ça comme "non authentifié",
   * jamais comme une erreur (un salon reste jouable en invité, voir Lot 2). */
  resolveToken(token: string | undefined): number | undefined {
    return token ? this.sessions.resolveSession(token) : undefined;
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
    };
  }

  /** Lot 3.5 — appelé à la mort/déconnexion d'un joueur authentifié avec la masse maximale
   * atteinte pendant cette vie (voir net/server.ts) comme "score" (aucun système de score dédié
   * n'existe à ce jour, voir levels.ts). */
  async recordGameResult(accountId: number, modeId: string, score: number): Promise<void> {
    await this.repository.recordGameResult(accountId, modeId, Math.round(score), xpForScore(score));
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
