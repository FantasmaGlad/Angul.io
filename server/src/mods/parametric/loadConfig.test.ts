import { describe, expect, it } from 'vitest';
import { listAvailableModIds, loadModConfig } from './loadConfig.js';

describe('loadModConfig', () => {
  it('charge server/configs/vanilla.json avec les valeurs attendues', () => {
    const config = loadModConfig('vanilla');
    expect(config.id).toBe('vanilla');
    expect(config.player.startMass).toBe(50);
    expect(config.player.maxSplits).toBe(16);
    expect(config.physics.speedMultiplier).toBe(1.0);
    expect(config.arena.borderType).toBe('STRICT_WALL');
  });

  it('charge server/configs/folie.json avec les valeurs attendues (bug de date corrigé)', () => {
    const config = loadModConfig('folie');
    expect(config.id).toBe('folie');
    expect(config.player.startMass).toBe(200);
    // Régression : cette valeur était corrompue en date (02/05/2026) dans le fichier Excel
    // source ("Angul.io - Master Sheet Engine...") avant correction — doit rester un nombre.
    expect(config.physics.speedMultiplier).toBe(2.5);
    expect(config.arena.borderType).toBe('ELASTIC_BOUNCE');
    expect(config.arena.bounceRestitution).toBe(0.8);
  });

  it('lève une erreur explicite pour un mod inconnu', () => {
    expect(() => loadModConfig('inexistant')).toThrow(/introuvable/);
  });
});

describe('listAvailableModIds', () => {
  it('liste vanilla, folie et hardcore (triés par ordre alphabétique)', () => {
    expect(listAvailableModIds()).toEqual(['folie', 'hardcore', 'vanilla']);
  });
});
