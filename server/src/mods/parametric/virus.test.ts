import { describe, expect, it } from 'vitest';
import { massToRadius } from '@angulio/shared';
import { World } from '../../engine/world.js';
import { createParametricMod } from './index.js';
import type { ParametricModConfig } from './config.js';

function createTestConfig(virusType: 1 | 2 | 3): ParametricModConfig {
  return {
    id: `test-virus-${virusType}`,
    player: {
      startMass: 50,
      maxSplits: 64,
      minSplitMass: 100,
      splitEnabled: true,
      ejectEnabled: true,
    },
    physics: {
      v0: 300,
      speedMultiplier: 1.5,
      speedMassExponent: 0.5,
      velocityFloor: 20,
      accelerationBase: 1000,
      accelerationMassExponent: 0.5,
    },
    split: {
      ejectEfficiency: 1.0,
      ejectSpeedFactor: 2.0,
    },
    eject: {
      amount: 20,
      value: 20,
    },
    merge: {
      baseTimeSec: 30,
      massFactor: 0.02,
      overlapMinFraction: 0.33,
    },
    eating: {
      massAdvantage: 0.05,
      minMassToEatFood: 2,
    },
    decay: {
      tiers: [],
      graceSec: 10,
      floor: 50,
    },
    arena: {
      width: 10000,
      height: 10000,
      borderType: 'STRICT_WALL',
    },
    food: {
      density: 4,
      respawnRatePerSecond: 0,
      pelletTypes: [{ color: '#0047ab', mass: 1, weight: 100 }],
    },
    virus: {
      enabled: true,
      type: virusType,
      densityPer10k: 1,
    },
    areaConstant: 6,
  };
}

