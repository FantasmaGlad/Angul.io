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

  describe('test balayé (correctif tunneling — retour utilisateur : un petit morceau splitté traversé sans être mangé)', () => {
    it("détecte une collision qui ne se produit qu'EN COURS de trajet ce tick (ni au départ, ni à l'arrivée)", () => {
      const world = new World({ mapSize: 1000 });
      // Petite entité stationnaire (rayon ≈ 7.07) au milieu du trajet de l'autre.
      const stationary = world.spawnParticle({ x: 100, y: 0 }, 50);
      stationary.previousPosition = { x: 100, y: 0 };
      // Entité rapide : partie de (0,0), arrivée à (200,0) ce tick — traverse (100,0) en plein
      // milieu du trajet, sans jamais se recouvrir ni au départ ni à l'arrivée (distance finale
      // 100px, très supérieure à la somme des rayons ≈ 14.14px).
      const fast = world.spawnParticle({ x: 200, y: 0 }, 50);
      fast.previousPosition = { x: 0, y: 0 };
      world.rebuildSpatialHash();

      const pairs = world.findOverlappingPairs();

      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([stationary.id, fast.id]));
    });

    it('ne détecte rien si le trajet balayé passe à côté sans jamais recouper le rayon', () => {
      const world = new World({ mapSize: 1000 });
      const stationary = world.spawnParticle({ x: 100, y: 100 }, 50); // rayon ≈ 7.07
      stationary.previousPosition = { x: 100, y: 100 };
      const fast = world.spawnParticle({ x: 200, y: 0 }, 50); // trajet horizontal, y=0 partout
      fast.previousPosition = { x: 0, y: 0 };
      world.rebuildSpatialHash();

      expect(world.findOverlappingPairs()).toHaveLength(0);
    });
  });

  describe('grandes entités (Blobs Challenger et assimilés, voir spatialHash.ts)', () => {
    // Régression : une grande entité (jamais insérée dans la grille, voir SpatialHash) dont le
    // rayon dépasse largement le rayon de recherche fixe (`cellSize`) de `queryNearby` doit quand
    // même être appariée avec une petite entité en bordure de son PROPRE grand rayon — bug
    // constaté et corrigé lors du calibrage initial de ce correctif (une version intermédiaire
    // manquait ce chevauchement, la requête de la petite entité découvrant bien la grande, mais
    // l'ordre `entity.id < otherId` désignait alors la grande comme "responsable" de la paire —
    // dont la propre requête, à rayon fixe, ne pouvait pas se voir aussi loin).
    it('détecte le chevauchement entre une grande entité et une petite entité en bordure de son rayon', () => {
      const world = new World({ mapSize: 20000 });
      const giant = world.spawnParticle({ x: 10000, y: 10000 }, 2500); // rayon ≈ 222.7 (> 50*1.5)
      const small = world.spawnParticle(
        { x: 10000 + giant.radius - 5, y: 10000 },
        10,
      ); // à 5px à l'intérieur du bord du géant
      world.rebuildSpatialHash();
      const pairs = world.findOverlappingPairs();
      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([giant.id, small.id]));
    });

    it("ne détecte rien pour une petite entité hors de portée d'une grande", () => {
      const world = new World({ mapSize: 20000 });
      const giant = world.spawnParticle({ x: 10000, y: 10000 }, 2500);
      world.spawnParticle({ x: 10000 + giant.radius + 100, y: 10000 }, 10); // 100px au-delà du bord
      world.rebuildSpatialHash();
      expect(world.findOverlappingPairs()).toHaveLength(0);
    });

    it('détecte le chevauchement entre deux grandes entités', () => {
      const world = new World({ mapSize: 20000 });
      const giantA = world.spawnParticle({ x: 10000, y: 10000 }, 2500);
      const giantB = world.spawnParticle({ x: 10000 + giantA.radius, y: 10000 }, 2500); // centres distants du rayon d'un seul -> chevauchement franc
      world.rebuildSpatialHash();
      const pairs = world.findOverlappingPairs();
      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([giantA.id, giantB.id]));
    });
  });
});
