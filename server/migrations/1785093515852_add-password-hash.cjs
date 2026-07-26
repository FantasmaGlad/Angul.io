/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Lot 3.2 (authentification) — le hash n'est jamais en clair, pas de mot de passe stocké tel
 * quel (argon2 côté serveur, voir server/src/accounts/passwords.ts).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.addColumn('players', {
    password_hash: { type: 'text', notNull: true },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropColumn('players', 'password_hash');
};

module.exports = { shorthands, up, down };
