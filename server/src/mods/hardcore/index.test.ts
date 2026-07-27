import { describe, expect, it } from 'vitest';
import { World } from '../../engine/world.js';
import { testConfig } from '../parametric/testConfig.js';
import { accelerationForMass } from '../parametric/physics.js';
import { createHardcoreMod } from './index.js';

function freshWorld(mapSize = 15000): World {
  return new World({ mapSize });
}

describe('createHardcoreMod — onCollision (absorption entre joueurs)', () => {
  it('multiplie la masse gagnée en mangeant un autre joueur (x10 par défaut)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target);

    expect(world.getEntity(target.id)).toBeUndefined();
    // 105 + 100*10 = 1105, pas 205 (comportement Vanilla) — la seule différence de ce mode.
    expect(attacker.mass).toBeCloseTo(1105, 6);
  });

  it('respecte un multiplicateur personnalisé', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config, { massGainMultiplier: 3 });
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target);

    expect(attacker.mass).toBeCloseTo(105 + 100 * 3, 6);
  });

  it("crédite l'XP sur la masse gagnée déjà multipliée (x10), pas la masse brute de la cible", () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 105);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBeCloseTo(1000, 6); // 100 * 10, pas 100
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBeCloseTo(1000 + 400, 6);
  });

  it("n'absorbe pas sans l'avantage de masse requis (répulsion déléguée, inchangée)", () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, a, b);

    expect(world.getEntity(a.id)).toBeDefined();
    expect(world.getEntity(b.id)).toBeDefined();
    expect(a.mass).toBe(100);
    expect(b.mass).toBe(100);
  });
});

describe('createHardcoreMod — onCollision (nourriture et fusion, comportement délégué)', () => {
  it('mange une particule normalement, sans multiplicateur', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const piece = world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    const particle = world.spawnParticle({ x: 500, y: 500 }, 1);

    mod.onCollision?.(world, piece, particle);

    expect(world.getEntity(particle.id)).toBeUndefined();
    expect(piece.mass).toBeCloseTo(51, 6); // +1, pas +10 : le multiplicateur ne concerne que les joueurs
  });

  it('deux morceaux du même joueur fusionnent normalement (jamais absorbés avec multiplicateur)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, a, b);

    // Fusion classique (comportement du mod paramétrique, cooldown déjà écoulé par défaut pour
    // un morceau jamais splitté — voir pieceState.ts) : un seul morceau restant, masse simplement
    // additionnée — jamais le multiplicateur d'absorption (réservé aux joueurs différents).
    const remaining = world.getPiecesByOwner('p1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.mass).toBeCloseTo(200, 6);
  });
});

describe('createHardcoreMod — transformScoreForAccount', () => {
  it('renvoie toujours {score:0, xp:0} (perte totale de la progression de la partie à la mort)', () => {
    const mod = createHardcoreMod(testConfig());
    expect(mod.transformScoreForAccount?.(500, 300)).toEqual({ score: 0, xp: 0 });
    expect(mod.transformScoreForAccount?.(0, 0)).toEqual({ score: 0, xp: 0 });
  });
});

describe('createHardcoreMod — hooks délégués au mod paramétrique sous-jacent', () => {
  it('onPlayerJoin fait apparaître un morceau à la masse de départ (identique à Vanilla)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');

    mod.onPlayerJoin?.(world, 'p1');

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]?.mass).toBe(config.player.startMass);
  });

  it('getAccelerationForMass délègue à la même formule que Vanilla', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    expect(mod.getAccelerationForMass?.(200)).toBeCloseTo(accelerationForMass(200, config), 6);
  });
});
