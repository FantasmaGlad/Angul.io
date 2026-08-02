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
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 0, y: 0 }, 50); // rayon ≈ 7.07
    const b = world.spawnPiece('p1', { x: 5, y: 0 }, 50); // distance 5 < 2*7.07 -> overlap
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

  describe("portée de recherche d'un morceau plus gros qu'une cellule (retour utilisateur : manger une pastille ne semble pas instantané)", () => {
    /** Morceau de rayon ≈ 62px : au-dessus de la taille de cellule (50px), donc il atteint
     * physiquement plus loin que l'ancien rayon de recherche FIXE de la première passe, mais
     * encore en-dessous du seuil "grande entité" (50 × 1.5 = 75px, voir spatialHash.ts) — donc pas
     * rattrapé non plus par la passe dédiée aux grandes entités. La bande d'angle mort exacte que
     * ce correctif ferme. */
    const PIECE_MASS = 150;

    /** Positionne le morceau PILE sur une frontière de cellule (100 = 2 × cellSize) et la pastille
     * du côté où la grille 3x3 de l'ancienne requête s'arrêtait le plus court (50px seulement à
     * gauche, contre 100px à droite) : la pastille est alors en chevauchement franc avec le
     * morceau (55px < 62 × 1.05 + 4.4 ≈ 69px) tout en tombant dans une cellule que l'ancienne
     * requête du morceau n'atteignait pas. */
    function spawnRimCase(pieceFirst: boolean) {
      const world = new World({ mapSize: 1000 });
      world.addPlayer('p1', 'Alice');
      const spawnPiece = () => world.spawnPiece('p1', { x: 100, y: 100 }, PIECE_MASS);
      const spawnFood = () => world.spawnParticle({ x: 45, y: 100 }, 1);
      // L'ordre de création fixe l'ordre des ids (compteur croissant, voir World.spawnEntity) —
      // donc lequel des deux le dédoublonnage `entity.id < otherId` désigne comme "responsable"
      // de la paire. Le bug ne se manifestait que dans un des deux sens.
      const piece = pieceFirst ? spawnPiece() : undefined;
      const food = spawnFood();
      const finalPiece = piece ?? spawnPiece();
      world.rebuildSpatialHash();
      return { world, piece: finalPiece, food };
    }

    it('détecte une pastille en bordure quand le morceau porte le plus PETIT id (le morceau doit trouver la pastille lui-même)', () => {
      const { world, piece, food } = spawnRimCase(true);
      expect(piece.radius).toBeGreaterThan(50);
      expect(piece.radius).toBeLessThan(75);

      const pairs = world.findOverlappingPairs();

      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([piece.id, food.id]));
    });

    it("détecte la même pastille — une seule fois — quand c'est la pastille qui porte le plus petit id", () => {
      const { world, piece, food } = spawnRimCase(false);

      const pairs = world.findOverlappingPairs();

      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([piece.id, food.id]));
    });

    it('ne détecte rien pour une pastille hors de portée réelle du morceau', () => {
      const world = new World({ mapSize: 1000 });
      world.addPlayer('p1', 'Alice');
      const piece = world.spawnPiece('p1', { x: 100, y: 100 }, PIECE_MASS);
      // 20px au-delà du bord du morceau (marge de contact comprise) : la requête élargie la voit
      // désormais, le test de chevauchement doit continuer de la rejeter.
      world.spawnParticle({ x: 100 - (piece.radius * 1.05 + 20), y: 100 }, 1);
      world.rebuildSpatialHash();

      expect(world.findOverlappingPairs()).toHaveLength(0);
    });
  });

  describe('test balayé (correctif tunneling — retour utilisateur : un petit morceau splitté traversé sans être mangé)', () => {
    it("détecte une collision qui ne se produit qu'EN COURS de trajet ce tick (ni au départ, ni à l'arrivée)", () => {
      const world = new World({ mapSize: 1000 });
      world.addPlayer('p1', 'Alice');
      // Petite entité stationnaire (rayon ≈ 7.07) au milieu du trajet de l'autre.
      const stationary = world.spawnParticle({ x: 100, y: 0 }, 50);
      stationary.previousPosition = { x: 100, y: 0 };
      // Entité rapide : partie de (0,0), arrivée à (200,0) ce tick — traverse (100,0) en plein
      // milieu du trajet.
      const fast = world.spawnPiece('p1', { x: 200, y: 0 }, 50);
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
      world.addPlayer('p1', 'Alice');
      const stationary = world.spawnParticle({ x: 100, y: 100 }, 50); // rayon ≈ 7.07
      stationary.previousPosition = { x: 100, y: 100 };
      const fast = world.spawnPiece('p1', { x: 200, y: 0 }, 50); // trajet horizontal, y=0 partout
      fast.previousPosition = { x: 0, y: 0 };
      world.rebuildSpatialHash();

      expect(world.findOverlappingPairs()).toHaveLength(0);
    });
  });

  describe('grandes entités (Blobs Challenger et assimilés, voir spatialHash.ts)', () => {
    it('détecte le chevauchement entre une grande entité et une petite entité en bordure de son rayon', () => {
      const world = new World({ mapSize: 20000 });
      world.addPlayer('p1', 'Alice');
      const giant = world.spawnPiece('p1', { x: 10000, y: 10000 }, 2500); // rayon ≈ 222.7
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
      world.addPlayer('p1', 'Alice');
      const giant = world.spawnPiece('p1', { x: 10000, y: 10000 }, 2500);
      world.spawnParticle({ x: 10000 + giant.radius + 100, y: 10000 }, 10); // 100px au-delà du bord
      world.rebuildSpatialHash();
      expect(world.findOverlappingPairs()).toHaveLength(0);
    });

    it('détecte le chevauchement entre deux grandes entités', () => {
      const world = new World({ mapSize: 20000 });
      world.addPlayer('p1', 'Alice');
      world.addPlayer('p2', 'Bob');
      const giantA = world.spawnPiece('p1', { x: 10000, y: 10000 }, 2500);
      const giantB = world.spawnPiece('p2', { x: 10000 + giantA.radius, y: 10000 }, 2500);
      world.rebuildSpatialHash();
      const pairs = world.findOverlappingPairs();
      expect(pairs).toHaveLength(1);
      const pair = pairs[0];
      if (!pair) throw new Error('expected one overlapping pair');
      expect(new Set([pair[0].id, pair[1].id])).toEqual(new Set([giantA.id, giantB.id]));
    });
  });
});
