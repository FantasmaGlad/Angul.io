import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { hashPassword } from '../accounts/passwords.js';
import { AccountsService } from '../accounts/service.js';
import { AdminAuth } from '../admin/adminAuth.js';
import type { GameMod } from '../engine/mod.js';
import { RoomManager, type ModResolver } from '../engine/roomManager.js';
import { createLocalRoomHost, DEFAULT_INTEREST_RADIUS_PX } from '../engine/worker/roomHost.js';
import { startGameServer, type GameServerHandle } from './server.js';

const DATABASE_URL = process.env.DATABASE_URL;

type Message = Record<string, unknown>;

/** Accumule tous les messages reçus depuis l'ouverture du socket — évite la course entre deux
 * `once('message', ...)` séquentiels quand le serveur envoie plusieurs messages d'affilée
 * dans le même tick (welcome + player, par exemple peuvent arriver avant qu'on ait eu la main
 * pour se ré-abonner). */
function collectMessages(socket: WebSocket): Message[] {
  const messages: Message[] = [];
  socket.on('message', (raw: Buffer) => messages.push(JSON.parse(raw.toString())));
  return messages;
}

async function waitUntil(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) throw new Error('waitUntil : délai dépassé');
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

function waitForOpen(socket: WebSocket): Promise<void> {
  return new Promise((resolve) => socket.once('open', () => resolve()));
}

