import { describe, expect, it } from 'vitest';
import { testConfig } from './testConfig.js';
import { validateParametricModConfig } from './validateConfig.js';

describe('validateParametricModConfig (A8, §13.2 cahier_des_charges_admin.md)', () => {
  it('accepte une config paramétrique valide (testConfig)', () => {
    const result = validateParametricModConfig(testConfig());
    expect(result.ok).toBe(true);
  });

  it('rejette une valeur non-objet', () => {
    const result = validateParametricModConfig('pas un objet');
    expect(result.ok).toBe(false);
  });

  it('rejette une config vide avec un message exploitable par section manquante', () => {
    const result = validateParametricModConfig({});
    expect(result.ok).toBe(false);
    if (!result.ok) {
      const paths = result.errors.map((e) => e.path);
      expect(paths).toContain('player');
      expect(paths).toContain('physics');
      expect(paths).toContain('arena');
      expect(paths).toContain('food');
    }
  });

  it('rejette un champ numérique remplacé par une chaîne, avec le chemin fautif', () => {
    const config = testConfig();
    const broken = { ...config, physics: { ...config.physics, v0: 'vite' as unknown as number } };
    const result = validateParametricModConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'physics.v0')).toBe(true);
    }
  });

  it('rejette un borderType hors énumération', () => {
    const config = testConfig();
    const broken = { ...config, arena: { ...config.arena, borderType: 'GRAVITY_WELL' } };
    const result = validateParametricModConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'arena.borderType')).toBe(true);
    }
  });

  it('rejette decay.tiers vide', () => {
    const config = testConfig();
    const broken = { ...config, decay: { ...config.decay, tiers: [] } };
    const result = validateParametricModConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'decay.tiers')).toBe(true);
    }
  });

  it('rejette un palier de decay incomplet (chemin indexé)', () => {
    const config = testConfig();
    const broken = { ...config, decay: { ...config.decay, tiers: [{ minMass: 0 }] } };
    const result = validateParametricModConfig(broken);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'decay.tiers[0].rate')).toBe(true);
      expect(result.errors.some((e) => e.path === 'decay.tiers[0].intervalSec')).toBe(true);
    }
  });

  it('rejette food.pelletTypes vide', () => {
    const config = testConfig();
    const broken = { ...config, food: { ...config.food, pelletTypes: [] } };
    const result = validateParametricModConfig(broken);
    expect(result.ok).toBe(false);
  });

  it('accepte bots/virus/room absents (optionnels)', () => {
    const config = testConfig();
    expect('bots' in config).toBe(false);
    const result = validateParametricModConfig(config);
    expect(result.ok).toBe(true);
  });

  it('rejette virus.type hors {1,2,3}', () => {
    const config = testConfig({ virus: { enabled: true, type: 4 as unknown as 1 } });
    const result = validateParametricModConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'virus.type')).toBe(true);
    }
  });

  it('rejette bots présent sans champ enabled', () => {
    const config = { ...testConfig(), bots: { updateFrequencyHz: 4, proportions: { fuis: 1, neutre: 1, agressif: 1 } } };
    const result = validateParametricModConfig(config);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.errors.some((e) => e.path === 'bots.enabled')).toBe(true);
    }
  });
});
