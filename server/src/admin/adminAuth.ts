import { verifyPassword } from '../accounts/passwords.js';
import { createSessionStore, type SessionStore } from '../accounts/sessionStore.js';
import type { AdminUsersRepository } from './adminUsersRepository.js';

/** Id de session réservé au compte de secours historique (`ADMIN_PASSWORD_HASH`, voir plus bas)
 * — jamais attribué par `admin_users` (clé `serial`, commence à 1), donc aucune collision
 * possible avec un vrai compte nommé en base. */
const LEGACY_SESSION_ID = 0;
/** Pseudo réservé pour se connecter avec `ADMIN_PASSWORD_HASH` plutôt qu'un compte nommé — évite
 * d'introduire un troisième paramètre de connexion (case "pas de nom d'utilisateur") côté client. */
const LEGACY_USERNAME = 'admin';

/**
 * Authentification admin (cahier_des_charges_admin.md §2) — comptes nommés en base
 * (`admin_users`, voir `AdminUsersRepository`), un par administrateur (ex. "Fantadmin"). Le mot de
 * passe unique historique fourni via `ADMIN_PASSWORD_HASH` (voir `server/scripts/hashPassword.mjs`)
 * reste supporté en repli sous le pseudo réservé `admin` : sans ça, un déploiement existant qui n'a
 * pas encore créé de compte nommé perdrait tout accès admin après cette migration. Optionnelle
 * comme `AccountsService` : sans aucun des deux configurés, l'interface admin répond 503 plutôt
 * que de planter au démarrage.
 */
export class AdminAuth {
  private readonly sessions: SessionStore = createSessionStore();

  constructor(
    private readonly legacyPasswordHash: string | undefined,
    private readonly users?: AdminUsersRepository,
  ) {}

  get isConfigured(): boolean {
    return this.legacyPasswordHash !== undefined || this.users !== undefined;
  }

  /** `undefined` si non configuré ou identifiants incorrects — net/server.ts traduit les deux en
   * réponses HTTP distinctes (503 vs 401). Le compte nommé est vérifié en premier : un
   * administrateur qui choisirait "admin" comme pseudo (peu probable, réservé) primerait sinon
   * silencieusement sur le repli historique. */
  async login(username: string, password: string): Promise<string | undefined> {
    const account = this.users ? await this.users.findByUsername(username) : undefined;
    if (account) {
      const valid = await verifyPassword(account.passwordHash, password);
      return valid ? this.sessions.createSession(account.id) : undefined;
    }

    if (username === LEGACY_USERNAME && this.legacyPasswordHash) {
      const valid = await verifyPassword(this.legacyPasswordHash, password);
      return valid ? this.sessions.createSession(LEGACY_SESSION_ID) : undefined;
    }

    return undefined;
  }

  isAuthenticated(token: string | undefined): boolean {
    if (!token) return false;
    return this.sessions.resolveSession(token) !== undefined;
  }

  logout(token: string | undefined): void {
    if (token) this.sessions.revokeSession(token);
  }
}
