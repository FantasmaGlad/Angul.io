import { describe, expect, it } from 'vitest';
import {
  accelerationForMass,
  applyPassiveDecay,
  foodTargetCount,
  randomFoodMass,
  velocityForMass,
} from './physics.js';
import { testConfig } from './testConfig.js';

describe('velocityForMass — v(m) = MAX(Vfloor, V0·kv·(M0/m)^gamma)', () => {
  const config = testConfig();

  it('vaut V0 à la masse de départ', () => {
    expect(velocityForMass(50, config)).toBeCloseTo(300, 6);
  });

  it('décroît avec la masse', () => {
    expect(velocityForMass(200, config)).toBeCloseTo(163.0102293789087, 6);
  });

  it('ne descend jamais sous Vfloor', () => {
    expect(velocityForMass(1_000_000, config)).toBe(20);
  });

  it('kv multiplie la vitesse globalement (mode "plus rapide")', () => {
    const fast = testConfig({
      physics: { ...config.physics, speedMultiplier: 2.5 },
    });
    expect(velocityForMass(50, fast)).toBeCloseTo(750, 6);
  });
});

describe('accelerationForMass — a(m) = A0·(M0/m)^alpha', () => {
  const config = testConfig();

  it('vaut A0 à la masse de départ', () => {
    expect(accelerationForMass(50, config)).toBeCloseTo(1500, 6);
  });

  it('décroît avec la masse (cellules plus grosses = moins réactives)', () => {
    expect(accelerationForMass(200, config)).toBeCloseTo(568.3937124413993, 6);
  });
});

describe('applyPassiveDecay — seuil Ml (§1 feuille Excel), pas la masse de départ', () => {
  it('perd 2% en 5s au-dessus du seuil (100)', () => {
    expect(applyPassiveDecay(200, 5, testConfig())).toBeCloseTo(196, 1);
  });

  it('perd 1% en 5s au niveau ou en-dessous du seuil', () => {
    expect(applyPassiveDecay(100, 5, testConfig())).toBeCloseTo(99, 1);
    expect(applyPassiveDecay(50, 5, testConfig())).toBeCloseTo(49.5, 1);
  });

  it('ne perd rien au plancher', () => {
    expect(applyPassiveDecay(2, 1000, testConfig())).toBe(2);
  });
});

describe('foodTargetCount', () => {
  it('dérive le nombre cible de la densité et de la surface de la carte', () => {
    const config = testConfig({
      arena: { width: 2000, height: 1000, borderType: 'STRICT_WALL' },
      food: {
        density: 10,
        respawnRatePerSecond: 1,
        pelletTypes: [{ color: 'vert', mass: 1, weight: 1 }],
      },
    });
    // surface = 2000*1000 = 2 000 000 px² = 2 blocs de 1000x1000 -> 2 * densité(10) = 20
    expect(foodTargetCount(config)).toBe(20);
  });
});

describe('randomFoodMass', () => {
  it('retourne l’unique masse configurée quand il n’y a qu’un seul type de pellet', () => {
    const config = testConfig();
    for (let i = 0; i < 20; i++) {
      expect(randomFoodMass(config)).toBe(1);
    }
  });

  it('ne renvoie jamais une masse absente de `pelletTypes` (plusieurs types, Folie-like)', () => {
    const config = testConfig({
      food: {
        density: 60,
        respawnRatePerSecond: 200,
        pelletTypes: [
          { color: 'vert', mass: 2, weight: 1 },
          { color: 'rouge', mass: 8, weight: 1 },
        ],
      },
    });
    const allowedMasses = new Set([2, 8]);
    for (let i = 0; i < 200; i++) {
      expect(allowedMasses.has(randomFoodMass(config))).toBe(true);
    }
  });

  it('respecte globalement le poids relatif de chaque type sur un grand nombre de tirages', () => {
    const config = testConfig({
      food: {
        density: 30,
        respawnRatePerSecond: 100,
        pelletTypes: [
          { color: 'vert', mass: 1, weight: 90 },
          { color: 'rouge', mass: 5, weight: 10 },
        ],
      },
    });
    const draws = 2000;
    let rareCount = 0;
    for (let i = 0; i < draws; i++) {
      if (randomFoodMass(config) === 5) rareCount++;
    }
    // ~10% attendu — marge large pour ne pas rendre le test flaky (variance statistique).
    const rareRatio = rareCount / draws;
    expect(rareRatio).toBeGreaterThan(0.05);
    expect(rareRatio).toBeLessThan(0.15);
  });

  it('ne plante pas si `pelletTypes` est vide (config invalide) — repli sur une masse de 1', () => {
    const config = testConfig({
      food: { density: 1, respawnRatePerSecond: 1, pelletTypes: [] },
    });
    expect(randomFoodMass(config)).toBe(1);
  });
});
