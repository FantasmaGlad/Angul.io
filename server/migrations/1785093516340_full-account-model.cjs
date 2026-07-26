/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Lot 3.4 — modèle de compte joueur complet (cahier des charges §5.2) : niveau/XP, statut
 * Premium, cosmétiques débloqués, meilleur score par mode. `level` est une colonne dénormalisée
 * (recalculée et réécrite à chaque partie en même temps que `xp`, voir
 * `server/src/accounts/levels.ts`) plutôt que dérivée à la volée à chaque lecture du profil —
 * simple lecture directe côté écran de profil (3.6). Formule XP/niveau volontairement
 * provisoire (§5.2 : "formule à définir en phase de développement"), ajustable sans nouvelle
 * migration puisqu'elle ne vit que dans le code applicatif.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.addColumns('players', {
    level: { type: 'integer', notNull: true, default: 1 },
    xp: { type: 'integer', notNull: true, default: 0 },
    premium: { type: 'boolean', notNull: true, default: false },
    // Contenu détaillé des cosmétiques différé (cahier des charges §8.2) : simple liste
    // d'identifiants pour le MVP, pas de table dédiée tant qu'il n'y a rien à y mettre.
    cosmetics: { type: 'text[]', notNull: true, default: pgm.func("'{}'::text[]") },
  });

  // Un meilleur score par (joueur, mode) — `mode_id` en texte libre plutôt qu'une énumération
  // fixe : les modes sont des fichiers de config chargés dynamiquement (mods/parametric),
  // pas un ensemble figé au moment de la migration.
  pgm.createTable('player_best_scores', {
    player_id: {
      type: 'integer',
      notNull: true,
      references: 'players',
      onDelete: 'CASCADE',
    },
    mode_id: { type: 'text', notNull: true },
    best_score: { type: 'integer', notNull: true },
    updated_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
  pgm.addConstraint('player_best_scores', 'player_best_scores_pkey', {
    primaryKey: ['player_id', 'mode_id'],
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropTable('player_best_scores');
  pgm.dropColumns('players', ['level', 'xp', 'premium', 'cosmetics']);
};

module.exports = { shorthands, up, down };
