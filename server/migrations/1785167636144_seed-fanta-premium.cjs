/** @type {import('node-pg-migrate').ColumnDefinitions | undefined} */
const shorthands = undefined;

/** Refonte UI/UX accueil — active le statut Premium pour le compte "Fanta" (déjà inscrit
 * normalement, voir cahier des charges §5.3 : le statut s'obtient d'ordinaire par don + activation
 * manuelle admin, ici appliqué directement en migration de données à la demande explicite). Ne
 * touche à aucune structure de table (pas un `up`/`down` de schéma comme les autres migrations de
 * ce dossier) : un simple `UPDATE`, idempotent, sans effet si le compte n'existe pas encore dans
 * un environnement donné (CI, base de dev vierge).
 * @param {import('node-pg-migrate').MigrationBuilder} pgm
 */
const up = (pgm) => {
  pgm.sql(`UPDATE players SET premium = TRUE WHERE pseudo = 'Fanta'`);
};

/** @param {import('node-pg-migrate').MigrationBuilder} pgm */
const down = (pgm) => {
  pgm.sql(`UPDATE players SET premium = FALSE WHERE pseudo = 'Fanta'`);
};

module.exports = { shorthands, up, down };
