import { randomBytes } from 'node:crypto';

export interface SessionStore {
  createSession(accountId: number): string;
  /** `undefined` si le token est inconnu ou a été révoqué. */
  resolveSession(token: string): number | undefined;
  revokeSession(token: string): void;
}

/**
 * Sessions en mémoire (token opaque -> id de compte) — pas de JWT ni de dépendance
 * supplémentaire, cohérent avec le reste du projet (RoomManager est lui aussi un registre en
 * mémoire, ws+http natifs plutôt qu'un framework). Perdues au redémarrage du serveur : un
 * joueur connecté doit se reconnecter — acceptable pour un MVP mono-nœud, à revoir si jamais un
 * jour plusieurs instances serveur doivent partager les sessions (Lot 10, scaling multi-Wyse).
 * Pas d'expiration pour l'instant : aucun besoin mesuré (voir CLAUDE.md/plan — ne pas anticiper
 * une fonctionnalité sans besoin concret).
 */
export function createSessionStore(): SessionStore {
  const accountIdByToken = new Map<string, number>();

  return {
    createSession(accountId: number): string {
      const token = randomBytes(32).toString('hex');
      accountIdByToken.set(token, accountId);
      return token;
    },
    resolveSession(token: string): number | undefined {
      return accountIdByToken.get(token);
    },
    revokeSession(token: string): void {
      accountIdByToken.delete(token);
    },
  };
}
