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
  banned: boolean;
  avatarColor: string | null;
  deathMessage: string;
  deathBannerId: string;
  createdAt: string;
  lastLoginAt: string | null;
  lastIp: string | null;
  totalPlaytimeSec: number;
}

/** Champs modifiables par le joueur lui-même pour personnaliser son écran de mort (cahier des
 * charges fourni) — validés en amont en couche service (sanitisation du message, bannière
 * déverrouillée par le niveau) avant d'arriver ici. */
export interface DeathScreenPatch {
  deathMessage: string;
  deathBannerId: string;
}

/** Champs modifiables par l'admin (cahier_des_charges_admin.md §3.2) — tous optionnels, seuls les
 * champs fournis sont écrits (voir `adminUpdateAccount`). `passwordHash` : déjà haché par la
 * couche service (voir `AccountsService.updateAccountForAdmin`), jamais le mot de passe en clair
 * ici. */
export interface AdminAccountPatch {
  pseudo?: string;
  level?: number;
  xp?: number;
  premium?: boolean;
  cosmetics?: string[];
  banned?: boolean;
  avatarColor?: string;
  deathMessage?: string;
  deathBannerId?: string;
  passwordHash?: string;
}

/** Critères de recherche/filtrage admin (§3.1) — tous optionnels. `q` matche le pseudo (sous-chaîne,
 * insensible à la casse) OU l'id exact si `q` est purement numérique. */
