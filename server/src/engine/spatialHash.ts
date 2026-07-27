import type { Vector2 } from '@angulio/shared';
import type { Entity, EntityId } from './types.js';

/**
 * Grille uniforme pour la détection de collision en broad-phase (metriques.md/plan Lot 1.2) :
 * évite de tester chaque entité contre toutes les autres (O(n²)).
 */
export class SpatialHash {
  private readonly cellSize: number;
  private cells = new Map<string, EntityId[]>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(entity: Entity): void {
    const key = this.cellKey(entity.position);
    const bucket = this.cells.get(key);
    if (bucket) {
      bucket.push(entity.id);
    } else {
      this.cells.set(key, [entity.id]);
    }
  }

  /** Identifiants des entités dans la cellule de `position` et ses 8 voisines. */
  queryNearby(position: Vector2): EntityId[] {
    return this.queryRadius(position, this.cellSize);
  }

  /** Identifiants des entités dans un rayon donné (en pixels) autour de `position`. */
  queryRadius(position: Vector2, radius: number): EntityId[] {
    const cellRange = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    const result: EntityId[] = [];
    const visited = new Set<EntityId>();

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        const bucket = this.cells.get(`${cx + dx},${cy + dy}`);
        if (bucket) {
          for (const id of bucket) {
            if (!visited.has(id)) {
              visited.add(id);
              result.push(id);
            }
          }
        }
      }
    }
    return result;
  }


  private cellKey(position: Vector2): string {
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    return `${cx},${cy}`;
  }
}
