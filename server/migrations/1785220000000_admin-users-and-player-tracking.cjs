/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Interface d'administration (refonte complète, cahier_des_charges_admin.md) : passage d'un
 * unique mot de passe partagé (`ADMIN_PASSWORD_HASH`, toujours supporté en repli — voir
 * `AdminAuth`) à de vrais comptes admin nommés en base, un par administrateur. Ajoute aussi le
 * suivi nécessaire à la recherche/tri admin des comptes joueurs (§3.1 : IP, dernière connexion,
 * temps de jeu total), absent jusqu'ici.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.createTable('admin_users', {
    id: 'id',
    username: { type: 'text', notNull: true, unique: true },
    password_hash: { type: 'text', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  });

  pgm.addColumns('players', {
    last_login_at: { type: 'timestamptz' },
    last_ip: { type: 'text' },
    total_playtime_sec: { type: 'integer', notNull: true, default: 0 },
  });

  // Compte "Fantadmin" — hash argon2id généré via `node scripts/hashPassword.mjs`, jamais le mot
  // de passe en clair (voir server/scripts/hashPassword.mjs, même principe que
  // `ADMIN_PASSWORD_HASH`).
  pgm.sql(`
    INSERT INTO admin_users (username, password_hash)
    VALUES ('Fantadmin', '$argon2id$v=19$m=65536,p=4,t=3$4azg6uy7dqzYXnyH/adUbQ$+Ftw5XXgVNNit9LjLj8CBvsXfPsSumpc2r2TJmn9K9k')
  `);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropTable('admin_users');
  pgm.dropColumns('players', ['last_login_at', 'last_ip', 'total_playtime_sec']);
};

module.exports = { shorthands, up, down };
