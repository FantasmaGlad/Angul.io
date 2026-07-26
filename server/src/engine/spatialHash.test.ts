import { describe, expect, it } from 'vitest';
import type { Entity } from './types.js';
import { SpatialHash } from './spatialHash.js';

function fakeEntity(id: string, x: number, y: number): Entity {
  return { id, kind: 'particle', position: { x, y }, velocity: { x: 0, y: 0 }, mass: 1, radius: 1, data: {} };
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
});