export interface AdminSearchParams {
  q?: string;
  ip?: string;
  premium?: boolean;
  banned?: boolean;
  minLevel?: number;
  maxLevel?: number;
  minXp?: number;
  maxXp?: number;
  sortBy?: 'pseudo' | 'level' | 'xp' | 'createdAt' | 'lastLoginAt' | 'totalPlaytimeSec' | 'bestScore';
  sortDir?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

export interface AdminSearchRow extends AccountRow {
  /** Meilleur score historique, tous modes confondus (0 si aucune partie jouée) — voir la
   * sous-requête `MAX(best_score)` de `searchAdmin`. */
  bestScore: number;
}

export interface AdminSearchResult {
  rows: AdminSearchRow[];
  total: number;
}

export interface BestScoreRow {
  modeId: string;
  bestScore: number;
}

/** Une ligne du classement public (Lot "Classements") — `score` est l'XP totale pour l'onglet
 * global (`modeId` omis), ou le meilleur score du mode demandé sinon. Jamais `id`/`lastIp`/etc,
 * seulement ce qu'un classement public montre légitimement. */
export interface LeaderboardRow {
  pseudo: string;
  level: number;
  avatarColor: string | null;
  score: number;
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
  banned: boolean;
  avatar_color: string | null;
  death_message: string;
  death_banner_id: string;
  created_at: string;
  last_login_at: string | null;
  last_ip: string | null;
  total_playtime_sec: number;
}

const ACCOUNT_COLUMNS =
  'id, pseudo, password_hash, level, xp, premium, cosmetics, banned, avatar_color, ' +
  'death_message, death_banner_id, created_at, last_login_at, last_ip, total_playtime_sec';

function toAccountRow(row: PlayerRow): AccountRow {
  return {
    id: row.id,
    pseudo: row.pseudo,
    passwordHash: row.password_hash,
    level: row.level,
    xp: row.xp,
    premium: row.premium,
    cosmetics: row.cosmetics,
    banned: row.banned,
    avatarColor: row.avatar_color,
    deathMessage: row.death_message,
    deathBannerId: row.death_banner_id,
    createdAt: row.created_at,
    lastLoginAt: row.last_login_at,
    lastIp: row.last_ip,
    totalPlaytimeSec: row.total_playtime_sec,
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

  /** Recherche par sous-chaîne de pseudo, insensible à la casse (Lot 5.2) — `query` vide
   * renvoie les `limit` premiers comptes par ordre alphabétique plutôt qu'une liste vide,
   * pratique pour parcourir la base depuis l'admin sans devoir connaître un pseudo exact.
   * @deprecated conservé pour compatibilité — préférer `searchAdmin` (filtres/tri/pagination,
   * §3.1 cahier_des_charges_admin.md). */
  async searchByPseudo(query: string, limit = 20): Promise<AccountRow[]> {
    const result = await this.pool.query<PlayerRow>(
      `SELECT ${ACCOUNT_COLUMNS} FROM players WHERE pseudo ILIKE $1 ORDER BY pseudo LIMIT $2`,
      [`%${query}%`, limit],
    );
    return result.rows.map(toAccountRow);
  }

  /** Recherche/filtrage/tri admin complet (§3.1) — pseudo/id (`q`), IP (`ip`), statuts
   * (Premium/Banni), plage niveau/XP, tri sur n'importe quelle colonne y compris le meilleur
   * score historique (sous-requête `MAX(best_score)` tous modes confondus). Construit la clause
   * `WHERE` dynamiquement (colonnes fixes, jamais de valeur utilisateur interpolée directement
   * dans le SQL — toujours via `$n`) : plus sûr qu'une concaténation de chaînes, seule façon de
   * combiner un nombre variable de filtres optionnels avec `pg`. */
  async searchAdmin(params: AdminSearchParams): Promise<AdminSearchResult> {
    const conditions: string[] = [];
    const values: unknown[] = [];

    const push = (value: unknown): number => {
      values.push(value);
      return values.length;
    };

    if (params.q && params.q.trim().length > 0) {
      const q = params.q.trim();
      const isNumeric = /^\d+$/.test(q);
      if (isNumeric) {
        conditions.push(`(pseudo ILIKE $${push(`%${q}%`)} OR id = $${push(Number(q))})`);
      } else {
        conditions.push(`pseudo ILIKE $${push(`%${q}%`)}`);
      }
    }
    if (params.ip && params.ip.trim().length > 0) {
      conditions.push(`last_ip = $${push(params.ip.trim())}`);
    }
    if (params.premium !== undefined) conditions.push(`premium = $${push(params.premium)}`);
    if (params.banned !== undefined) conditions.push(`banned = $${push(params.banned)}`);
    if (params.minLevel !== undefined) conditions.push(`level >= $${push(params.minLevel)}`);
    if (params.maxLevel !== undefined) conditions.push(`level <= $${push(params.maxLevel)}`);
    if (params.minXp !== undefined) conditions.push(`xp >= $${push(params.minXp)}`);
    if (params.maxXp !== undefined) conditions.push(`xp <= $${push(params.maxXp)}`);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

    const sortColumn: Record<NonNullable<AdminSearchParams['sortBy']>, string> = {
      pseudo: 'pseudo',
      level: 'level',
      xp: 'xp',
      createdAt: 'created_at',
      lastLoginAt: 'last_login_at',
      totalPlaytimeSec: 'total_playtime_sec',
      bestScore: 'best_score',
    };
    const orderBy = sortColumn[params.sortBy ?? 'pseudo'];
    const direction = params.sortDir === 'desc' ? 'DESC' : 'ASC';
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const offset = Math.max(params.offset ?? 0, 0);

    const limitPlaceholder = push(limit);
    const offsetPlaceholder = push(offset);

    const result = await this.pool.query<PlayerRow & { best_score: number; total: string }>(
      `SELECT ${ACCOUNT_COLUMNS},
              COALESCE((SELECT MAX(best_score) FROM player_best_scores WHERE player_id = players.id), 0) AS best_score,
              count(*) OVER() AS total
       FROM players
       ${whereClause}
       ORDER BY ${orderBy} ${direction} NULLS LAST, id ASC
       LIMIT $${limitPlaceholder} OFFSET $${offsetPlaceholder}`,
      values,
    );

    return {
      rows: result.rows.map((row) => ({ ...toAccountRow(row), bestScore: Number(row.best_score) })),
      total: result.rows[0] ? Number(result.rows[0].total) : 0,
    };
  }

  /** Écrit une correction manuelle admin (§3.2 : pseudo, bannissement, XP/niveau, cosmétiques,
   * statut Premium, couleur d'avatar, écran de mort, mot de passe déjà haché) — seuls les champs
   * présents dans `patch` sont modifiés. `undefined` si le compte n'existe pas (traduit en 404
   * côté HTTP, voir net/server.ts). Lève `PseudoTakenError` si le nouveau pseudo est déjà pris
   * (même contrainte unique que `createAccount`). */
  async adminUpdateAccount(id: number, patch: AdminAccountPatch): Promise<AccountRow | undefined> {
    const columns: Array<[string, unknown]> = [];
    if (patch.pseudo !== undefined) columns.push(['pseudo', patch.pseudo]);
    if (patch.level !== undefined) columns.push(['level', patch.level]);
    if (patch.xp !== undefined) columns.push(['xp', patch.xp]);
    if (patch.premium !== undefined) columns.push(['premium', patch.premium]);
    if (patch.cosmetics !== undefined) columns.push(['cosmetics', patch.cosmetics]);
    if (patch.banned !== undefined) columns.push(['banned', patch.banned]);
    if (patch.avatarColor !== undefined) columns.push(['avatar_color', patch.avatarColor]);
    if (patch.deathMessage !== undefined) columns.push(['death_message', patch.deathMessage]);
    if (patch.deathBannerId !== undefined) columns.push(['death_banner_id', patch.deathBannerId]);
    if (patch.passwordHash !== undefined) columns.push(['password_hash', patch.passwordHash]);
    if (columns.length === 0) return this.findById(id);

    const setClause = columns.map(([column], index) => `${column} = $${index + 2}`).join(', ');
    const values = columns.map(([, value]) => value);
    try {
      const result = await this.pool.query<PlayerRow>(
        `UPDATE players SET ${setClause} WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
        [id, ...values],
      );
      return result.rows[0] ? toAccountRow(result.rows[0]) : undefined;
    } catch (error) {
      if (isUniqueViolation(error) && patch.pseudo !== undefined) {
        throw new PseudoTakenError(patch.pseudo);
      }
      throw error;
    }
  }

  /** IP + horodatage de connexion (§3.1, recherche/tri par IP et dernière connexion) — écrit à
   * chaque join réussi (voir connectionHandler.ts), best-effort (ne doit jamais faire échouer la
   * connexion elle-même en cas d'erreur DB passagère, voir l'appelant). */
  async recordLogin(id: number, ip: string | undefined): Promise<void> {
    await this.pool.query(`UPDATE players SET last_login_at = now(), last_ip = $2 WHERE id = $1`, [
      id,
      ip ?? null,
    ]);
  }

  /** Cumule le temps de jeu (§3.1, tri par "temps de jeu total") — ajouté à la déconnexion
   * (voir connectionHandler.ts), jamais recalculé/écrasé. */
  async addPlaytime(id: number, seconds: number): Promise<void> {
    if (seconds <= 0) return;
    await this.pool.query(`UPDATE players SET total_playtime_sec = total_playtime_sec + $2 WHERE id = $1`, [
      id,
      Math.round(seconds),
    ]);
  }

  /** Réinitialise le meilleur score d'un mode précis, ou de tous les modes si `modeId` est
   * omis (§3.2, "réinitialisation éventuelle des scores max par mode"). */
  async resetBestScore(id: number, modeId?: string): Promise<void> {
    if (modeId) {
      await this.pool.query(`DELETE FROM player_best_scores WHERE player_id = $1 AND mode_id = $2`, [
        id,
        modeId,
      ]);
    } else {
      await this.pool.query(`DELETE FROM player_best_scores WHERE player_id = $1`, [id]);
    }
  }

  /** Écrit le choix d'avatar (couleur, refonte UI/UX) — la validation contre la palette curatée
   * se fait en amont, en couche service (voir `AccountsService.updateAvatarColor`), pas ici. */
  async updateAvatarColor(id: number, color: string): Promise<AccountRow | undefined> {
    const result = await this.pool.query<PlayerRow>(
      `UPDATE players SET avatar_color = $2 WHERE id = $1 RETURNING ${ACCOUNT_COLUMNS}`,
      [id, color],
    );
    return result.rows[0] ? toAccountRow(result.rows[0]) : undefined;
  }

  /** Écrit la personnalisation de l'écran de mort (message + bannière) — validation (longueur,
   * anti-XSS, déblocage de la bannière) faite en amont par `AccountsService.updateDeathScreen`. */
  async updateDeathScreen(id: number, patch: DeathScreenPatch): Promise<AccountRow | undefined> {
    const result = await this.pool.query<PlayerRow>(
      `UPDATE players SET death_message = $2, death_banner_id = $3 WHERE id = $1
       RETURNING ${ACCOUNT_COLUMNS}`,
      [id, patch.deathMessage, patch.deathBannerId],
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

  /** Classement public (Lot "Classements") : top `limit` comptes non bannis, triés par XP totale
   * (`modeId` omis, onglet "Global") ou par meilleur score pour un mode donné (jointure sur
   * `player_best_scores`, un compte qui n'a jamais joué ce mode n'apparaît simplement pas). */
  async getLeaderboard(modeId: string | undefined, limit: number): Promise<LeaderboardRow[]> {
    if (modeId) {
      const result = await this.pool.query<{
        pseudo: string;
        level: number;
        avatar_color: string | null;
        score: string;
      }>(
        `SELECT p.pseudo, p.level, p.avatar_color, pbs.best_score AS score
         FROM player_best_scores pbs
         JOIN players p ON p.id = pbs.player_id
         WHERE pbs.mode_id = $1 AND p.banned = false
         ORDER BY pbs.best_score DESC, p.id ASC
         LIMIT $2`,
        [modeId, limit],
      );
      return result.rows.map((row) => ({
        pseudo: row.pseudo,
        level: row.level,
        avatarColor: row.avatar_color,
        score: Number(row.score),
      }));
    }

    const result = await this.pool.query<{
      pseudo: string;
      level: number;
      avatar_color: string | null;
      xp: number;
    }>(
      `SELECT pseudo, level, avatar_color, xp FROM players
       WHERE banned = false
       ORDER BY xp DESC, id ASC
       LIMIT $1`,
      [limit],
    );
    return result.rows.map((row) => ({
      pseudo: row.pseudo,
      level: row.level,
      avatarColor: row.avatar_color,
      score: row.xp,
    }));
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
