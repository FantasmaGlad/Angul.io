import { randomBytes } from 'node:crypto';

export interface SessionData {
  accountId: number;
  createdAt: number;
}

export interface SessionStore {
  createSession(accountId: number): string;
  /** `undefined` si le token est inconnu, expiré ou révoqué. */
  resolveSession(token: string): number | undefined;
  revokeSession(token: string): void;
  /** Révoque toutes les sessions actives d'un compte (Lot 5.2). */
  revokeSessionsForAccount(accountId: number): void;
}

const DEFAULT_SESSION_TTL_MS = 30 * 24 * 60 * 60_000; // 30 jours

/**
 * Sessions en mémoire (token opaque -> session) avec expiration automatique après 24h.
 */
export function createSessionStore(ttlMs: number = DEFAULT_SESSION_TTL_MS): SessionStore {
  const sessionsByToken = new Map<string, SessionData>();

  return {
    createSession(accountId: number): string {
      const token = randomBytes(32).toString('hex');
      sessionsByToken.set(token, { accountId, createdAt: Date.now() });
      return token;
    },
    resolveSession(token: string): number | undefined {
      const session = sessionsByToken.get(token);
      if (!session) return undefined;

      if (Date.now() - session.createdAt > ttlMs) {
        sessionsByToken.delete(token);
        return undefined;
      }

      return session.accountId;
    },
    revokeSession(token: string): void {
      sessionsByToken.delete(token);
    },
    revokeSessionsForAccount(accountId: number): void {
      for (const [token, session] of sessionsByToken) {
        if (session.accountId === accountId) sessionsByToken.delete(token);
      }
    },
  };
}