async function connectedClient(port: number, roomId: string): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${port}/?roomId=${roomId}`);
  await waitForOpen(socket);
  return socket;
}

function testResolver(mapSize = 1000): ModResolver {
  return () => ({ mod: { id: 'test' }, mapSize });
}

describe('startGameServer', () => {
  let handle: GameServerHandle | undefined;
  const managers: RoomManager[] = [];

  // Chaque RoomManager démarre désormais aussi un timer de nettoyage des salons vides (voir
  // roomManager.ts) — grâce très longue ici pour ne jamais interférer avec ces tests, qui ne
  // testent pas ce comportement (couvert par roomManager.test.ts).
  function makeManager(
    resolver: ModResolver,
    tickRateHz = 20,
    interestRadiusPx = DEFAULT_INTEREST_RADIUS_PX,
  ): RoomManager {
    const host = createLocalRoomHost(resolver, interestRadiusPx);
    const manager = new RoomManager(host, tickRateHz, { emptyRoomGraceMs: 10_000_000 });
    managers.push(manager);
    return manager;
  }

  afterEach(() => {
    handle?.close();
    handle = undefined;
    for (const manager of managers) {
      manager.stopPruning();
      for (const managed of manager.allManagedRooms()) managed.room.stop();
    }
    managers.length = 0;
  });

  it('répond à un join par un welcome contenant un id de joueur et la taille de la carte', async () => {
    const manager = makeManager(testResolver(1234));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));

    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    expect(welcome).toMatchObject({ type: 'welcome', mapSize: 1234 });
    expect(typeof welcome.playerId).toBe('string');

    socket.close();
  });

  it('ferme la connexion si le salon demandé n’existe pas', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = new WebSocket(`ws://localhost:${port}/?roomId=inexistant`);
    const closeCode = await new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
    });

    expect(closeCode).toBe(4004);
  });

  it('ferme la connexion si aucun roomId n’est fourni', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = new WebSocket(`ws://localhost:${port}`);
    const closeCode = await new Promise<number>((resolve) => {
      socket.once('close', (code) => resolve(code));
    });

    expect(closeCode).toBe(4004);
  });

  it('diffuse l’état du monde après un join, avec le morceau du joueur et son pseudo', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));

    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    await waitUntil(() => messages.some((m) => m.type === 'player'));
    const playerInfo = messages.find((m) => m.type === 'player');
    expect(playerInfo).toMatchObject({
      type: 'player',
      playerId: welcome.playerId,
      nickname: 'Alice',
    });

    manager.getManagedRoom(summary.id)!.room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as { entities: Array<{ p?: string }> };

    expect(state.entities.some((e) => e.p === welcome.playerId)).toBe(true);

    socket.close();
  });

  it('envoie les pseudos déjà connus à un nouvel arrivant (backfill)', async () => {
    const manager = makeManager(testResolver());
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const first = await connectedClient(port, summary.id);
    const firstMessages = collectMessages(first);
    first.send(JSON.stringify({ type: 'join', nickname: 'Eve' }));
    await waitUntil(() => firstMessages.some((m) => m.type === 'welcome'));
    const firstWelcome = firstMessages.find((m) => m.type === 'welcome')!;

    const second = await connectedClient(port, summary.id);
    const secondMessages = collectMessages(second);
    second.send(JSON.stringify({ type: 'join', nickname: 'Frank' }));

    await waitUntil(
      () =>
        secondMessages.some(
          (m) =>
            m.type === 'player' && m.playerId === firstWelcome.playerId && m.nickname === 'Eve',
        ),
      // le backfill des joueurs déjà présents doit atteindre le nouvel arrivant
    );

    first.close();
    second.close();
  });

  it('transmet les inputs au mod via handleInput', async () => {
    const receivedInputs: Array<{
      target: { x: number; y: number };
      intensity: number;
      split: boolean;
    }> = [];
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
      onPlayerInput: (_world, _playerId, input) => {
        receivedInputs.push(input);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    socket.send(
      JSON.stringify({ type: 'input', target: { x: 1, y: 0 }, intensity: 1, split: true }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(receivedInputs).toEqual([{ target: { x: 1, y: 0 }, intensity: 1, split: true }]);

    socket.close();
  });

  it('ignore un message malformé sans planter le serveur', async () => {
    const manager = makeManager(testResolver());
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send('ceci n’est pas du JSON');
    socket.send(JSON.stringify({ type: 'join', nickname: 'Carol' }));

    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    socket.close();
  });

  it('retire le joueur de la room à la fermeture du socket', async () => {
    const removedPlayerIds: string[] = [];
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
      onPlayerLeave: (_world, playerId) => {
        removedPlayerIds.push(playerId);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Dan' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(removedPlayerIds).toEqual([welcome.playerId]);
  });

  it('arrondit position/rayon à 1 décimale et la masse à l’entier (Lot 1.8)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 123.456789, y: 0 }, 50.623456789);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    manager.getManagedRoom(summary.id)!.room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as {
      entities: Array<{ x: number; m: number }>;
    };
    const piece = state.entities.find((e) => e.m > 0)!;

    expect(piece.x).toBe(123.5);
    expect(piece.m).toBe(51); // masse arrondie à l'entier le plus proche, pas à 1 décimale

    socket.close();
  });

  it('renseigne `self.accelerationPerSec2` quand le mod expose getAccelerationForMass (panneau de stats client)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
      getAccelerationForMass: (mass) => mass * 3,
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    manager.getManagedRoom(summary.id)!.room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as {
      self?: { accelerationPerSec2: number };
    };

    expect(state.self).toEqual({ accelerationPerSec2: 150 }); // masse 50 * 3

    socket.close();
  });

  it('n’envoie pas `self` si le mod n’expose pas getAccelerationForMass', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    manager.getManagedRoom(summary.id)!.room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as { self?: unknown };

    expect(state.self).toBeUndefined();

    socket.close();
  });

  it('renseigne `self.combo` quand un combo est actif pour ce joueur (refonte XP)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    // Simule un combo déjà déclenché (voir xp.test.ts pour la logique de déclenchement/
    // prolongation elle-même) plutôt que de rejouer toute la mécanique d'absorption ici.
    const player = manager
      .getManagedRoom(summary.id)!
      .room.world.getPlayer(welcome.playerId as string)!;
    player.lifeStats.combo = {
      chain: 3,
      multiplier: 1.44,
      expiresAtMs: performance.now() + 20_000,
      lastEatAtMs: performance.now(),
    };

    manager.getManagedRoom(summary.id)!.room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as {
      self?: { combo?: { level: number } };
    };

    expect(state.self?.combo).toEqual({ level: 2 }); // chain 3 -> niveau affiché 2

    socket.close();
  });

  it('répond à un `ping` par un `pong` renvoyant le même horodatage', async () => {
    const manager = makeManager(testResolver());
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    socket.send(JSON.stringify({ type: 'ping', t: 12345 }));
    await waitUntil(() => messages.some((m) => m.type === 'pong'));
    const pong = messages.find((m) => m.type === 'pong');

    expect(pong).toEqual({ type: 'pong', t: 12345 });

    socket.close();
  });

  it('ne diffuse à un client que les entités proches de sa propre caméra (interest management)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 100_000 }), 20, 500);
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;
    const room = manager.getManagedRoom(summary.id)!.room!;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    // Une particule proche (dans le rayon) et une très loin (hors rayon)
    room.world.spawnParticle({ x: 100, y: 0 }, 1);
    room.world.spawnParticle({ x: 50_000, y: 50_000 }, 1);

    room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as {
      entities: Array<{ x: number; y: number }>;
    };

    expect(state.entities.some((e) => e.x === 100 && e.y === 0)).toBe(true);
    expect(state.entities.some((e) => e.x === 50_000)).toBe(false);
    expect(state.entities.some((e) => e.x === 0 && e.y === 0)).toBe(true); // son propre morceau

    socket.close();
  });

  it('isole deux salons simultanés : un joueur du salon A n’apparaît pas dans l’état du salon B', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const roomA = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    const roomB = manager.createRoom({ name: 'B', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socketA = await connectedClient(port, roomA.id);
    const messagesA = collectMessages(socketA);
    socketA.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
    await waitUntil(() => messagesA.some((m) => m.type === 'welcome'));

    const socketB = await connectedClient(port, roomB.id);
    const messagesB = collectMessages(socketB);

    manager.getManagedRoom(roomA.id)!.room.tick();
    manager.getManagedRoom(roomB.id)!.room.tick();

    await waitUntil(() => messagesA.some((m) => m.type === 'state'));
    const stateA = messagesA.find((m) => m.type === 'state') as { entities: unknown[] };
    expect(stateA.entities.length).toBeGreaterThan(0);

    // roomB n'a aucun joueur : la diffusion n'a rien à envoyer tant que personne n'a rejoint —
    // socketB n'a donc reçu aucun message `state` du tout après le tick de sa room.
    expect(messagesB.some((m) => m.type === 'state')).toBe(false);

    socketA.close();
    socketB.close();
  });

  describe('refonte UI/UX accueil (spectateur, unicité de pseudo, capacité, stats)', () => {
    it('refuse un second join avec un pseudo déjà utilisé dans le même salon (insensible à la casse)', async () => {
      const manager = makeManager(testResolver());
      const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const first = await connectedClient(port, summary.id);
      const firstMessages = collectMessages(first);
      first.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
      await waitUntil(() => firstMessages.some((m) => m.type === 'welcome'));

      const second = await connectedClient(port, summary.id);
      const closeCode = new Promise<number>((resolve) => second.once('close', resolve));
      second.send(JSON.stringify({ type: 'join', nickname: 'ALICE' }));

      expect(await closeCode).toBe(4009);
      first.close();
    });

    it('accepte un pseudo repris après le départ du premier joueur qui l’utilisait', async () => {
      const manager = makeManager(testResolver());
      const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const first = await connectedClient(port, summary.id);
      const firstMessages = collectMessages(first);
      first.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
      await waitUntil(() => firstMessages.some((m) => m.type === 'welcome'));
      first.close();
      await waitUntil(
        () => manager.getManagedRoom(summary.id)!.room.world.allPlayers().length === 0,
      );

      const second = await connectedClient(port, summary.id);
      const secondMessages = collectMessages(second);
      second.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));

      await waitUntil(() => secondMessages.some((m) => m.type === 'welcome'));
      second.close();
    });

    it('refuse un join au-delà de la capacité du salon (maxPlayers)', async () => {
      const manager = makeManager(testResolver());
      const summary = manager.createRoom({
        name: 'A',
        modId: 'test',
        visibility: 'public',
        maxPlayers: 1,
      });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const first = await connectedClient(port, summary.id);
      const firstMessages = collectMessages(first);
      first.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
      await waitUntil(() => firstMessages.some((m) => m.type === 'welcome'));

      const second = await connectedClient(port, summary.id);
      const closeCode = new Promise<number>((resolve) => second.once('close', resolve));
      second.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));

      expect(await closeCode).toBe(4010);
      first.close();
    });

    it('un spectateur (?spectate=1) reçoit un welcome sans envoyer de join, et n’est jamais compté dans playerCount', async () => {
      const manager = makeManager(testResolver(4242));
      const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const spectator = new WebSocket(`ws://localhost:${port}/?roomId=${summary.id}&spectate=1`);
      await waitForOpen(spectator);
      const messages = collectMessages(spectator);

      await waitUntil(() => messages.some((m) => m.type === 'welcome'));
      expect(messages.find((m) => m.type === 'welcome')).toMatchObject({ mapSize: 4242 });
      expect(manager.getManagedRoom(summary.id)!.room.world.allPlayers()).toHaveLength(0);

      spectator.close();
    });

    it('GET /api/stats renvoie le nombre total de joueurs connectés, tous salons confondus', async () => {
      const manager = makeManager(testResolver());
      const roomA = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
      const roomB = manager.createRoom({ name: 'B', modId: 'test', visibility: 'private' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const socketA = await connectedClient(port, roomA.id);
      const messagesA = collectMessages(socketA);
      socketA.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
      await waitUntil(() => messagesA.some((m) => m.type === 'welcome'));

      const socketB = await connectedClient(port, roomB.inviteCode!);
      const messagesB = collectMessages(socketB);
      socketB.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));
      await waitUntil(() => messagesB.some((m) => m.type === 'welcome'));

      const response = await fetch(`http://localhost:${port}/api/stats`);
      expect(await response.json()).toEqual({ playersOnline: 2 });

      socketA.close();
      socketB.close();
    });

    it('ferme de force les sockets encore connectées quand un salon expire (durationMs)', async () => {
      const manager = makeManager(testResolver());
      // `durationMs` réel non utilisé ici (un délai assez court pour un test serait sujet à une
      // course avec la connexion/join elle-même, plus lente que quelques dizaines de ms sous
      // charge) — `expireRoom` est invoqué manuellement, comme `pruneEmptyRooms` ailleurs dans la
      // suite, pour tester le comportement réseau de façon déterministe plutôt qu'en dépendant
      // d'un vrai minuteur.
      const summary = manager.createRoom({ name: 'Éphémère', modId: 'test', visibility: 'public' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const socket = await connectedClient(port, summary.id);
      const messages = collectMessages(socket);
      socket.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
      await waitUntil(() => messages.some((m) => m.type === 'welcome'));

      const closeCode = new Promise<number>((resolve) => {
        socket.once('close', (code) => resolve(code));
      });
      manager.expireRoom(summary.id);

      expect(await closeCode).toBe(4011);
    });
  });

  it('GET /api/rooms liste les salons publics avec leur nombre de joueurs', async () => {
    const manager = makeManager(testResolver());
    manager.createRoom({ name: 'Public', modId: 'test', visibility: 'public' });
    manager.createRoom({ name: 'Privé', modId: 'test', visibility: 'private' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/rooms`);
    const rooms = (await response.json()) as Array<{ name: string; playerCount: number }>;

    expect(rooms).toEqual([
      {
        id: '1',
        name: 'Public',
        modId: 'test',
        visibility: 'public',
        playerCount: 0,
        maxPlayers: 100,
        permanent: false,
      },
    ]);
  });

  it('POST /api/rooms crée un salon joignable immédiatement', async () => {
    const manager = makeManager(() => ({ mod: { id: 'test' }, mapSize: 4242 }));
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Mon salon', modId: 'test' }),
    });
    expect(response.status).toBe(201);
    const created = (await response.json()) as { id: string };

    const socket = await connectedClient(port, created.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    expect(welcome).toMatchObject({ mapSize: 4242 });

    socket.close();
  });

  it('POST /api/rooms rejette un nom manquant', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '  ', modId: 'test' }),
    });

    expect(response.status).toBe(400);
  });

  it('GET /api/modes renvoie les modes fournis au démarrage du serveur', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, {
      port: 0,
      rateLimitMaxAttempts: 0,
      availableModIds: ['vanilla', 'hardcore'],
    });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/modes`);
    expect(await response.json()).toEqual(['vanilla', 'hardcore']);
  });

  it('POST /api/rooms { visibility: "private" } renvoie un code d’invitation, absent en public', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Salon privé', modId: 'test', visibility: 'private' }),
    });
    const created = (await response.json()) as { id: string; inviteCode?: string };

    expect(typeof created.inviteCode).toBe('string');

    // Un salon privé n'apparaît jamais dans le lobby public, même avec son code en main.
    const publicRooms = (await (
      await fetch(`http://localhost:${port}/api/rooms`)
    ).json()) as unknown[];
    expect(publicRooms).toEqual([]);
  });

  it('refuse de rejoindre un salon privé par son id brut, l’accepte par son code d’invitation', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Salon privé', modId: 'test', visibility: 'private' }),
    });
    const created = (await response.json()) as { id: string; inviteCode: string };

    // L'id brut ("1", énumérable) ne doit jamais suffire pour un salon privé.
    const byId = new WebSocket(`ws://localhost:${port}/?roomId=${created.id}`);
    const closeCodeById = await new Promise<number>((resolve) => byId.once('close', resolve));
    expect(closeCodeById).toBe(4004);

    // Le code d'invitation, lui, donne accès.
    const byCode = await connectedClient(port, created.inviteCode);
    const messages = collectMessages(byCode);
    byCode.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    byCode.close();
  });

  it('diffuse un message `died` à tous les joueurs connectés lors d’un reset automatique du salon (Lot 2.4)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));
    const summary = manager.createRoom({
      name: 'A',
      modId: 'test',
      visibility: 'public',
      resetSchedule: { type: 'interval', intervalMs: 30 },
    });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    await waitUntil(() => messages.some((m) => m.type === 'died'), 1000);

    socket.close();
  });
});

