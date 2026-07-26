/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Schéma initial (Lot 3.1) — juste de quoi valider le pipeline de migrations de bout en
 * bout. Les colonnes propres au compte joueur complet (niveau/XP, Premium, cosmétiques —
 * Lot 3.4) et à l'authentification (hash de mot de passe — Lot 3.2) arrivent dans leurs
 * migrations respectives plutôt que d'être anticipées ici.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.createTable('players', {
    id: 'id',
    pseudo: { type: 'text', notNull: true, unique: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropTable('players');
};

module.exports = { shorthands, up, down };
