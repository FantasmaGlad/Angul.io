import type { Pool } from 'pg';

export interface AdminUserRow {
  id: number;
  username: string;
  passwordHash: string;
}

interface AdminUserRawRow {
  id: number;
  username: string;
  password_hash: string;
}

/** Comptes admin nommés (cahier_des_charges_admin.md §2) — remplace le mot de passe unique
 * partagé historique (`ADMIN_PASSWORD_HASH`, toujours supporté en repli, voir `AdminAuth`) par de
 * vraies lignes en base, une par administrateur. Aucun rôle/permission différenciée à ce stade
 * (spec : "un seul niveau d'accès") — juste une identité nommée plutôt qu'un secret partagé. */
export class AdminUsersRepository {
  constructor(private readonly pool: Pool) {}

  async findByUsername(username: string): Promise<AdminUserRow | undefined> {
    const result = await this.pool.query<AdminUserRawRow>(
      `SELECT id, username, password_hash FROM admin_users WHERE username = $1`,
      [username],
    );
    const row = result.rows[0];
    return row ? { id: row.id, username: row.username, passwordHash: row.password_hash } : undefined;
  }
}
