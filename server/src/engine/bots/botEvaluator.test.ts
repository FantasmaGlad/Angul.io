import { describe, expect, it } from 'vitest';
import { testConfig } from '../../mods/parametric/testConfig.js';
import { createParametricMod } from '../../mods/parametric/index.js';
import { World } from '../world.js';
import { computeBotInput } from './botEvaluator.js';
import { selectRandomBotProfile } from './botTypes.js';

describe('botEvaluator', () => {
  it('selectRandomBotProfile : respecte la pondération des proportions', () => {
    const counts = { fuis: 0, neutre: 0, agressif: 0, fou: 0 };
    const proportions = { fuis: 25, neutre: 30, agressif: 30, fou: 15 };

    for (let i = 0; i < 10000; i++) {
      const p = selectRandomBotProfile(proportions);
      counts[p]++;
    }

    // Les proportions relatives doivent être approximativement respectées (ex: fuis ~25%)
    expect(counts.fuis).toBeGreaterThan(2000);
    expect(counts.neutre).toBeGreaterThan(2500);
    expect(counts.agressif).toBeGreaterThan(2500);
    expect(counts.fou).toBeGreaterThan(1000);
  });

  it('profil fuis : fuit un prédateur proche', () => {
    const mod = createParametricMod(testConfig());
    const world = new World({ mapSize: 1000 });

    const botId = 'bot-fuis-1';
    world.addPlayer(botId, 'fuis_1');
    mod.onPlayerJoin?.(world, botId);

    const botPiece = world.getPiecesByOwner(botId)[0];
    botPiece.position = { x: 500, y: 500 };
    world.setMass(botPiece, 50);

    // Prédateur plus gros au nord (x: 500, y: 300, masse 100)
    const predId = 'pred-1';
    world.addPlayer(predId, 'Predator');
    mod.onPlayerJoin?.(world, predId);
    const predPiece = world.getPiecesByOwner(predId)[0];
    predPiece.position = { x: 500, y: 300 };
    world.setMass(predPiece, 100);

    world.rebuildSpatialHash();

    const { input } = computeBotInput(world, botId, 'fuis');
    // Doit fuir vers le sud (y > 500)
    expect(input.target.y).toBeGreaterThan(500);
    expect(input.intensity).toBe(1.0);
    expect(input.split).toBe(false);
  });

  it('profil agressif : calcule un split létal si la cible est à portée', () => {
    const mod = createParametricMod(testConfig());
    const world = new World({ mapSize: 1000 });

    const botId = 'bot-agressif-1';
    world.addPlayer(botId, 'agressif_1');
    mod.onPlayerJoin?.(world, botId);

    const botPiece = world.getPiecesByOwner(botId)[0];
    botPiece.position = { x: 500, y: 500 };
    world.setMass(botPiece, 200); // 200 / 2 = 100 >> 1.15 * 30

    const preyId = 'prey-1';
    world.addPlayer(preyId, 'Prey');
    mod.onPlayerJoin?.(world, preyId);
    const preyPiece = world.getPiecesByOwner(preyId)[0];
    preyPiece.position = { x: 600, y: 500 }; // à 100px à droite (< 300px)
    world.setMass(preyPiece, 30);

    world.rebuildSpatialHash();

    const { input } = computeBotInput(world, botId, 'agressif');
    expect(input.target.x).toBeGreaterThan(500);
    expect(input.intensity).toBe(1.0);
    expect(input.split).toBe(true);
  });
});
