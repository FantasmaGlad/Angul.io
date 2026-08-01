import { describe, expect, it } from 'vitest';
import { listAvailableModIds, loadModConfig } from './loadConfig.js';
import { applyPassiveDecay } from './physics.js';

describe('loadModConfig', () => {
  it('charge server/configs/vanilla.json avec les valeurs attendues', () => {
    const config = loadModConfig('vanilla');
    expect(config.id).toBe('vanilla');
    expect(config.player.startMass).toBe(50);
    expect(config.player.maxSplits).toBe(16);
    expect(config.physics.speedMultiplier).toBe(1.5);
    expect(config.arena.borderType).toBe('STRICT_WALL');
  });

  it('charge server/configs/hardcore.json avec les valeurs attendues', () => {
    const config = loadModConfig('hardcore');
    expect(config.id).toBe('hardcore');
    expect(config.player.startMass).toBe(50);
    expect(config.arena.borderType).toBe('STRICT_WALL');
  });

  it('lève une erreur explicite pour un mod inconnu', () => {
    expect(() => loadModConfig('inexistant')).toThrow(/introuvable/);
  });
});

describe('listAvailableModIds', () => {
  it('liste hardcore et vanilla (triés par ordre alphabétique)', () => {
    expect(listAvailableModIds()).toEqual(['hardcore', 'vanilla']);
  });
});

describe('decay.tiers — cahier des charges §4d (perte de masse douce en Vanilla, punitive en Hardcore)', () => {
  it('à masse égale et après le même temps, Hardcore fait perdre nettement plus de masse que Vanilla', () => {
    const vanilla = loadModConfig('vanilla');
    const hardcore = loadModConfig('hardcore');
    const masses = [1_000, 5_000, 15_000, 30_000];
    for (const mass of masses) {
      const remainingVanilla = applyPassiveDecay(mass, 60, vanilla, 60);
      const remainingHardcore = applyPassiveDecay(mass, 60, hardcore, 60);
      // Les deux perdent forcément un peu (60s de grâce dépassée dans les deux modes), mais
      // Hardcore doit toujours perdre strictement plus, en proportion, que Vanilla.
      const lostFractionVanilla = 1 - remainingVanilla / mass;
      const lostFractionHardcore = 1 - remainingHardcore / mass;
      expect(lostFractionHardcore).toBeGreaterThan(lostFractionVanilla);
    }
  });

  it('Vanilla reste peu punitif : un blob de taille moyenne perd moins de 5% de sa masse par minute', () => {
    const vanilla = loadModConfig('vanilla');
    const remaining = applyPassiveDecay(5_000, 60, vanilla, 60);
    expect(remaining).toBeGreaterThan(5_000 * 0.95);
  });

  it('Hardcore reste utilisable : un blob à peine plus gros que la masse de spawn ne perd rien (grâce/palier initial)', () => {
    const hardcore = loadModConfig('hardcore');
    const remaining = applyPassiveDecay(100, 60, hardcore, 60);
    expect(remaining).toBe(100);
  });
});
