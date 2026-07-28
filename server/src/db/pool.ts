import { Pool } from 'pg';

/**
 * Pool de connexions PostgreSQL, créé paresseusement au premier accès plutôt qu'au chargement
 * du module — `DATABASE_URL` n'est nécessaire qu'à partir du Lot 3 (comptes joueurs) ; le reste
 * du serveur (salons, mods) n'en dépend pas et ne doit pas planter en son absence.
 */
let pool: Pool | undefined;

export function getPool(): Pool {
  if (!pool) {
    const connectionString = process.env.DATABASE_URL;
    if (!connectionString) {
      throw new Error(
        "DATABASE_URL n'est pas définie — requise pour les comptes joueurs (Lot 3). " +
          'Voir server/.env.example.',
      );
    }
    const max = process.env.PG_POOL_MAX ? parseInt(process.env.PG_POOL_MAX, 10) : 10;
    const statement_timeout = process.env.PG_STATEMENT_TIMEOUT_MS
      ? parseInt(process.env.PG_STATEMENT_TIMEOUT_MS, 10)
      : 10000;
    const idleTimeoutMillis = process.env.PG_IDLE_TIMEOUT_MS
      ? parseInt(process.env.PG_IDLE_TIMEOUT_MS, 10)
      : 30000;

    pool = new Pool({
      connectionString,
      max,
      statement_timeout,
      idleTimeoutMillis,
    });
  }
  return pool;
}

/** Réservé aux tests : force la recréation du pool (ex. après un changement de `DATABASE_URL`). */
export async function resetPoolForTests(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = undefined;
  }
}