describe('Virus Mechanics', () => {
  it('Virus Vert (ID 1): small players hide inside, large players explode into 16 pieces', () => {
    const config = createTestConfig(1);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    world.addPlayer('p1', 'Player 1');
    const smallPiece = world.spawnPiece('p1', { x: 1000, y: 1000 }, 100);
    const virus = world.spawnVirus({ x: 1000, y: 1000 }, 200, 1);

    // Collision avec petit joueur (masse 100 < 200)
    mod.onCollision(world, smallPiece, virus, 0.016);
    expect(world.getEntity(smallPiece.id)).toBeDefined();
    expect(world.getEntity(virus.id)).toBeDefined();

    // Collision avec grand joueur (masse 250 >= 200)
    world.addPlayer('p2', 'Player 2');
    const largePiece = world.spawnPiece('p2', { x: 1000, y: 1000 }, 250);
    mod.onCollision(world, largePiece, virus, 0.016);

    // Le virus doit être supprimé
    expect(world.getEntity(virus.id)).toBeUndefined();
    // Le joueur doit être divisé en 16 morceaux
    const p2Pieces = world.getPiecesByOwner('p2');
    expect(p2Pieces.length).toBe(16);
  });

  it('Virus Rouge (ID 2): consumes smaller players (< 300 mass), explodes large players (>= 315 mass) into 32 pieces', () => {
    const config = createTestConfig(2);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    const virus = world.spawnVirus({ x: 500, y: 500 }, 300, 2);
    world.addPlayer('p1', 'Player 1');
    const smallPiece = world.spawnPiece('p1', { x: 500, y: 500 }, 150);

    // Virus rouge consomme le joueur plus petit (< 300)
    mod.onCollision(world, smallPiece, virus, 0.016);
    expect(world.getEntity(smallPiece.id)).toBeUndefined();
    expect(virus.mass).toBe(450);

    // Grand joueur (masse 500 >= 315) mange le virus rouge
    world.addPlayer('p2', 'Player 2');
    const bigPiece = world.spawnPiece('p2', { x: 500, y: 500 }, 500);

    mod.onCollision(world, bigPiece, virus, 0.016);
    expect(world.getEntity(virus.id)).toBeUndefined();
    const p2Pieces = world.getPiecesByOwner('p2');
    expect(p2Pieces.length).toBe(32);
  });

  it('Virus Rouge (ID 2): la masse grandit sans plafond, mais le rayon suit exactement la même courbe géométrique qu’un morceau de joueur (régression, incident prod Hardcore 2026-08-04)', () => {
    const config = createTestConfig(2);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    const virus = world.spawnVirus({ x: 500, y: 500 }, 300, 2);
    world.addPlayer('p1', 'Player 1');

    // Enchaîne des absorptions toujours juste sous la masse courante du virus (jamais assez pour
    // l'exploser) — la masse doit grandir sans AUCUNE limite (design voulu : le virus peut devenir
    // réellement immense), mais son rayon doit rester celui de `massToRadius` (courbe standard des
    // blobs, shared/geometry.ts, plate à haute masse) — jamais l'ancienne formule custom `150 *
    // sqrt(mass/300)`, bien plus raide, dont la croissance auto-alimentée (plus gros -> mange plus
    // -> encore plus gros) a fait exploser le coût de collision par tick en production.
    for (let i = 0; i < 10; i++) {
      const piece = world.spawnPiece('p1', { x: 500, y: 500 }, virus.mass * 0.9);
      mod.onCollision(world, piece, virus, 0.016);
      expect(world.getEntity(piece.id)).toBeUndefined();
    }

    expect(virus.mass).toBeGreaterThan(100_000); // aucun plafond de masse
    expect(virus.radius).toBeCloseTo(massToRadius(virus.mass), 5);
  });

  it('Virus Rouge (ID 2): la masse gagnée par nourriture éjectée dessus n’est pas plafonnée non plus et suit la même courbe', () => {
    const config = createTestConfig(2);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    const virus = world.spawnVirus({ x: 500, y: 500 }, 300, 2);

    // Un joueur qui spamme l'éjection de masse sur le virus est un second chemin vers la même
    // masse (`virus.mass`), indépendant de l'absorption de morceaux ci-dessus — même courbe de
    // rayon attendue dans les deux cas.
    for (let i = 0; i < 500; i++) {
      const particle = world.spawnParticle({ x: 500, y: 500 }, 40);
      mod.onCollision(world, particle, virus, 0.016);
    }

    expect(virus.mass).toBe(300 + 500 * 40);
    expect(virus.radius).toBeCloseTo(massToRadius(virus.mass), 5);
  });

  it('Virus Bleu (ID 3): performs 4x4 (16) chain reaction split over 2 ticks', () => {
    const config = createTestConfig(3);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    const virus = world.spawnVirus({ x: 1000, y: 1000 }, 200, 3);
    world.addPlayer('p1', 'Player 1');
    const piece = world.spawnPiece('p1', { x: 1000, y: 1000 }, 300);

    // Étape 1 : collision immédiate -> 4 morceaux
    mod.onCollision(world, piece, virus, 0.016);
    expect(world.getEntity(virus.id)).toBeUndefined();
    let pieces = world.getPiecesByOwner('p1');
    expect(pieces.length).toBe(4);

    // Étape 2 : tick suivant -> chaque morceau re-splitte en 4 -> 16 morceaux au total
    mod.onTick(world, 0.016);
    pieces = world.getPiecesByOwner('p1');
    expect(pieces.length).toBe(16);
  });

  it('Virus Vert (ID 1): feeding 200 mass via ejected particles duplicates the virus', () => {
    const config = createTestConfig(1);
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 10000 });

    const virus = world.spawnVirus({ x: 2000, y: 2000 }, 200, 1);
    const initialViruses = world.allEntities().filter((e) => e.kind === 'virus');
    expect(initialViruses.length).toBe(1);

    // Nourrit le virus de 200 de masse (10 particules de masse 20)
    for (let i = 0; i < 10; i++) {
      const particle = world.spawnParticle({ x: 2000, y: 2000 }, 20);
      particle.velocity = { x: 100, y: 0 };
      mod.onCollision(world, particle, virus, 0.016);
    }

    const afterViruses = world.allEntities().filter((e) => e.kind === 'virus');
    expect(afterViruses.length).toBe(2);
  });

  it('Virus Vert (ID 1): la duplication est plafonnée à un multiple de la population visée (régression, même famille de bug que le Virus Rouge)', () => {
    // Arène minuscule pour que `targetVirusCount()` retombe sur son plancher (1) — le plafond de
    // duplication (VIRUS_DUPLICATION_HEADROOM = 3x, mods/parametric/index.ts) vaut alors 3.
    const config: ParametricModConfig = {
      ...createTestConfig(1),
      arena: { width: 100, height: 100, borderType: 'STRICT_WALL' },
    };
    const mod = createParametricMod(config);
    const world = new World({ mapSize: 100 });

    // Sature la population de virus AU-DELÀ du plafond avant de tenter une nouvelle duplication —
    // sans plafond, nourrir un virus déjà dupliqué peut lui aussi redupliquer (le duplicata hérite
    // d'une vélocité de tir qui le fait traverser le champ de nourriture en mouvement), un nombre
    // d'entités qui s'emballe en chaîne.
    const virus = world.spawnVirus({ x: 10, y: 10 }, 200, 1);
    for (let i = 1; i < 5; i++) {
      world.spawnVirus({ x: 10 + i, y: 10 }, 200, 1);
    }
    const beforeCount = world.allEntities().filter((e) => e.kind === 'virus' && e.virusId === 1).length;
    expect(beforeCount).toBe(5); // déjà au-delà du plafond (3)

    for (let i = 0; i < 10; i++) {
      const particle = world.spawnParticle({ x: 10, y: 10 }, 20);
      particle.velocity = { x: 100, y: 0 };
      mod.onCollision(world, particle, virus, 0.016);
    }

    const afterCount = world.allEntities().filter((e) => e.kind === 'virus' && e.virusId === 1).length;
    expect(afterCount).toBe(beforeCount); // aucune nouvelle duplication au-delà du plafond
  });
});
