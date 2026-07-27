import { describe, expect, it } from 'vitest';
import { testConfig } from '../../mods/parametric/testConfig.js';
import { createParametricMod } from '../../mods/parametric/index.js';
import { Room } from '../room.js';

describe('BotManager', () => {
  it('instancie les bots jusqu’à targetRatio * maxCapacity (incluant le Top 10 Challengers)', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      maxPlayers: 30, // targetRatio 0.5 => 15 bots (10 Challengers + 5 normaux)
      bots: config.bots,
    });

    // Premier tick pour lancer update()
    room.tick();

    expect(room.botManager).toBeDefined();
    expect(room.botManager?.activeBotCount).toBe(15);
  });

  it('supprime le plus petit bot normal quand un joueur humain rejoint', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      maxPlayers: 30, // target 15 bots
      bots: config.bots,
    });

    room.tick(); // 15 bots
    expect(room.botManager?.activeBotCount).toBe(15);

    // Un joueur humain rejoint
    room.addPlayer('human-1', 'JoueurHumain');

    // Le nombre de bots actifs est ajusté à 14 (pour maintenir 15 - 1 = 14)
    expect(room.botManager?.activeBotCount).toBe(14);
    expect(room.world.getPlayer('human-1')).toBeDefined();
  });

  it('re-spawne les bots lors d’un reset() de la room', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      maxPlayers: 30,
      bots: config.bots,
    });

    room.tick();
    expect(room.botManager?.activeBotCount).toBe(15);

    room.reset();
    expect(room.botManager?.activeBotCount).toBe(15);
  });

  it('réserve toujours au moins une place pour un joueur humain dans un salon à petite capacité', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      maxPlayers: 2, // Salon privé à 2 joueurs max
      bots: config.bots,
    });

    room.tick();
    // Moins de 2 bots pour laisser au moins 1 place au joueur humain
    expect(room.botManager?.activeBotCount).toBeLessThan(2);
    expect(room.world.allPlayers().length).toBeLessThan(2);

    room.addPlayer('human-1', 'JoueurHumain');
    expect(room.world.getPlayer('human-1')).toBeDefined();
    expect(room.world.allPlayers().length).toBeLessThanOrEqual(2);
  });
});

