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
      // targetRatio 0.5 => 15 bots normaux + 6 Challengers en permanence (baselineCount par
      // défaut, DEFAULT_CHALLENGER_CONFIG, 0 humain) = 21 au total en régime stable.
      maxPlayers: 30,
      bots: config.bots,
    });

    // Plusieurs ticks : le spawn est étalé (maxSpawnPerTick, budget partagé entre Challengers et
    // bots normaux) et n'atteint pas forcément la cible en un seul tick.
    for (let i = 0; i < 5; i++) room.tick();

    expect(room.botManager).toBeDefined();
    expect(room.botManager?.activeBotCount).toBe(21);
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

  it('retire tous les bots normaux au profit de la pyramide Challenger dès qu’un joueur humain rejoint (demande utilisateur, §15)', () => {
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

    for (let i = 0; i < 5; i++) room.tick(); // 15 normaux + 6 Challengers (0 humain) = 21
    expect(room.botManager?.activeBotCount).toBe(21);

    // Un joueur humain rejoint
    room.addPlayer('human-1', 'JoueurHumain');

    // Depuis la connexion du premier humain, les profils normaux ne peuplent plus (§15 : "tout en
    // Challengers") — la pyramide Challenger seule monte à `maxWithHumans` (15, atteint dès 1
    // humain, voir DEFAULT_CHALLENGER_CONFIG/`rampedChallengerTarget`) : 0 bot normal + 15
    // Challengers = 15.
    expect(room.botManager?.activeBotCount).toBe(15);
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

    for (let i = 0; i < 5; i++) room.tick();
    expect(room.botManager?.activeBotCount).toBe(21);

    room.reset();
    room.tick(); // reset() ne relance qu'un seul adjustPopulation() interne (throttlé) ; un tick
    // externe supplémentaire suffit à atteindre le régime stable, comme au peuplement initial.
    expect(room.botManager?.activeBotCount).toBe(21);
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
        // Désactivés : ce test cible exclusivement le réglage `ambientTargetCount` des bots
        // normaux, indépendant de la pyramide Challenger (couverte par ses propres tests).
        challengers: { enabled: false, baselineCount: 0, minWithHumans: 0, maxWithHumans: 0, rampHumans: 1, massMultipliers: [] },
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

    // Depuis la connexion du premier humain, les bots normaux ne scalent plus avec le nombre
    // d'humains (§15, "tout en Challengers") — ils tombent à 0 dès qu'un humain est présent, ici
    // sans aucun Challenger pour prendre le relais (désactivés ci-dessus).
    room.addPlayer('h1', 'Humain');
    expect(room.botManager?.activeBotCount).toBe(0);
  });

  it('ne produit pas de thrashing (joins répétés) en mode ambiance sur plusieurs ticks consécutifs', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0.5,
        ambientTargetCount: 6,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
        challengers: { enabled: false, baselineCount: 0, minWithHumans: 0, maxWithHumans: 0, rampHumans: 1, massMultipliers: [] },
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

  it('maintient les Challengers "baselineCount" en permanence même à 0 joueur humain, avec les paliers de masse configurés', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
        challengers: { enabled: true, baselineCount: 2, minWithHumans: 3, maxWithHumans: 3, rampHumans: 1, massMultipliers: [10, 6, 3] },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 30, bots: config.bots });

    room.tick(); // 0 joueur humain : baselineCount (2) Challengers, jamais 0 (comportement d'origine)

    const rank1 = room.world.getPiecesByOwner('bot-challenger-1')[0];
    const rank2 = room.world.getPiecesByOwner('bot-challenger-2')[0];
    const rank3 = room.world.getPiecesByOwner('bot-challenger-3');
    expect(rank1?.mass).toBe(config.player.startMass * 10);
    expect(rank2?.mass).toBe(config.player.startMass * 6);
    expect(rank3).toHaveLength(0); // au-delà de baselineCount, pas encore actif sans humain
  });

  it('étend la pyramide de Challengers à maxWithHumans dès qu’un joueur humain se connecte', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
        challengers: { enabled: true, baselineCount: 2, minWithHumans: 3, maxWithHumans: 3, rampHumans: 1, massMultipliers: [10, 6, 3] },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 30, bots: config.bots });

    room.tick();
    room.addPlayer('human-1', 'Humain');

    const rank3 = room.world.getPiecesByOwner('bot-challenger-3')[0];
    expect(rank3?.mass).toBe(config.player.startMass * 3);
  });

  it('fait réapparaître un Challenger mangé au palier le PLUS FAIBLE actuellement actif, jamais à son rang d’origine', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
        challengers: { enabled: true, baselineCount: 2, minWithHumans: 3, maxWithHumans: 3, rampHumans: 1, massMultipliers: [10, 6, 3] },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 30, bots: config.bots });

    room.tick(); // rang 1 (x10) et rang 2 (x6) actifs, 0 humain -> palier le plus faible actif = rang 2 (x6)

    // "Mange" le Challenger de rang 1 (le plus fort, x10) : retire tous ses morceaux.
    for (const piece of room.world.getPiecesByOwner('bot-challenger-1')) {
      room.world.removeEntity(piece.id);
    }
    room.tick(); // détecte la mort (Room.tick()) puis BotManager.onPlayerDeath -> respawn

    // Le remplaçant réutilise le rang 1 (premier slot libre) mais avec le multiplicateur du
    // palier le plus faible actif (x6, rang 2) — PAS x10 (son propre rang d'origine).
    const replacement = room.world.getPiecesByOwner('bot-challenger-1')[0];
    expect(replacement?.mass).toBe(config.player.startMass * 6);
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
        challengers: { enabled: false, baselineCount: 0, minWithHumans: 0, maxWithHumans: 0, rampHumans: 1, massMultipliers: [] },
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

    for (const bot of (room as any).botManager.activeBots.values()) {
      bot.accumulatorMs = 0;
    }

    const handleInputSpy = vi.spyOn(room, 'handleInput');
    room.tick();

    expect(handleInputSpy.mock.calls.filter(([id]) => id === firstId).length).toBe(0);
    expect(handleInputSpy.mock.calls.filter(([id]) => id === secondId).length).toBe(0);
  });

  it('despawn tous les bots après idleDespawn.afterMinutes sans aucun joueur humain', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        ambientTargetCount: 3,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
        challengers: { enabled: false, baselineCount: 0, minWithHumans: 0, maxWithHumans: 0, rampHumans: 1, massMultipliers: [] },
        idleDespawn: { enabled: true, afterMinutes: 1 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 30, bots: config.bots });

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    room.tick(); // peuplement initial (0 humain depuis l'instant 0)
    expect(room.botManager?.activeBotCount).toBe(3);

    // Toujours sous le seuil (1 minute) : aucun despawn.
    nowSpy.mockReturnValue(59_000);
    room.tick();
    expect(room.botManager?.activeBotCount).toBe(3);

    // Seuil franchi : despawn de tous les bots.
    nowSpy.mockReturnValue(61_000);
    room.tick();
    expect(room.botManager?.activeBotCount).toBe(0);

    // Reste à 0 sur les ticks suivants (pas de repeuplement tant qu'aucun humain n'est revenu —
    // sans quoi le peuplement normal, appelé à chaque tick, annulerait le despawn).
    nowSpy.mockReturnValue(70_000);
    room.tick();
    room.tick();
    expect(room.botManager?.activeBotCount).toBe(0);

    nowSpy.mockRestore();
  });

  it('repeuple normalement dès qu’un joueur humain rejoint après un despawn d’inactivité', () => {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        ambientTargetCount: 3,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0, fou: 0 },
        // Challengers activés (contrairement aux autres tests idleDespawn ci-dessus) : depuis la
        // connexion du premier humain, ce sont EUX seuls qui repeuplent (§15, "tout en
        // Challengers") — les bots normaux (ambientTargetCount) ne servent plus qu'au peuplement
        // ambiant à 0 humain, y compris juste après un despawn d'inactivité.
        challengers: { enabled: true, baselineCount: 3, minWithHumans: 4, maxWithHumans: 4, rampHumans: 1, massMultipliers: [5, 4, 3, 2] },
        idleDespawn: { enabled: true, afterMinutes: 1 },
      },
    });
    const mod = createParametricMod(config);
    const room = new Room(mod, { mapSize: 2000, tickRateHz: 20, maxPlayers: 30, bots: config.bots });

    const nowSpy = vi.spyOn(performance, 'now').mockReturnValue(0);
    room.tick(); // 3 bots normaux (ambiant) + 3 Challengers (baselineCount) = 6
    expect(room.botManager?.activeBotCount).toBe(6);
    nowSpy.mockReturnValue(61_000);
    room.tick(); // despawn d'inactivité : vide tout, Challengers compris
    expect(room.botManager?.activeBotCount).toBe(0);

    room.addPlayer('human-1', 'Humain');
    // Repeuplement via la pyramide Challenger seule (maxWithHumans = 4), pas les bots normaux.
    expect(room.botManager?.activeBotCount).toBe(4);

    nowSpy.mockRestore();
  });
});
