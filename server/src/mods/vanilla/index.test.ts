import { describe, expect, it } from 'vitest';
import { World } from '../../engine/world.js';
import { VANILLA_CONSTANTS as C } from './constants.js';
import { vanillaMod } from './index.js';
import { pieceState } from './pieceState.js';
import { velocityForMass } from './physics.js';

function freshWorld(mapSize = 1000): World {
  return new World({ mapSize });
}

describe('vanillaMod.onPlayerJoin — metriques.md/§3.5', () => {
  it('fait apparaître un unique morceau à la masse de départ (50)', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');

    vanillaMod.onPlayerJoin?.(world, 'p1');

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.mass).toBe(C.M_START);
  });
});

describe('vanillaMod.onTick — vitesse et decay', () => {
  it('fixe la vélocité selon v(m) dans la direction de l’input', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    vanillaMod.onPlayerInput?.(world, 'p1', { dir: { x: 1, y: 0 }, split: false });
    vanillaMod.onTick?.(world, 0.1);

    expect(piece.velocity.x).toBeCloseTo(velocityForMass(50), 6);
    expect(piece.velocity.y).toBeCloseTo(0, 6);
  });

  it('applique la decay passive (~1% en 5s au-dessus de 50)', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    vanillaMod.onTick?.(world, 5);

    expect(piece.mass).toBeCloseTo(99, 1);
  });
});

describe('vanillaMod.onPlayerInput — split (metriques.md §9)', () => {
  it('divise un morceau ≥ 100 en 2 morceaux de masse égale', () => {
    const world = freshWorld(2000);
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 1000, y: 1000 }, 200);

    vanillaMod.onPlayerInput?.(world, 'p1', { dir: { x: 1, y: 0 }, split: true });

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(2);
    expect(pieces[0]?.mass).toBeCloseTo(100, 6);
    expect(pieces[1]?.mass).toBeCloseTo(100, 6);

    const origin = pieces.find((p) => p.id === piece.id);
    const ejected = pieces.find((p) => p.id !== piece.id);
    expect(origin?.position.x).toBeCloseTo(1000, 6);
    expect(ejected && ejected.position.x).toBeGreaterThan(1000);
  });

  it('ne fait rien en-dessous de la masse minimale de split (100)', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    vanillaMod.onPlayerInput?.(world, 'p1', { dir: { x: 1, y: 0 }, split: true });

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });
});

describe('vanillaMod.onCollision — fusion (metriques.md §10)', () => {
  it('fusionne deux morceaux du même joueur après cooldown et chevauchement suffisant', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100); // rayon 10
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100); // distance 5, gros chevauchement
    pieceState(a).splitElapsedS = C.T_MERGE_COOLDOWN;
    pieceState(b).splitElapsedS = C.T_MERGE_COOLDOWN;

    vanillaMod.onCollision?.(world, a, b);

    const remaining = world.getPiecesByOwner('p1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.mass).toBeCloseTo(200, 6);
  });

  it('ne fusionne pas avant la fin du cooldown', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = 5;
    pieceState(b).splitElapsedS = C.T_MERGE_COOLDOWN;

    vanillaMod.onCollision?.(world, a, b);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2);
  });

  it('ne fusionne pas si le chevauchement est insuffisant même après le cooldown', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100); // rayon 10
    const b = world.spawnPiece('p1', { x: 519, y: 500 }, 100); // presque tangents (somme des rayons 20)
    pieceState(a).splitElapsedS = C.T_MERGE_COOLDOWN;
    pieceState(b).splitElapsedS = C.T_MERGE_COOLDOWN;

    vanillaMod.onCollision?.(world, a, b);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2);
  });
});

describe('vanillaMod.onCollision — manger un autre joueur (metriques.md §7)', () => {
  it('mange la cible avec au moins 5% de masse en plus', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    vanillaMod.onCollision?.(world, attacker, target);

    expect(world.getEntity(target.id)).toBeUndefined();
    expect(attacker.mass).toBeCloseTo(205, 6);
  });

  it('repousse les deux morceaux si aucun n’a l’avantage de masse requis', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p2', { x: 505, y: 500 }, 100);

    vanillaMod.onCollision?.(world, a, b);

    expect(world.getEntity(a.id)).toBeDefined();
    expect(world.getEntity(b.id)).toBeDefined();
    expect(a.position.x).toBeLessThan(500);
    expect(b.position.x).toBeGreaterThan(505);
  });
});

describe('vanillaMod.onCollision — manger de la nourriture (metriques.md §6)', () => {
  it('mange une particule si la masse est ≥ 2', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, C.M_FOOD);

    vanillaMod.onCollision?.(world, piece, particle);

    expect(world.getEntity(particle.id)).toBeUndefined();
    expect(piece.mass).toBeCloseTo(51, 6);
  });

  it('ne mange pas si la masse est sous le seuil minimal (2)', () => {
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 1.5);
    const particle = world.spawnParticle({ x: 500, y: 500 }, C.M_FOOD);

    vanillaMod.onCollision?.(world, piece, particle);

    expect(world.getEntity(particle.id)).toBeDefined();
    expect(piece.mass).toBeCloseTo(1.5, 6);
  });
});

describe('vanillaMod.onPostMove — mur bloquant (metriques.md §11)', () => {
  it('bloque la position au bord de la carte et annule la vélocité perpendiculaire', () => {
    const world = freshWorld(100);
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: -5, y: 50 }, 50);
    piece.velocity = { x: -10, y: 0 };

    vanillaMod.onPostMove?.(world, 0.1);

    expect(piece.position.x).toBeCloseTo(piece.radius, 6);
    expect(piece.velocity.x).toBe(0);
  });
});
