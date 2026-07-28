/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Écran de mort personnalisé (cahier des charges fourni par l'utilisateur) — message libre +
 * bannière parmi un catalogue prédéfini (shared/src/deathBanners.ts), pas d'upload d'image
 * (décision cohérente avec l'avatar procédural : aucune infra de stockage/modération de
 * fichiers dans ce projet — voir structure.md §3). `death_image_url` du cahier des charges
 * original n'est donc PAS ajoutée : rien côté API/UI ne permettrait de la renseigner, l'ajouter
 * quand même serait une colonne morte.
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.addColumns('players', {
    death_message: {
      type: 'varchar(100)',
      notNull: true,
      default: 'Bien joué ! À la prochaine.',
    },
    death_banner_id: { type: 'varchar(50)', notNull: true, default: 'default_skull' },
  });
  pgm.addConstraint(
    'players',
    'chk_death_message_length',
    'CHECK (char_length(death_message) <= 100)',
  );
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropConstraint('players', 'chk_death_message_length');
  pgm.dropColumns('players', ['death_message', 'death_banner_id']);
};

module.exports = { shorthands, up, down };
