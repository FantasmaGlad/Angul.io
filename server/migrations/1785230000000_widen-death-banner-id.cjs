/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** `death_banner_id` était `varchar(50)` (voir 1785210000000), pensé pour un id de catalogue
 * prédéfini — la personnalisation upload/URL d'image ou GIF ajoutée depuis côté client
 * (ProfilePage.tsx, `isCustomImageBanner`) y stocke en réalité une URL ou une data URL base64,
 * largement au-dessus de 50 caractères : toute sauvegarde avec une bannière personnalisée
 * échouait silencieusement en base (troncature/erreur de contrainte de longueur). `text` n'a pas
 * de limite de longueur fixe côté Postgres.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.alterColumn('players', 'death_banner_id', { type: 'text' });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.alterColumn('players', 'death_banner_id', { type: 'varchar(50)' });
};

module.exports = { shorthands, up, down };
