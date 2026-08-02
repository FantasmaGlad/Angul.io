/** `ownAggregate`/`OwnAggregate` ont déménagé dans `@angulio/shared/render` (P2,
 * plan-implementation-admin.md §4.1) — `computeCamera` (shared/src/render/render.ts) en dépend, et
 * `shared/` ne peut pas importer depuis `client/`. Réimportés ici tels quels par les appelants
 * existants (GameView.tsx) depuis `@angulio/shared/render` plutôt que d'être ré-exportés depuis ce
 * fichier, pour ne garder ici que ce qui reste réellement propre au client. */

/** Vitesse instantanée approximative (unités de carte par seconde), dérivée de deux positions
 * successives réellement observées. Le protocole ne transmet pas la vélocité des entités (Lot
 * 1.8, économie de bande passante) : plutôt que de dupliquer les formules du mod côté client
 * (qui dépendent en plus de l'intensité d'input courante, pas seulement de la masse), on mesure
 * le déplacement réel — c'est littéralement ce que "vitesse" veut dire pour un joueur qui
 * regarde son morceau bouger. */
export function speedBetween(
  previous: { x: number; y: number } | undefined,
  current: { x: number; y: number },
  dtSeconds: number,
): number | undefined {
  if (!previous || dtSeconds <= 0) return undefined;
  const dx = current.x - previous.x;
  const dy = current.y - previous.y;
  return Math.sqrt(dx * dx + dy * dy) / dtSeconds;
}