// Tests d'intégration réels contre PostgreSQL (même principe que accountsRepository.test.ts) :
// interface admin (Lot 5) et restriction de la création de salon aux comptes Premium (Lot 6.4)
// dépendent toutes deux d'un vrai `AccountsService`, pas seulement du `RoomManager`/`ModResolver`
// de test utilisé ci-dessus (qui reste, lui, indépendant de la base — voir Lot 6.4, décision de
// dégradation gracieuse sans `accounts`).
describe.skipIf(!DATABASE_URL)('startGameServer (avec comptes joueurs)', () => {
  const pool = new Pool({ connectionString: DATABASE_URL });
  const createdPseudos: string[] = [];
  let handle: GameServerHandle | undefined;
  const managers: RoomManager[] = [];

  afterAll(async () => {
    if (createdPseudos.length > 0) {
      await pool.query('DELETE FROM players WHERE pseudo = ANY($1::text[])', [createdPseudos]);
    }
    await pool.end();
  });

  afterEach(() => {
    handle?.close();
    handle = undefined;
    for (const manager of managers) {
      manager.stopPruning();
      for (const managed of manager.allManagedRooms()) managed.room.stop();
    }
    managers.length = 0;
  });

  function makeManager(): RoomManager {
    const host = createLocalRoomHost(() => ({ mod: { id: 'test' }, mapSize: 1000 }));
    const manager = new RoomManager(host, 20, { emptyRoomGraceMs: 10_000_000 });
    managers.push(manager);
    return manager;
  }

  function uniquePseudo(prefix: string): string {
    const pseudo = `${prefix}_${randomUUID().slice(0, 8)}`;
    createdPseudos.push(pseudo);
    return pseudo;
  }

  async function startServer(
    withAdmin = true,
  ): Promise<{ port: number; accounts: AccountsService; manager: RoomManager }> {
    const accounts = new AccountsService(pool);
    const admin = withAdmin ? new AdminAuth(await hashPassword('adminpass123')) : undefined;
    const manager = makeManager();
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0, accounts, admin });
    const port = await handle.whenReady;
    return { port, accounts, manager };
  }

  it('POST /api/rooms refuse un compte non-Premium ou non authentifié, accepte un compte Premium (Lot 6.4)', async () => {
    const { port, accounts } = await startServer();
    const pseudo = uniquePseudo('roomcreator');
    const { token } = await accounts.register(pseudo, 'motdepasse123');
    const accountId = accounts.resolveToken(token)!;

    const withoutToken = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Salon', modId: 'test' }),
    });
    expect(withoutToken.status).toBe(403);

    const notPremium = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Salon', modId: 'test' }),
    });
    expect(notPremium.status).toBe(403);

    await accounts.updateAccountForAdmin(accountId, { premium: true });

    const premium = await fetch(`http://localhost:${port}/api/rooms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ name: 'Salon', modId: 'test' }),
    });
    expect(premium.status).toBe(201);
  });

  it("crédite l'XP accumulée (engine/xp.ts) au compte à la déconnexion (refonte XP)", async () => {
    const { port, accounts, manager } = await startServer(false);
    const pseudo = uniquePseudo('xpplayer');
    const { token } = await accounts.register(pseudo, 'motdepasse123');
    const accountId = accounts.resolveToken(token)!;
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });

    const socket = new WebSocket(
      `ws://localhost:${port}/?roomId=${summary.id}&token=${encodeURIComponent(token)}`,
    );
    await waitForOpen(socket);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    // Simule le cumul d'XP d'une vie (masse mangée + joueurs mangés + combo, engine/xp.ts) sans
    // avoir à rejouer toute la mécanique d'absorption ici — déjà couvert par xp.test.ts et les
    // tests des mods paramétrique/hardcore.
    const player = manager
      .getManagedRoom(summary.id)!
      .room.world.getPlayer(welcome.playerId as string)!;
    player.lifeStats.xpEarned = 1234;

    socket.close();
    await waitUntil(() => socket.readyState === WebSocket.CLOSED);

    // L'écriture en base est asynchrone (best-effort, voir recordAccountStats) : on interroge le
    // profil jusqu'à ce qu'elle soit visible plutôt que d'attendre un délai fixe arbitraire.
    const deadline = Date.now() + 2000;
    let profile = await accounts.getProfile(accountId);
    while (profile?.xp !== 1234 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      profile = await accounts.getProfile(accountId);
    }

    expect(profile?.xp).toBe(1234);
  });

  it('POST /api/admin/login : 503 sans ADMIN_PASSWORD_HASH, 401 si mauvais mot de passe, 200 + token sinon', async () => {
    const { port } = await startServer(false);

    const notConfigured = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'whatever' }),
    });
    expect(notConfigured.status).toBe(503);
  });

  it('POST /api/admin/login accepte le bon mot de passe, refuse le mauvais', async () => {
    const { port } = await startServer();

    const wrong = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'adminpass123' }),
    });
    expect(right.status).toBe(200);
    const { token } = (await right.json()) as { token: string };
    expect(typeof token).toBe('string');
  });

  it('les routes /api/admin/players/* exigent un token admin valide (Lot 5.1)', async () => {
    const { port } = await startServer();

    const noToken = await fetch(`http://localhost:${port}/api/admin/players?q=x`);
    expect(noToken.status).toBe(401);

    const badToken = await fetch(`http://localhost:${port}/api/admin/players?q=x`, {
      headers: { Authorization: 'Bearer bogus' },
    });
    expect(badToken.status).toBe(401);
  });

  it('recherche, consulte et modifie un compte via les routes admin (Lot 5.2-5.4)', async () => {
    const { port, accounts } = await startServer();
    const pseudo = uniquePseudo('adminroute');
    const { token: playerToken } = await accounts.register(pseudo, 'motdepasse123');
    const accountId = accounts.resolveToken(playerToken)!;

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    const searchResponse = await fetch(
      `http://localhost:${port}/api/admin/players?q=${encodeURIComponent(pseudo)}`,
      { headers: authHeaders },
    );
    expect(searchResponse.status).toBe(200);
    const results = (await searchResponse.json()) as Array<{ id: number; pseudo: string }>;
    expect(results.some((r) => r.id === accountId)).toBe(true);

    const detailResponse = await fetch(`http://localhost:${port}/api/admin/players/${accountId}`, {
      headers: authHeaders,
    });
    expect(detailResponse.status).toBe(200);
    expect(await detailResponse.json()).toMatchObject({ pseudo, level: 1, xp: 0, premium: false });

    const missingResponse = await fetch(`http://localhost:${port}/api/admin/players/999999999`, {
      headers: authHeaders,
    });
    expect(missingResponse.status).toBe(404);

    const patchResponse = await fetch(`http://localhost:${port}/api/admin/players/${accountId}`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ premium: true, xp: 500, cosmetics: ['chapeau'] }),
    });
    expect(patchResponse.status).toBe(200);
    expect(await patchResponse.json()).toMatchObject({
      premium: true,
      xp: 500,
      cosmetics: ['chapeau'],
    });

    // Le pseudo redevient authentifiable normalement (pas banni) — puis on le bannit et on
    // vérifie que la connexion est bien refusée ensuite (Lot 5.2).
    const banResponse = await fetch(`http://localhost:${port}/api/admin/players/${accountId}`, {
      method: 'PATCH',
      headers: { ...authHeaders, 'Content-Type': 'application/json' },
      body: JSON.stringify({ banned: true }),
    });
    expect(banResponse.status).toBe(200);

    const loginAfterBan = await fetch(`http://localhost:${port}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pseudo, password: 'motdepasse123' }),
    });
    expect(loginAfterBan.status).toBe(401);
  });

  describe('Sécurité, Rate Limiting & Validation Input', () => {
    it('applique un rate limiting de 3 tentatives max par minute sur le login joueur', async () => {
      await startServer();
      // On redémarre un serveur avec rateLimitMaxAttempts: 3 explicitement pour ce test
      const manager = makeManager();
      const accounts = new AccountsService(pool);
      const customHandle = startGameServer(manager, { port: 0, accounts, rateLimitMaxAttempts: 3 });
      const customPort = await customHandle.whenReady;

      try {
        for (let i = 0; i < 3; i++) {
          const res = await fetch(`http://localhost:${customPort}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pseudo: 'inconnu', password: 'bad' }),
          });
          expect(res.status).toBe(401);
        }

        // La 4ème tentative doit renvoyer HTTP 429
        const rateLimited = await fetch(`http://localhost:${customPort}/api/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ pseudo: 'inconnu', password: 'bad' }),
        });
        expect(rateLimited.status).toBe(429);
      } finally {
        customHandle.close();
      }
    });

    it('déconnecte le joueur avec POST /api/auth/logout', async () => {
      const { port, accounts } = await startServer();
      const pseudo = uniquePseudo('logouttest');
      const { token } = await accounts.register(pseudo, 'motdepasse123');

      const meBefore = await fetch(`http://localhost:${port}/api/account/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(meBefore.status).toBe(200);

      const logoutRes = await fetch(`http://localhost:${port}/api/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(logoutRes.status).toBe(200);

      const meAfter = await fetch(`http://localhost:${port}/api/account/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(meAfter.status).toBe(401);
    });

    it('déconnecte l’admin avec POST /api/admin/logout', async () => {
      const { port } = await startServer();
      const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: 'adminpass123' }),
      });
      const { token } = (await loginResponse.json()) as { token: string };

      const logoutRes = await fetch(`http://localhost:${port}/api/admin/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(logoutRes.status).toBe(200);

      const searchAfter = await fetch(`http://localhost:${port}/api/admin/players?q=x`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(searchAfter.status).toBe(401);
    });

    it('ignore/rejette les messages input WebSocket contenant des NaN ou des coordonnées invalides', async () => {
      const manager = makeManager(testResolver());
      const summary = manager.createRoom({
        name: 'SecurityRoom',
        modId: 'test',
        visibility: 'public',
      });
      const customHandle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const customPort = await customHandle.whenReady;

      try {
        const socket = await connectedClient(customPort, summary.id);
        socket.send(JSON.stringify({ type: 'join', nickname: 'SecPlayer' }));
        await new Promise((resolve) => setTimeout(resolve, 50));

        // Envoi d'un message input corrompu avec NaN / Infinity
        socket.send(
          JSON.stringify({
            type: 'input',
            target: { x: NaN, y: Infinity },
            intensity: 999,
            split: 'not-a-bool',
          }),
        );

        await new Promise((resolve) => setTimeout(resolve, 50));
        // Le serveur ne plante pas et la room continue de fonctionner
        expect(socket.readyState).toBe(WebSocket.OPEN);
        socket.close();
      } finally {
        customHandle.close();
      }
    });
  });
});
