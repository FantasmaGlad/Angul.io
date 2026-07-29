import type { Vector2 } from '@angulio/shared';
import type { Entity, EntityId } from './types.js';

/**
 * Grille uniforme pour la détection de collision en broad-phase (metriques.md/plan Lot 1.2) :
 * évite de tester chaque entité contre toutes les autres (O(n²)).
 */
export class SpatialHash {
  private readonly cellSize: number;
  private cells = new Map<number, EntityId[]>();
  private scratchSet = new Set<EntityId>();

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
  }

  insert(entity: Entity): void {
    const minCx = Math.floor((entity.position.x - entity.radius) / this.cellSize);
    const maxCx = Math.floor((entity.position.x + entity.radius) / this.cellSize);
    const minCy = Math.floor((entity.position.y - entity.radius) / this.cellSize);
    const maxCy = Math.floor((entity.position.y + entity.radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entity.id);
      }
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
    this.scratchSet.clear();

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        const key = (((cx + dx) & 0xffff) << 16) | ((cy + dy) & 0xffff);
        const bucket = this.cells.get(key);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const id = bucket[i]!;
            if (!this.scratchSet.has(id)) {
              this.scratchSet.add(id);
              result.push(id);
            }
          }
        }
      }
    }
    return result;
  }
}

