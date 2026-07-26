import { massToRadius } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import { World } from './world.js';

describe('World — entités', () => {
  it('calcule le rayon d’une particule à partir de sa masse (K_AREA = π par défaut)', () => {
    const world = new World({ mapSize: 1000 });
    const particle = world.spawnParticle({ x: 0, y: 0 }, 50);
    expect(particle.radius).toBeCloseTo(massToRadius(50), 10);
  });

  it('rattache un morceau créé à son joueur', () => {
    const world = new World({ mapSize: 1000 });
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    expect(world.getPiecesByOwner('p1').map((e) => e.id)).toEqual([piece.id]);
  });

  it('retire un morceau de la liste du joueur quand il est supprimé', () => {
    const world = new World({ mapSize: 1000 });
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    world.removeEntity(piece.id);
    expect(world.getPiecesByOwner('p1')).toEqual([]);
  });

  it('removePlayer supprime aussi tous ses morceaux', () => {
    const world = new World({ mapSize: 1000 });
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    world.spawnPiece('p1', { x: 10, y: 10 }, 50);
    world.removePlayer('p1');
    expect(world.allEntities()).toHaveLength(0);
  });
});

describe('World — fusion (mergeEntities)', () => {
  it('additionne les masses et calcule le barycentre pondéré (metriques.md §10)', () => {
    const world = new World({ mapSize: 1000 });
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 0, y: 0 }, 100);
    const b = world.spawnPiece('p1', { x: 30, y: 0 }, 50);

    const merged = world.mergeEntities(a, b);

    expect(merged.mass).toBe(150);
    expect(merged.position.x).toBeCloseTo((0 * 100 + 30 * 50) / 150, 10);
    expect(merged.radius).toBeCloseTo(massToRadius(150), 10);
    expect(world.getEntity(a.id)).toBeUndefined();
    expect(world.getEntity(b.id)).toBeUndefined();
    expect(world.getPiecesByOwner('p1').map((e) => e.id)).toEqual([merged.id]);
  });
});

describe('World — findOverlappingPairs', () => {
  it('détecte deux entités dont les cercles se chevauchent', () => {
    const world = new World({ mapSize: 1000 });
    const a = world.spawnParticle({ x: 0, y: 0 }, 50); // rayon ≈ 7.07
    const b = world.spawnParticle({ x: 5, y: 0 }, 50); // distance 5 < 2*7.07 -> overlap
    world.rebuildSpatialHash();
    const pairs = world.findOverlappingPairs();
    expect(pairs).toHaveLength(1);
    const pair = pairs[0];
    if (!pair) throw new Error('expected one overlapping pair');
    expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([a.id, b.id]));
  });

  it('ne détecte rien pour deux entités trop éloignées', () => {
    const world = new World({ mapSize: 1000 });
    world.spawnParticle({ x: 0, y: 0 }, 50);
    world.spawnParticle({ x: 500, y: 500 }, 50);
    world.rebuildSpatialHash();
    expect(world.findOverlappingPairs()).toHaveLength(0);
  });
});
