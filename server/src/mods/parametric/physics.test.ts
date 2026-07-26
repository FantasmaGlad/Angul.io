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

describe('applyPassiveDecay', () => {
  it('perd environ 1% en 5s au-dessus de la masse de départ', () => {
    expect(applyPassiveDecay(100, 5, testConfig())).toBeCloseTo(99, 1);
  });

  it('ne perd rien au plancher', () => {
    expect(applyPassiveDecay(2, 1000, testConfig())).toBe(2);
  });
});

describe('foodTargetCount', () => {
  it('dérive le nombre cible de la densité et de la surface de la carte', () => {
    const config = testConfig({
      arena: { width: 2000, height: 1000, borderType: 'STRICT_WALL' },
      food: { density: 10, respawnRatePerSecond: 1, massMin: 1, massMax: 1, massSkewExponent: 1 },
    });
    // surface = 2000*1000 = 2 000 000 px² = 2 blocs de 1000x1000 -> 2 * densité(10) = 20
    expect(foodTargetCount(config)).toBe(20);
  });
});

describe('randomFoodMass', () => {
  it('retourne massMin quand massMin === massMax (Vanilla)', () => {
    const config = testConfig();
    for (let i = 0; i < 20; i++) {
      expect(randomFoodMass(config)).toBe(1);
    }
  });

  it('reste dans [massMin, massMax] quand la plage est variable (Folie)', () => {
    const config = testConfig({
      food: { density: 30, respawnRatePerSecond: 200, massMin: 2, massMax: 8, massSkewExponent: 2 },
    });
    for (let i = 0; i < 200; i++) {
      const mass = randomFoodMass(config);
      expect(mass).toBeGreaterThanOrEqual(2);
      expect(mass).toBeLessThanOrEqual(8);
    }
  });
});
