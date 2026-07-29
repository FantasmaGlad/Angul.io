import { SKINS } from '@angulio/shared';
import { describe, expect, it, vi } from 'vitest';
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

  it('assigne un skin valide parmi SKINS lors du spawn d’un bot', () => {
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
      maxPlayers: 10,
      bots: config.bots,
    });

    const joinedSkins: string[] = [];
    room.onPlayerJoin((_id, _name, skin) => {
      if (skin) joinedSkins.push(skin);
    });

    room.tick();

    expect(joinedSkins.length).toBeGreaterThan(0);
    for (const skin of joinedSkins) {
      expect(SKINS).toContain(skin);
    }
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

  it('réduit la population à ambientTargetCount lorsque 0 joueur humain est présent', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        ambientTargetCount: 6,
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
    expect(room.botManager?.activeBotCount).toBe(6);

    room.addPlayer('h1', 'Humain');
    expect(room.botManager?.activeBotCount).toBe(14);
  });

  it('ne produit pas de thrashing (joins répétés) en mode ambiance sur plusieurs ticks consécutifs', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        ambientTargetCount: 6,
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

    let botJoinCount = 0;
    room.onPlayerJoin((id) => {
      if (id.startsWith('bot-')) botJoinCount++;
    });

    // Tick 1 : initialisation
    room.tick();
    const initialJoins = botJoinCount;
    expect(initialJoins).toBe(6);
    expect(room.botManager?.activeBotCount).toBe(6);

    // Ticks 2 à 6 : vérification qu'aucun bot supplémentaire ne rejoint/quitte
    for (let i = 0; i < 5; i++) {
      room.tick();
    }

    expect(botJoinCount).toBe(initialJoins);
    expect(room.botManager?.activeBotCount).toBe(6);
  });

  it('réévalue immédiatement un bot au contact d’un joueur humain, sans attendre l’échéance ambiante (2Hz)', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        // maxPlayers/targetRatio très généreux : dès qu'un humain apparaît, adjustPopulation
        // force le spawn de bots "Challenger" (jusqu'à 10, voir son commentaire) puis recalcule
        // la population cible — avec des valeurs trop serrées, ce recalcul retirerait le bot
        // ambiant original (le seul non-Challenger) via removeSmallestBot avant même que la
        // boucle d'évaluation ne tourne. Ces valeurs garantissent que la cible reste largement
        // au-dessus du nombre de bots réellement présents, donc aucun retrait — seul le forçage
        // au contact est sous test ici, pas le rééquilibrage de population.
        targetRatio: 1,
        ambientTargetCount: 1, // exactement 1 bot tant qu'il n'y a aucun humain (voir tick1)
        updateFrequencyHz: 2, // 500ms d'échéance ambiante — bien plus que les ticks de ce test
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 100, bots: config.bots });

    // Décalage initial de l'accumulateur (spawnBot) déterministe pour ce test : démarre à 0
    // plutôt qu'un offset aléatoire, pour ne jamais franchir l'échéance ambiante par hasard sur
    // les deux ticks du test (20Hz -> dt=50ms/tick, donc 100ms cumulés, bien sous les 500ms).
    const randomSpy = vi.spyOn(Math, 'random').mockReturnValue(0);
    room.tick(); // spawn du bot ambiant (0 humain à cet instant)
    randomSpy.mockRestore();

    const botId = room.world.allPlayers().map((p) => p.id).find((id) => id.startsWith('bot-'));
    expect(botId).toBeDefined();
    const botPieceBefore = room.world.getPiecesByOwner(botId!)[0]!;

    // Joueur humain positionné exactement sur le bot (chevauchement garanti) — contourne
    // volontairement Room.addPlayer/onPlayerJoin (spawn à une position aléatoire "sûre", donc
    // jamais garantie en contact) pour un test déterministe.
    room.world.addPlayer('human-1', 'Humain');
    room.world.spawnPiece('human-1', { ...botPieceBefore.position }, 50);
    // La grille spatiale n'est reconstruite qu'une fois par tick, APRÈS botManager.update() (voir
    // Room.tick()) — sans ce rebuild manuel, le morceau humain qu'on vient de créer directement
    // (hors du flux normal `room.addPlayer`) serait invisible de `queryNearby` pour le tick
    // suivant (index encore celui d'avant sa création), un décalage d'un tick sans conséquence en
    // conditions réelles mais qui casserait ce test à un seul tick.
    room.world.rebuildSpatialHash();

    const handleInputSpy = vi.spyOn(room, 'handleInput');
    room.tick(); // 100ms cumulés pour le bot, bien avant les 500ms d'échéance ambiante

    const botCalls = handleInputSpy.mock.calls.filter(([id]) => id === botId);
    expect(botCalls.length).toBeGreaterThan(0);
  });

  it('ne réévalue PAS un bot au contact d’un autre bot (pas d’humain)', () => {
    const config = testConfig({
      food: { ...testConfig().food, density: 0, respawnRatePerSecond: 0 },
      bots: {
        enabled: true,
        targetRatio: 0,
        ambientTargetCount: 2, // exactement 2 bots, jamais d'humain dans ce test
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 10, bots: config.bots });

    room.tick(); // spawn des 2 bots ambiants

    const botIds = room.world.allPlayers().map((p) => p.id).filter((id) => id.startsWith('bot-'));
    expect(botIds.length).toBe(2);
    const [firstId, secondId] = botIds as [string, string];
    const firstPiece = room.world.getPiecesByOwner(firstId)[0]!;
    const secondPiece = room.world.getPiecesByOwner(secondId)[0]!;
    firstPiece.mass = 50;
    secondPiece.mass = 50;
    // Force le chevauchement des deux bots entre eux (positions aléatoires sinon).
    secondPiece.position = { ...firstPiece.position };
    room.world.rebuildSpatialHash();

    const handleInputSpy = vi.spyOn(room, 'handleInput');
    room.tick();

    expect(handleInputSpy.mock.calls.filter(([id]) => id === firstId).length).toBe(0);
    expect(handleInputSpy.mock.calls.filter(([id]) => id === secondId).length).toBe(0);
  });
});
