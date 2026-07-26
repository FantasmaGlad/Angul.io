import type { Pool } from 'pg';
import { levelForXp } from './levels.js';

export interface AccountRow {
  id: number;
  pseudo: string;
  passwordHash: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
}

export interface BestScoreRow {
  modeId: string;
  bestScore: number;
}

/** Levée par `createAccount` sur violation de la contrainte d'unicité (`players_pseudo_key`) —
 * distincte d'une erreur générique pour que la couche service puisse la traduire en message
 * utilisateur clair sans avoir à inspecter un code d'erreur PostgreSQL. */
export class PseudoTakenError extends Error {
  constructor(pseudo: string) {
    super(`Le pseudo "${pseudo}" est déjà pris.`);
    this.name = 'PseudoTakenError';
  }
}

interface PlayerRow {
  id: number;
  pseudo: string;
  password_hash: string;
  level: number;
  xp: number;
  premium: boolean;
  cosmetics: string[];
}

const ACCOUNT_COLUMNS = 'id, pseudo, password_hash, level, xp, premium, cosmetics';

function toAccountRow(row: PlayerRow): AccountRow {
  return {
    id: row.id,
    pseudo: row.pseudo,
    passwordHash: row.password_hash,
    level: row.level,
    xp: row.xp,
    premium: row.premium,
    cosmetics: row.cosmetics,
  };
}

/** Code d'erreur PostgreSQL pour une violation de contrainte unique (`unique_violation`). */
const PG_UNIQUE_VIOLATION = '23505';

export class AccountsRepository {
  constructor(private readonly pool: Pool) {}

  async createAccount(pseudo: string, passwordHash: string): Promise<AccountRow> {
    try {
      const result = await this.pool.query<PlayerRow>(
        `INSERT INTO players (pseudo, password_hash) VALUES ($1, $2) RETURNING ${ACCOUNT_COLUMNS}`,
        [pseudo, passwordHash],
      );
      // `RETURNING` sur un INSERT qui n'a pas levé garantit une ligne — pas un cas d'erreur
      // métier comme `findByPseudo`/`findById`, qui eux renvoient légitimement `undefined`.
      const row = result.rows[0];
      if (!row)
        throw new Error('INSERT ... RETURNING sans ligne retournée (ne devrait pas arriver).');
      return toAccountRow(row);
    } catch (error) {
      if (isUniqueViolation(error)) throw new PseudoTakenError(pseudo);
      throw error;
    }
  }

  async findByPseudo(pseudo: string): Promise<AccountRow | undefined> {
    const result = await this.pool.query<PlayerRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM players WHERE pseudo = $1`,
      [pseudo],
    );
    return result.rows[0] ? toAccountRow(result.rows[0]) : undefined;
  }

  async findById(id: number): Promise<AccountRow | undefined> {
    const result = await this.pool.query<PlayerRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM players WHERE id = $1`,
      [id],
    );
    return result.rows[0] ? toAccountRow(result.rows[0]) : undefined;
  }

  async getBestScores(id: number): Promise<BestScoreRow[]> {
    const result = await this.pool.query<{ mode_id: string; best_score: number }>(
      `SELECT mode_id, best_score FROM player_best_scores WHERE player_id = $1 ORDER BY mode_id`,
      [id],
    );
    return result.rows.map((row) => ({ modeId: row.mode_id, bestScore: row.best_score }));
  }

  /**
   * Écrit le résultat d'une partie (Lot 3.5) : meilleur score du mode mis à jour s'il est
   * dépassé, XP ajouté, niveau recalculé — en une seule transaction pour rester cohérent même
   * si l'écriture est interrompue en cours de route (ex. perte de connexion à la base).
   */
  async recordGameResult(
    accountId: number,
    modeId: string,
    score: number,
    xpGained: number,
  ): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `INSERT INTO player_best_scores (player_id, mode_id, best_score, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (player_id, mode_id) DO UPDATE
           SET best_score = GREATEST(player_best_scores.best_score, EXCLUDED.best_score),
               updated_at = now()`,
        [accountId, modeId, score],
      );
      const xpResult = await client.query<{ xp: number }>(
        `UPDATE players SET xp = xp + $2 WHERE id = $1 RETURNING xp`,
        [accountId, xpGained],
      );
      const newXp = xpResult.rows[0]?.xp;
      if (newXp === undefined) throw new Error(`Compte ${accountId} introuvable.`);
      await client.query(`UPDATE players SET level = $2 WHERE id = $1`, [
        accountId,
        levelForXp(newXp),
      ]);
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code: unknown }).code === PG_UNIQUE_VIOLATION
  );
}
