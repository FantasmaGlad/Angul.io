/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Avatar procédural (refonte UI/UX) — couleur de blob choisie par le joueur parmi une palette
 * curatée (shared/src/avatarPalette.ts), stockée telle quelle (code hex) plutôt que via un id de
 * cosmétique séparé : pas de contenu additionnel derrière (pas de forme/motif), donc pas besoin
 * d'indirection. `NULL` = pas de choix explicite, le serveur retombe alors sur une couleur
 * déterministe dérivée du pseudo (voir connectionHandler.ts, `colorForNickname`).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.addColumns('players', {
    avatar_color: { type: 'text', notNull: false },
  });
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.dropColumns('players', ['avatar_color']);
};

module.exports = { shorthands, up, down };
