import type { EntitySnapshot } from '../protocol.js';

export interface OwnAggregate {
  /** Masse totale (somme de tous les morceaux du joueur). */
  mass: number;
  /** Barycentre pondéré par la masse. */
  x: number;
  y: number;
}

/** Agrège les morceaux du joueur (masse totale + barycentre pondéré) — même calcul que
 * `computeCamera` (render.ts), qui l'utilise pour centrer la caméra ; déplacé ici depuis
 * `client/src/stats.ts` (P2, plan-implementation-admin.md §4.1) car `computeCamera` en dépend et
 * `shared/` ne peut pas importer depuis `client/`. `client/src/stats.ts` continue de l'utiliser en
 * l'important d'ici (voir `speedBetween`, resté côté client, qui n'a pas cette dépendance). */
export function ownAggregate(
  entities: EntitySnapshot[],
  selfPlayerId: string | undefined,
  mapSize?: number,
): OwnAggregate | undefined {
  const ownPieces = entities.filter((entity) => entity.p === selfPlayerId);
  if (ownPieces.length === 0) return undefined;

  let mass = 0;
  const refPiece = ownPieces[0]!;
  let x = 0;
  let y = 0;
  for (const piece of ownPieces) {
    mass += piece.m;
    let dx = piece.x - refPiece.x;
    let dy = piece.y - refPiece.y;
    if (mapSize && mapSize > 0) {
      if (Math.abs(dx) > mapSize / 2) {
        dx = dx > 0 ? dx - mapSize : dx + mapSize;
      }
      if (Math.abs(dy) > mapSize / 2) {
        dy = dy > 0 ? dy - mapSize : dy + mapSize;
      }
    }
    x += (refPiece.x + dx) * piece.m;
    y += (refPiece.y + dy) * piece.m;
  }
  let finalX = x / mass;
  let finalY = y / mass;
  if (mapSize && mapSize > 0) {
    finalX = ((finalX % mapSize) + mapSize) % mapSize;
    finalY = ((finalY % mapSize) + mapSize) % mapSize;
  }
  return { mass, x: finalX, y: finalY };
}
