import type { ParametricModConfig } from './config.js';

/** Config de test, valeurs alignées sur server/configs/vanilla.json — un objet en dur plutôt
 * qu'un chargement de fichier pour garder les tests unitaires indépendants du disque. Utiliser
 * `testConfig({ ... })` pour ne surcharger que les champs pertinents à un test donné. */
export function testConfig(overrides: Partial<ParametricModConfig> = {}): ParametricModConfig {
  return {
    id: 'test',
    player: { startMass: 50, maxSplits: 16, minSplitMass: 100 },
    physics: {
      v0: 700,
      speedMultiplier: 1,
      speedMassExponent: 0.10,
      velocityFloor: 20,
      accelerationBase: 1500,
      accelerationMassExponent: 0.7,
    },
    split: { ejectEfficiency: 1, ejectSpeedFactor: 2 },
    eject: { amount: 5 },
    merge: { baseTimeSec: 30, massFactor: 0, overlapMinFraction: 0.3 },
    eating: { massAdvantage: 0.05, minMassToEatFood: 2 },
    decay: {
      threshold: 100,
      rateAboveThreshold: 0.02,
      intervalAboveThresholdSec: 5,
      rateBelowThreshold: 0.01,
      intervalBelowThresholdSec: 5,
      floor: 2,
    },
    arena: { width: 15000, height: 15000, borderType: 'STRICT_WALL' },
    food: {
      density: 30,
      respawnRatePerSecond: 100,
      pelletTypes: [{ color: 'vert', mass: 1, weight: 1 }],
    },
    areaConstant: 6,
    ...overrides,
  };
}
