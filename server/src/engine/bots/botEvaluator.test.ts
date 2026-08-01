import { describe, expect, it, vi } from 'vitest';
import { testConfig } from '../../mods/parametric/testConfig.js';
import { createParametricMod } from '../../mods/parametric/index.js';
import { World } from '../world.js';
import { computeBotInput } from './botEvaluator.js';
import { selectRandomBotProfile } from './botTypes.js';

describe('botEvaluator', () => {
  it('selectRandomBotProfile : respecte la pondération des proportions', () => {
    const counts = { fuis: 0, neutre: 0, agressif: 0 };
    const proportions = { fuis: 30, neutre: 30, agressif: 40 };

    for (let i = 0; i < 10000; i++) {
      const p = selectRandomBotProfile(proportions);
      if (p === 'fuis' || p === 'neutre' || p === 'agressif') {
        counts[p]++;
      }
    }

    // Les proportions relatives doivent être approximativement respectées (ex: fuis ~30%)
    expect(counts.fuis).toBeGreaterThan(2500);
    expect(counts.neutre).toBeGreaterThan(2500);
    expect(counts.agressif).toBeGreaterThan(3300);
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

  it('évitement des murs : s’éloigne activement des bordures quand il est proche d’un mur', () => {
    const mod = createParametricMod(testConfig());
    const world = new World({ mapSize: 1000 });

    const botId = 'bot-wall-1';
    world.addPlayer(botId, 'WallBot');
    mod.onPlayerJoin?.(world, botId);

    const botPiece = world.getPiecesByOwner(botId)[0];
    botPiece.position = { x: 50, y: 500 }; // Très proche du mur gauche (x = 50 < 250)
    world.setMass(botPiece, 50);

    world.rebuildSpatialHash();

    const { input } = computeBotInput(world, botId, 'neutre');
    // Le bot doit cibler une position vers la droite (x > 50) pour s'éloigner du mur gauche
    expect(input.target.x).toBeGreaterThan(50);
  });

  it('force une échappée directe (contourne le lissage de direction habituel) après 2 secondes collé contre un mur (retour utilisateur : "ne pas rester contre un mur plus de 2 secondes")', () => {
    const mod = createParametricMod(testConfig());
    const world = new World({ mapSize: 1000 });

    const botId = 'bot-wall-stuck-1';
    world.addPlayer(botId, 'StuckBot');
    mod.onPlayerJoin?.(world, botId);

    const botPiece = world.getPiecesByOwner(botId)[0];
    botPiece.position = { x: 50, y: 500 }; // mur gauche, wallFactor ≈ 0.83 (>= seuil de 0.6)
    world.setMass(botPiece, 50);
    world.rebuildSpatialHash();

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    // Élan simulé DANS le mur juste avant cette évaluation (comme un bot qui vient tout juste de
    // foncer dedans) — le lissage habituel (EMA à 0.25 par évaluation, ~2Hz en ambiant) ne suffit
    // JAMAIS à corriger un tel élan opposé en un seul pas, même avec un `wallFactor` élevé : c'est
    // précisément ce qui fait "traîner" un bot contre un mur pendant plusieurs secondes en pratique.
    let memory = { lastDir: { x: -1, y: 0 } };

    // t=0 : vient tout juste d'être détecté "collé" — pas encore assez longtemps pour forcer
    // l'échappée, le lissage habituel s'applique et reste dominé par l'élan opposé.
    let result = computeBotInput(world, botId, 'neutre', memory);
    memory = result.memory;
    expect(result.input.target.x).toBeLessThan(50);

    // t=2500ms, toujours collé (position inchangée) depuis plus de 2000ms : l'échappée directe
    // prend le pas, quel que soit l'élan précédent — cap net à l'opposé du mur, intensité maximale.
    nowSpy.mockReturnValue(2500);
    result = computeBotInput(world, botId, 'neutre', memory);
    expect(result.input.target.x).toBeGreaterThan(50);
    expect(result.input.intensity).toBe(1);

    nowSpy.mockRestore();
  });
});
