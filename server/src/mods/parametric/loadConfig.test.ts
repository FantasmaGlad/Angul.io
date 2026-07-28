import { describe, expect, it } from 'vitest';
import { listAvailableModIds, loadModConfig } from './loadConfig.js';

describe('loadModConfig', () => {
  it('charge server/configs/vanilla.json avec les valeurs attendues', () => {
    const config = loadModConfig('vanilla');
    expect(config.id).toBe('vanilla');
    expect(config.player.startMass).toBe(50);
    expect(config.player.maxSplits).toBe(16);
    expect(config.physics.speedMultiplier).toBe(0.5);
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
