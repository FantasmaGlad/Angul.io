import { describe, expect, it } from 'vitest';
import type { GameMod } from '../../engine/mod.js';
import { World } from '../../engine/world.js';
import { testConfig } from '../parametric/testConfig.js';
import { accelerationForMass, absorptionDurationSec } from '../parametric/physics.js';
import { createHardcoreMod } from './index.js';

function freshWorld(mapSize = 15000, kArea = testConfig().areaConstant): World {
  return new World({ mapSize, kArea });
}

/** Fait avancer le drain d'une absorption en cours (voir `beginConsumption`/
 * `advanceConsumptions`, mods/parametric/index.ts, appliqué aussi aux cibles marquées par
 * Hardcore) jusqu'à extinction — absorption PROGRESSIVE sur `absorptionDurationSec` (0.3s par
 * défaut) plutôt qu'un transfert en un seul tick. */
function finishConsumption(mod: GameMod, world: World, config = testConfig(), stepSec = 0.05): void {
  const steps = Math.ceil(absorptionDurationSec(config) / stepSec) + 1;
  for (let i = 0; i < steps; i++) mod.onTick?.(world, stepSec);
}

describe('createHardcoreMod — onCollision (absorption entre joueurs)', () => {
  it('multiplie la masse gagnée en mangeant un autre joueur (cahier des charges §3.4 #2 : "gains de masse multipliés x10 ou configurable") — la nourriture ambiante n\'est pas concernée : l\'agressivité voulue vient de la prédation entre joueurs, pas de la cueillette passive.', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);
    finishConsumption(mod, world, config);

    expect(world.getEntity(target.id)).toBeUndefined();
    // 120 + 100*2 = 320, pas 220 (comportement Vanilla)
    expect(attacker.mass).toBeCloseTo(320, 6);
  });

  it('absorbe PROGRESSIVEMENT, multiplicateur appliqué à chaque tranche transférée (pas seulement au total final)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    // Seuil de recouvrement franchi : l'absorption démarre, mais la cible n'est pas encore
    // retirée — voir `beginConsumption`.
    mod.onCollision?.(world, attacker, target, 1 / 20);
    expect(world.getEntity(target.id)).toBeDefined();
    expect(attacker.mass).toBeCloseTo(120, 6); // rien encore transféré

    const stepSec = 0.05;
    mod.onTick?.(world, stepSec); // une seule tranche de drain

    // Tranche attendue : (massAtStart / duration) * stepSec, multipliée par massGainMultiplier (x2)
    const duration = absorptionDurationSec(config);
    const expectedSlice = (100 / duration) * stepSec * 2;
    expect(attacker.mass).toBeCloseTo(120 + expectedSlice, 6);
    expect(world.getEntity(target.id)).toBeDefined(); // toujours pas entièrement mangée

    finishConsumption(mod, world, config);
    expect(world.getEntity(target.id)).toBeUndefined();
    expect(attacker.mass).toBeCloseTo(120 + 100 * 2, 6); // 120 + 200 au total, multiplicateur inclus à chaque tranche
  });

  it('respecte un multiplicateur personnalisé', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config, { massGainMultiplier: 3 });
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);
    finishConsumption(mod, world, config);

    expect(attacker.mass).toBeCloseTo(120 + 100 * 3, 6);
  });

  it("crédite l'XP sur la masse gagnée déjà multipliée (x2), pas la masse brute de la cible", () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const attacker = world.spawnPiece('p1', { x: 500, y: 500 }, 120);
    const target = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, attacker, target, 1 / 20);
    finishConsumption(mod, world, config);

    const stats = world.getPlayer('p1')!.lifeStats;
    expect(stats.massEaten).toBeCloseTo(200, 6); // 100 * 2
    expect(stats.playersEaten).toBe(1);
    expect(stats.xpEarned).toBeCloseTo(200 + 400, 6);
  });

  it("n'absorbe pas sans l'avantage de masse requis (répulsion déléguée, inchangée)", () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    world.addPlayer('p2', 'Bob');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p2', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, a, b, 1 / 20);

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

    mod.onCollision?.(world, piece, particle, 1 / 20);

    expect(world.getEntity(particle.id)).toBeUndefined();
    expect(piece.mass).toBeCloseTo(51, 6); // +1 masse (sa masse reste la même, la cellule gagne en taille via areaConstant)
  });

  it('deux morceaux du même joueur fusionnent normalement (jamais absorbés avec multiplicateur)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Alice');
    const a = world.spawnPiece('p1', { x: 500, y: 500 }, 100);
    const b = world.spawnPiece('p1', { x: 500, y: 500 }, 100);

    mod.onCollision?.(world, a, b, 1 / 20);

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

describe('createHardcoreMod — Absence de malus/split punitif pour le leader', () => {
  it('ne divise jamais le leader, même très loin devant, même après de nombreux ticks', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'BigLeader');
    world.addPlayer('p2', 'SmallRunnerUp');

    world.spawnPiece('p1', { x: 500, y: 500 }, 5000);
    world.spawnPiece('p2', { x: 2000, y: 2000 }, 100);

    expect(world.getPiecesByOwner('p1')).toHaveLength(1);

    // Largement plus que l'ancien intervalle de vérification (20 ticks) du malus retiré — garde
    // de régression contre sa réintroduction, pas seulement contre un unique tick.
    for (let i = 0; i < 50; i++) mod.onTick?.(world, 0.05);

    const leaderPieces = world.getPiecesByOwner('p1');
    expect(leaderPieces.length).toBe(1);

    const runnerUpPieces = world.getPiecesByOwner('p2');
    expect(runnerUpPieces.length).toBe(1);
  });
});

describe('createHardcoreMod — Dash (touche F)', () => {
  it('propulse le blob vers l’avant quand le joueur a 1 seul morceau et des charges', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Dasher');
    mod.onPlayerJoin?.(world, 'p1');

    const pieces = world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    const piece = pieces[0]!;
    piece.position = { x: 500, y: 500 };
    piece.velocity = { x: 0, y: 0 };

    // Dash vers la droite (target x: 1000, y: 500)
    mod.onPlayerInput?.(world, 'p1', {
      target: { x: 1000, y: 500 },
      intensity: 1,
      split: false,
      dash: true,
    });

    expect(piece.velocity.x).toBeGreaterThan(500);

    const dashState = (mod as any).getDashState(world, 'p1');
    expect(dashState.charges).toBe(4);
    expect(dashState.canDash).toBe(false); // Cooldown 1s
  });

  it('interdit le dash si le joueur est divisé (> 1 morceau)', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'SplitPlayer');
    world.spawnPiece('p1', { x: 500, y: 500 }, 50);
    world.spawnPiece('p1', { x: 600, y: 500 }, 50);

    const dashState = (mod as any).getDashState(world, 'p1');
    expect(dashState.canDash).toBe(false);
  });

  it('recharge 1 charge au bout de 4 secondes', () => {
    const config = testConfig();
    const mod = createHardcoreMod(config);
    const world = freshWorld();
    world.addPlayer('p1', 'Dasher');
    mod.onPlayerJoin?.(world, 'p1');

    // Dash 1 fois
    mod.onPlayerInput?.(world, 'p1', {
      target: { x: 1000, y: 500 },
      intensity: 1,
      split: false,
      dash: true,
    });

    expect((mod as any).getDashState(world, 'p1').charges).toBe(4);

    // Écoulement de 4 secondes (80 ticks de 0.05s)
    for (let i = 0; i < 80; i++) {
      mod.onTick?.(world, 0.05);
    }

    expect((mod as any).getDashState(world, 'p1').charges).toBe(5);
  });
});
