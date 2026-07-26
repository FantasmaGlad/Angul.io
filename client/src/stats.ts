import type { EntitySnapshot } from '@angulio/shared';

export interface OwnAggregate {
  /** Masse totale (somme de tous les morceaux du joueur). */
  mass: number;
  /** Barycentre pondéré par la masse. */
  x: number;
  y: number;
}

/** Agrège les morceaux du joueur (masse totale + barycentre pondéré) — même calcul que
 * `computeCamera` (render.ts), qui l'utilise pour centrer la caméra ; factorisé ici pour aussi
 * servir le panneau de stats (Masse) sans dupliquer la boucle. */
export function ownAggregate(
  entities: EntitySnapshot[],
  selfPlayerId: string | undefined,
): OwnAggregate | undefined {
  const ownPieces = entities.filter((entity) => entity.p === selfPlayerId);
  if (ownPieces.length === 0) return undefined;

  let mass = 0;
  let x = 0;
  let y = 0;
  for (const piece of ownPieces) {
    mass += piece.m;
    x += piece.x * piece.m;
    y += piece.y * piece.m;
  }
  return { mass, x: x / mass, y: y / mass };
}

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
