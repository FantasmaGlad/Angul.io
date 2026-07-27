import { randomBytes } from 'node:crypto';

export interface SessionStore {
  createSession(accountId: number): string;
  /** `undefined` si le token est inconnu ou a été révoqué. */
  resolveSession(token: string): number | undefined;
  revokeSession(token: string): void;
  /** Révoque toutes les sessions actives d'un compte (Lot 5.2) — utilisé quand l'admin bannit un
   * compte : sans ça, un token déjà émis resterait valide jusqu'à expiration naturelle (qui
   * n'existe pas, voir plus bas), permettant à un compte banni de continuer à jouer tant qu'il ne
   * se reconnecte pas. */
  revokeSessionsForAccount(accountId: number): void;
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
    revokeSessionsForAccount(accountId: number): void {
      for (const [token, id] of accountIdByToken) {
        if (id === accountId) accountIdByToken.delete(token);
      }
    },
  };
}
