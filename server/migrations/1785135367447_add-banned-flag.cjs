/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Lot 5.2 — bannissement d'un compte par l'admin (cahier des charges §5.4). Colonne
 * dénormalisée simple plutôt qu'une table d'historique des sanctions : aucun besoin de
 * traçabilité au-delà d'un booléen pour le MVP (un seul niveau de sanction, pas de motif/durée).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.addColumns('players', {
    banned: { type: 'boolean', notNull: true, default: false },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropColumns('players', ['banned']);
};

module.exports = { shorthands, up, down };
