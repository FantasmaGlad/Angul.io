import { distance } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import { World } from '../../engine/world.js';
import { createParametricMod } from './index.js';
import { pieceState } from './pieceState.js';
import { testConfig } from './testConfig.js';
import { accelerationForMass, velocityForMass } from './physics.js';

function freshWorld(mapSize = 15000): World {
  return new World({ mapSize });
}

describe('createParametricMod — getAccelerationForMass', () => {
  it('délègue à accelerationForMass avec la config du mod (panneau de stats client)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);

    expect(mod.getAccelerationForMass?.(200)).toBeCloseTo(accelerationForMass(200, config), 6);
  });
});

describe('createParametricMod — onPlayerJoin', () => {
  it('fait apparaître un unique morceau à la masse de départ du config', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');

    mod.onPlayerJoin?.(world, 'p1');

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.mass).toBe(config.player.startMass);
  });
});

describe('createParametricMod — onTick (vitesse/accélération)', () => {
  it('accélère vers v(m) sans la dépasser dans la direction de l’input', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false });
    // dt assez grand pour que l'accélération (1500 px/s²) atteigne v(50)=300 px/s en un seul tick
    mod.onTick?.(world, 0.2);

    expect(piece.velocity.x).toBeCloseTo(velocityForMass(50, config), 6);
    expect(piece.velocity.y).toBeCloseTo(0, 6);
  });

  it('ne saute pas instantanément à la vitesse cible sur un tick trop court (inertie)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: false });
    mod.onTick?.(world, 0.01); // 1500*0.01 = 15 px/s de changement max, très inférieur à 300

    expect(piece.velocity.x).toBeCloseTo(15, 6);
  });

  it('réduit la vitesse cible ET le taux d’accélération proportionnellement à l’intensité du curseur', () => {
    const config = testConfig({ decay: { floor: 100 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    // intensité 50% (curseur à mi-chemin du rayon de contrôle), direction +x
    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 0.5, split: false });
    mod.onTick?.(world, 0.1); // 1500*0.1*0.5 = 75 px/s de changement max, sous la cible réduite (150)

    expect(piece.velocity.x).toBeCloseTo(75, 6);

    mod.onTick?.(world, 1); // largement assez pour converger vers la cible réduite
    expect(piece.velocity.x).toBeCloseTo(velocityForMass(50, config) * 0.5, 5);
  });

  it('applique la decay passive', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onTick?.(world, 5);

    // 0.5% par 10s pour masse 100 -> ~0.25% en 5s -> 99.75
    expect(piece.mass).toBeCloseTo(99.75, 1);
  });
});

describe('createParametricMod — split', () => {
  it('divise un morceau en 2, avec une vitesse d’éjection initiale', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 1000, y: 1000 }, 200);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 1100, y: 1000 }, intensity: 1, split: true });

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(2);
    const origin = pieces.find((p) => p.id === piece.id);
    const ejected = pieces.find((p) => p.id !== piece.id);

    expect(origin?.mass).toBeCloseTo(100, 6);
    expect(ejected?.mass).toBeCloseTo(100, 6); // eta_W = 1 dans le config de test
    expect(ejected && ejected.velocity.x).toBeGreaterThan(0); // boost initial dans la direction du split
  });

  it('crée de la masse quand ejectEfficiency > 1 (comportement "Folie")', () => {
    const config = testConfig({ split: { ejectEfficiency: 1.2, ejectSpeedFactor: 2 } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 1000, y: 1000 }, 200);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 1100, y: 1000 }, intensity: 1, split: true });

    const pieces = world.getPiecesByOwner('p1');
    const totalMass = pieces.reduce((sum, p) => sum + p.mass, 0);
    expect(totalMass).toBeCloseTo(220, 6); // 100 (origine) + 100*1.2 (éjecté)
  });

  it('ne fait rien en-dessous de minSplitMass', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.spawnPiece('p1', { x: 500, y: 500 }, 50);

    mod.onPlayerInput?.(world, 'p1', { target: { x: 600, y: 500 }, intensity: 1, split: true });

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });
});

describe('createParametricMod — fusion', () => {
  it('fusionne deux morceaux du même joueur après cooldown et chevauchement suffisant', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = config.merge.baseTimeSec;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    mod.onCollision?.(world, a, b);

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });

  it('ne fusionne pas avant la fin du cooldown', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = 1;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    mod.onCollision?.(world, a, b);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2);
  });

  it('repousse les morceaux du même joueur tant que la fusion n’est pas possible (correctif : ils se chevauchaient librement au lieu de collisionner)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100); // très chevauchés (5px d'écart)
    pieceState(a).splitElapsedS = 1; // cooldown post-split pas écoulé
    pieceState(b).splitElapsedS = 1;
    const distanceBefore = distance(a.position, b.position);

    mod.onCollision?.(world, a, b);

    expect(world.getPiecesByOwner('p1')).toHaveLength(2); // toujours pas fusionnés
    expect(distance(a.position, b.position)).toBeGreaterThan(distanceBefore); // repoussés
  });

  it('ne repousse plus une fois la fusion effectuée (un seul morceau restant)', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 505, y: 500 }, 100);
    pieceState(a).splitElapsedS = config.merge.baseTimeSec;
    pieceState(b).splitElapsedS = config.merge.baseTimeSec;

    expect(() => mod.onCollision?.(world, a, b)).not.toThrow();
    expect(world.getPiecesByOwner('p1')).toHaveLength(1);
  });
});

describe('createParametricMod — manger', () => {
  it('mange un autre joueur avec l’avantage de masse requis', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target);

    expect(world.getEntity(target.id)).toBeUndefined();
    expect(attacker.mass).toBeCloseTo(205, 6);
  });

  it('mange une particule si la masse est suffisante', () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, 1);

    mod.onCollision?.(world, piece, particle);

    expect(world.getEntity(particle.id)).toBeUndefined();
    expect(piece.mass).toBeCloseTo(51, 6);
  });

  it("crédite l'XP au joueur qui mange un autre joueur (masse + bonus fixe, engine/xp.ts)", () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBe(100);
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBe(100 + 400); // 1 masse = 1xp + bonus fixe de 400xp
  });

  it("crédite l'XP de masse (mais pas le bonus joueur) en mangeant une particule", () => {
    const config = testConfig();
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, 7);

    mod.onCollision?.(world, piece, particle);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBe(7);
    expect(stats.playersEaten).toBe(0);
    expect(stats.xpEarned).toBe(7);
  });
});

describe('createParametricMod — onPostMove (bords de carte)', () => {
  it('délègue au comportement de bord configuré (STRICT_WALL par défaut)', () => {
    const config = testConfig({ arena: { width: 100, height: 100, borderType: 'STRICT_WALL' } });
    const mod = createParametricMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: -5, y: 50 }, 50);
    piece.velocity = { x: -10, y: 0 };

    mod.onPostMove?.(world, 0.1);

    expect(piece.position.x).toBeCloseTo(piece.radius, 6);
    expect(piece.velocity.x).toBe(0);
  });
});
