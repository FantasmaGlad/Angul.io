import { describe, expect, it } from 'vitest';
import type { Entity } from './types.js';
import { SpatialHash } from './spatialHash.js';

function fakeEntity(id: string, x: number, y: number, radius = 1): Entity {
  return {
    id,
    kind: 'particle',
    position: { x, y },
    velocity: { x: 0, y: 0 },
    mass: 1,
    radius,
    data: {},
  };
}

describe('SpatialHash', () => {
  it('finds an entity inserted in the same cell', () => {
    const hash = new SpatialHash(10);
    const a = fakeEntity('a', 5, 5);
    hash.insert(a);
    expect(hash.queryNearby({ x: 6, y: 6 })).toContain('a');
  });

  it('finds entities in the 8 neighboring cells', () => {
    const hash = new SpatialHash(10);
    const a = fakeEntity('a', 5, 5); // cellule (0,0)
    const b = fakeEntity('b', 15, 5); // cellule (1,0), voisine
    hash.insert(a);
    hash.insert(b);
    const nearby = hash.queryNearby({ x: 5, y: 5 });
    expect(nearby).toContain('a');
    expect(nearby).toContain('b');
  });

  it('does not return entities far outside the neighboring cells', () => {
    const hash = new SpatialHash(10);
    const a = fakeEntity('a', 5, 5);
    const far = fakeEntity('far', 500, 500);
    hash.insert(a);
    hash.insert(far);
    expect(hash.queryNearby({ x: 5, y: 5 })).not.toContain('far');
  });

  it('clear() empties all cells', () => {
    const hash = new SpatialHash(10);
    hash.insert(fakeEntity('a', 5, 5));
    hash.clear();
    expect(hash.queryNearby({ x: 5, y: 5 })).toEqual([]);
  });

  describe('grandes entités (au-dessus de LARGE_ENTITY_RADIUS_FACTOR × cellSize)', () => {
    it("route une entité de grand rayon vers getLargeEntities() plutôt que d'insérer des dizaines de cellules", () => {
      const hash = new SpatialHash(10);
      const giant = fakeEntity('giant', 100, 100, 30); // rayon 30 > 10*1.5=15
      hash.insert(giant);
      expect(hash.getLargeEntities().map((e) => e.id)).toEqual(['giant']);
    });

    it('ne renvoie JAMAIS une grande entité via queryNearby/queryRadius (grille seulement)', () => {
      const hash = new SpatialHash(10);
      const giant = fakeEntity('giant', 100, 100, 30);
      hash.insert(giant);
      // Même en interrogeant exactement sa position.
      expect(hash.queryNearby({ x: 100, y: 100 })).not.toContain('giant');
      expect(hash.queryRadius({ x: 100, y: 100 }, 1000)).not.toContain('giant');
    });

    it('maxGridEntityRadius() reflète le seuil utilisé par insert()', () => {
      const hash = new SpatialHash(10);
      expect(hash.maxGridEntityRadius()).toBe(15); // 10 * 1.5
    });
  });
});
