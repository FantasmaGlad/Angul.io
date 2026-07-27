import { verifyPassword } from '../accounts/passwords.js';
import { createSessionStore, type SessionStore } from '../accounts/sessionStore.js';

/** Id de compte conceptuel utilisé en interne pour la session admin — un seul "compte" possible
 * pour le MVP (cahier des charges §5.4 : "compte admin unique"), jamais exposé en dehors de ce
 * module. Réutilise le même magasin de sessions en mémoire par token opaque que les comptes
 * joueurs (`sessionStore.ts`) plutôt qu'un mécanisme dédié : même principe (token -> id), pas de
 * dépendance supplémentaire pour une seule identité. */
const ADMIN_SESSION_ID = 0;

/**
 * Authentification admin (Lot 5.1) — entièrement séparée de `AccountsService` : pas de ligne en
 * base, un unique mot de passe haché fourni via la variable d'environnement
 * `ADMIN_PASSWORD_HASH` (voir `server/scripts/hashPassword.mjs` pour la générer). Optionnelle
 * comme `AccountsService` : sans hash configuré, l'interface admin répond 503 plutôt que de
 * planter au démarrage (cohérent avec `GameServerOptions.accounts`).
 */
export class AdminAuth {
  private readonly sessions: SessionStore = createSessionStore();

  constructor(private readonly passwordHash: string | undefined) {}

  get isConfigured(): boolean {
    return this.passwordHash !== undefined;
  }

  /** `undefined` si non configuré ou mot de passe incorrect — net/server.ts traduit les deux en
   * réponses HTTP distinctes (503 vs 401). */
  async login(password: string): Promise<string | undefined> {
    if (!this.passwordHash) return undefined;
    const valid = await verifyPassword(this.passwordHash, password);
    return valid ? this.sessions.createSession(ADMIN_SESSION_ID) : undefined;
  }

  isAuthenticated(token: string | undefined): boolean {
    if (!token) return false;
    return this.sessions.resolveSession(token) === ADMIN_SESSION_ID;
  }
}
