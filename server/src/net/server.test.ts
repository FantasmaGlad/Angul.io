import { randomUUID } from 'node:crypto';
import { Pool } from 'pg';
import { afterAll, afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { hashPassword } from '../accounts/passwords.js';
import { AccountsService } from '../accounts/service.js';
import { AdminAuth } from '../admin/adminAuth.js';
import type { GameMod } from '../engine/mod.js';
import { resolveMod } from '../engine/modRegistry.js';
import { RoomManager, type ModResolver } from '../engine/roomManager.js';
import { createLocalRoomHost } from '../engine/worker/roomHost.js';
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
  function makeManager(resolver: ModResolver, tickRateHz = 20): RoomManager {
    const host = createLocalRoomHost(resolver);
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

  it(
    'retire le joueur de la room à l’expiration du délai de grâce suivant la fermeture du socket ' +
      '(correctif "déconnexion = perte immédiate de la vie/XP en cours", pas retiré immédiatement)',
    async () => {
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
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0, disconnectGraceMs: 20 });
      const port = await handle.whenReady;

      const socket = await connectedClient(port, summary.id);
      const messages = collectMessages(socket);
      socket.send(JSON.stringify({ type: 'join', nickname: 'Dan' }));
      await waitUntil(() => messages.some((m) => m.type === 'welcome'));
      const welcome = messages.find((m) => m.type === 'welcome')!;

      socket.close();
      // Immédiatement après la fermeture : encore en délai de grâce, le joueur reste dans le monde
      // (gelé, toujours mangeable) — pas encore retiré.
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(removedPlayerIds).toEqual([]);

      await waitUntil(() => removedPlayerIds.length > 0);
      expect(removedPlayerIds).toEqual([welcome.playerId]);
    },
  );

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
      self?: { accelerationPerSec2: number; pieces?: Array<{ id: string; vx: number; vy: number }> };
    };

    // `pieces` (voir fix_vitesse_reseau.md) : toujours présent dès que le joueur a un morceau,
    // indépendamment de `getAccelerationForMass` — vx/vy à 0 ici, aucun tick de physique n'a
    // encore fait bouger le morceau fraîchement spawné avant ce `state`.
    expect(state.self).toEqual({
      accelerationPerSec2: 150, // masse 50 * 3
      pieces: [{ id: '1', vx: 0, vy: 0 }],
    });

    socket.close();
  });

  it('n’envoie pas `self.accelerationPerSec2` si le mod n’expose pas getAccelerationForMass (mais envoie `self.pieces`)', async () => {
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
    const state = messages.find((m) => m.type === 'state') as {
      self?: { accelerationPerSec2?: number; pieces?: unknown };
    };

    // `self` reste envoyé (le joueur a un morceau, donc `pieces` est peuplé — voir
    // fix_vitesse_reseau.md) même si `accelerationPerSec2` est absent (mod sans
    // getAccelerationForMass).
    expect(state.self?.accelerationPerSec2).toBeUndefined();
    expect(state.self?.pieces).toEqual([{ id: '1', vx: 0, vy: 0 }]);

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

  it('filtre par intérêt : une particule proche est diffusée, une très loin ne l’est pas (cahier_des_charges_perf_reseau_grande_carte.md §3)', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 100_000 }));
    const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;
    const room = manager.getManagedRoom(summary.id)!.room!;

    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    // Une particule proche (dans le rayon d'intérêt à masse 50) et une très loin (bien au-delà,
    // même avec la marge de sécurité — voir shared/src/camera.ts `interestRadiusForMass`).
    room.world.spawnParticle({ x: 100, y: 0 }, 1);
    room.world.spawnParticle({ x: 50_000, y: 50_000 }, 1);

    room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as {
      entities: Array<{ x: number; y: number }>;
    };

    expect(state.entities.some((e) => e.x === 100 && e.y === 0)).toBe(true);
    expect(state.entities.some((e) => e.x === 50_000)).toBe(false);
    expect(state.entities.some((e) => e.x === 0 && e.y === 0)).toBe(true); // son propre morceau, toujours inclus

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
      // `disconnectGraceMs` court : le pseudo ne se libère qu'à l'expiration du délai de grâce
      // (voir connectionHandler.ts, correctif "déconnexion = perte immédiate de l'XP en cours"),
      // pas au ferme de socket lui-même — 8s par défaut en production, bien trop long pour ce test.
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0, disconnectGraceMs: 20 });
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
      const messages = collectMessages(spectator);
      await waitForOpen(spectator);

      await waitUntil(() => messages.some((m) => m.type === 'welcome'));
      expect(messages.find((m) => m.type === 'welcome')).toMatchObject({ mapSize: 4242 });
      expect(manager.getManagedRoom(summary.id)!.room.world.allPlayers()).toHaveLength(0);

      spectator.close();
    });

    it('un spectateur reçoit un tick qui avance de 1 par message, jamais le tick de simulation brut (correctif dérive ~3s du fond spectateur)', async () => {
      // tickRateHz=20 (réel) / SPECTATOR_TICK_DIVISOR (2, v5.8 — était 4) = 10Hz annoncés dans
      // `welcome` à ce spectateur — si le champ `tick` de chaque `state` reçu n'était PAS
      // renuméroté en tick spectateur séquentiel (voir roomInstance.ts `handleTick`), il
      // avancerait de SPECTATOR_TICK_DIVISOR par message au lieu de 1, désynchronisant la ligne de
      // temps de lecture du client (RenderEngine) de son hypothèse `1000/tickRateHz` ms par unité
      // de tick — la cause du retard croissant rapporté par l'utilisateur (~3s au bout de quelques
      // secondes d'observation).
      const manager = makeManager(testResolver());
      const summary = manager.createRoom({ name: 'A', modId: 'test', visibility: 'public' });
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
      const port = await handle.whenReady;

      const spectator = new WebSocket(`ws://localhost:${port}/?roomId=${summary.id}&spectate=1`);
      const messages = collectMessages(spectator);
      await waitForOpen(spectator);

      const stateTicks = (): number[] =>
        messages.filter((m) => m.type === 'state').map((m) => m.tick as number);
      await waitUntil(() => stateTicks().length >= 3);

      const ticks = stateTicks();
      for (let i = 1; i < ticks.length; i++) {
        expect(ticks[i]! - ticks[i - 1]!).toBe(1);
      }

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
        // Résolu par défaut (DEFAULT_RESET_SCHEDULE) faute de resetSchedule explicite — voir
        // roomManager.ts `createRoom`/`nextResetAtMsOf` ; l'horodatage exact dépend de l'heure
        // d'exécution du test, seul son existence (nombre fini) compte ici.
        nextResetAtMs: expect.any(Number),
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

  it('GET /api/avatars renvoie la liste dynamique des avatars scannés dans assets/Profil', async () => {
    const manager = makeManager(testResolver());
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0 });
    const port = await handle.whenReady;

    const response = await fetch(`http://localhost:${port}/api/avatars`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as { avatars: Array<{ id: string; name: string; url: string }> };
    expect(Array.isArray(body.avatars)).toBe(true);
    expect(body.avatars.length).toBeGreaterThan(0);
    // Pas de nom de fichier codé en dur (le roster réel d'assets/Profil/ change au fil des
    // sessions, voir shared/src/avatarPalette.ts) — vérifie seulement la forme attendue.
    expect(body.avatars.every((a) => typeof a.id === 'string' && a.id.length > 0)).toBe(true);
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

  it('renvoie modId dans le `welcome` de RESPAWN, pas seulement celui du join initial (régression : la musique retombait toujours sur Vanilla après un respawn en salon Hardcore, ce champ manquait dans ce second welcome)', async () => {
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
    const firstWelcome = messages.find((m) => m.type === 'welcome')!;
    expect(firstWelcome.modId).toBe('test');

    // Simule la mort : retire tous les morceaux du joueur (comme le ferait le moteur de jeu),
    // sans attendre un vrai `onCollision`/absorption — seul l'état "plus aucun morceau" compte
    // pour `RoomInstance.respawn`.
    const world = manager.getManagedRoom(summary.id)!.room.world;
    const player = world.getPlayer(String(firstWelcome.playerId));
    for (const pieceId of [...(player?.pieceIds ?? [])]) world.removeEntity(pieceId);

    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    await waitUntil(() => messages.filter((m) => m.type === 'welcome').length >= 2);
    const respawnWelcome = messages.filter((m) => m.type === 'welcome')[1]!;

    expect(respawnWelcome.modId).toBe('test');

    socket.close();
  });

  it('affiche la réplique du bot tueur sur l’écran de mort (demande utilisateur) plutôt que le message personnalisé du joueur', async () => {
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
    socket.send(JSON.stringify({ type: 'join', nickname: 'Victime' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    const room = manager.getManagedRoom(summary.id)!.room;
    const world = room.world;
    // Un premier tick avec le morceau encore présent est nécessaire pour que `player.alive` passe
    // à `true` (voir room.ts `tick()`) — la détection de mort ne déclenche `onPlayerDeath` que sur
    // la transition `alive -> !alive`, jamais sur un joueur déjà `alive: false` par défaut
    // (`world.addPlayer`).
    room.tick();

    // "Bot" tueur : seul le pseudo compte pour la réplique (voir BOT_KILL_MESSAGES, indexé par
    // nom) — pas besoin de passer par le vrai `BotManager` pour ce test.
    world.addPlayer('bot-1', 'Robibou');
    world.recordAttacker(String(welcome.playerId), 'bot-1');
    const victim = world.getPlayer(String(welcome.playerId))!;
    for (const pieceId of [...victim.pieceIds]) world.removeEntity(pieceId);

    room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'died'));
    const died = messages.find((m) => m.type === 'died')!;

    expect(died.killerNickname).toBe('Robibou');
    expect(died.customCard).toMatchObject({
      message: 'Un gros câlin mortel de Robibou, étouffe-toi avec mon amour !',
      bannerId:
        'https://media2.giphy.com/media/v1.Y2lkPTc5MGI3NjExZW5uMnpiaGVzaHA5cmNrNXdncHVobTNrenU5MW5ubzUxMHlzcnU4eSZlcD12MV9pbnRlcm5hbF9naWZfYnlfaWQmY3Q9Zw/KmxmoHUGPDjfQXqGgv/giphy.gif',
    });

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
    // `disconnectGraceMs` court (8s par défaut en production, voir connectionHandler.ts) : ce bloc
    // de tests vérifie le crédit XP/score à la déconnexion juste après `socket.close()`, pas le
    // délai de grâce lui-même (couvert par server.test.ts, autre describe).
    handle = startGameServer(manager, {
      port: 0,
      rateLimitMaxAttempts: 0,
      accounts,
      admin,
      disconnectGraceMs: 20,
      availableModIds: ['vanilla', 'hardcore'],
    });
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

  // Couverture ajoutée : le test "crédite l'XP... à la déconnexion" ci-dessus ne couvrait que le
  // chemin `leave()` (fermeture de socket), jamais le chemin `onPlayerDeath` (mort en jeu,
  // broadcast.ts) — avec les VRAIS mods (vanilla/hardcore, via resolveMod), pas le mod factice
  // `{ id: 'test' }` utilisé partout ailleurs dans ce fichier. Sert de garde-fou de régression
  // pour le classement/meilleur score/gain d'XP (signalé "ne marche pas" par l'utilisateur —
  // audit : le chemin `leave()` était déjà couvert et fonctionnait, celui-ci ne l'était pas
  // encore ; les deux se sont révélés corrects une fois testés bout en bout contre un vrai
  // Postgres, voir le résultat de ce test).
  it.each(['vanilla', 'hardcore'] as const)(
    'crédite le meilleur score de masse à la MORT (pas seulement à la déconnexion) avec le vrai mod %s',
    async (modId) => {
      const host = createLocalRoomHost(resolveMod);
      const manager = new RoomManager(host, 20, { emptyRoomGraceMs: 10_000_000 });
      managers.push(manager);
      const accounts = new AccountsService(pool);
      handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0, accounts });
      const port = await handle.whenReady;

      const pseudo = uniquePseudo(modId === 'hardcore' ? 'dhc' : 'dva');
      const { token } = await accounts.register(pseudo, 'motdepasse123');
      const accountId = accounts.resolveToken(token)!;
      const summary = manager.createRoom({ name: 'Diag', modId, visibility: 'public' });

      const socket = new WebSocket(
        `ws://localhost:${port}/?roomId=${summary.id}&token=${encodeURIComponent(token)}`,
      );
      await waitForOpen(socket);
      const messages = collectMessages(socket);
      socket.send(JSON.stringify({ type: 'join', nickname: 'Diag' }));
      await waitUntil(() => messages.some((m) => m.type === 'welcome'));
      const welcome = messages.find((m) => m.type === 'welcome')!;
      const playerId = String(welcome.playerId);

      const room = manager.getManagedRoom(summary.id)!.room;
      const world = room.world;
      room.tick(); // player.alive -> true

      // Simule une vie : masse gagnée (peak mass -> best score) + XP accumulée (engine/xp.ts),
      // sans rejouer toute la mécanique d'absorption (déjà couverte ailleurs).
      const player = world.getPlayer(playerId)!;
      const piece = world.getEntity(player.pieceIds[0]!)!;
      world.setMass(piece, 5000);
      player.lifeStats.xpEarned = 777;
      room.tick(); // fait progresser maxMassByPlayer (RoomInstance) au-delà du spawn initial

      for (const pieceId of [...player.pieceIds]) world.removeEntity(pieceId);
      room.tick(); // détecte la mort -> onPlayerDeath -> handleDeath -> broadcast.ts

      await waitUntil(() => messages.some((m) => m.type === 'died'));
      const died = messages.find((m) => m.type === 'died')!;
      // Le message `died` porte toujours le score/XP BRUTS de cette vie (avant transformation
      // propre au mod) — affichés à l'écran de mort quel que soit le mode, contrairement à ce qui
      // est réellement crédité en base (voir plus bas).
      expect(died.finalScore).toBeGreaterThanOrEqual(5000);
      expect(died.xpEarned).toBe(777);

      // Écriture en base asynchrone (best-effort, voir broadcast.ts `onPlayerDeath`) : on
      // interroge le profil jusqu'à ce que LES DEUX écritures indépendantes (recordBestMass +
      // recordGameResult, deux appels distincts) soient visibles, plutôt qu'un délai fixe.
      const deadline = Date.now() + 2000;
      let profile = await accounts.getProfile(accountId);
      while (
        Date.now() < deadline &&
        ((profile?.bestScores.length ?? 0) === 0 || (profile?.xp ?? 0) === 0)
      ) {
        await new Promise((resolve) => setTimeout(resolve, 20));
        profile = await accounts.getProfile(accountId);
      }

      // Meilleur score de masse ET XP : crédités normalement dans LES DEUX modes — Hardcore ne
      // surcharge plus `transformScoreForAccount` (ancienne punition d'exemple retirée, voir
      // mods/hardcore/index.ts), son comportement de crédit est désormais identique à Vanilla.
      expect(profile?.bestScores[0]?.bestScore).toBeGreaterThanOrEqual(5000);
      expect(profile?.xp).toBe(777);

      socket.close();
    },
  );

  it("un invité qui meurt avec un score reçoit un claimId, réclamable après inscription (demande utilisateur : sauvegarder le score d'une partie jouée sans compte)", async () => {
    // VRAI mod (`resolveMod`, comme le test ci-dessus) — pas le mod factice `{id:'test'}` de
    // `startServer()`/`makeManager()` (sans `onPlayerJoin`, aucun morceau n'apparaît jamais).
    const accounts = new AccountsService(pool);
    const host = createLocalRoomHost(resolveMod);
    const manager = new RoomManager(host, 20, { emptyRoomGraceMs: 10_000_000 });
    managers.push(manager);
    handle = startGameServer(manager, { port: 0, rateLimitMaxAttempts: 0, accounts });
    const port = await handle.whenReady;
    const summary = manager.createRoom({ name: 'Claim', modId: 'vanilla', visibility: 'public' });

    // Connexion INVITÉE (pas de `token` dans l'URL, voir connectionHandler.ts) — `accountId` reste
    // inconnu du serveur pour ce joueur, contrairement au test précédent.
    const socket = await connectedClient(port, summary.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'GuestScorer' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;
    const playerId = String(welcome.playerId);

    const room = manager.getManagedRoom(summary.id)!.room;
    const world = room.world;
    room.tick(); // player.alive -> true

    const player = world.getPlayer(playerId)!;
    const piece = world.getEntity(player.pieceIds[0]!)!;
    world.setMass(piece, 3000);
    player.lifeStats.xpEarned = 456;
    room.tick(); // fait progresser maxMassByPlayer au-delà du spawn initial

    for (const pieceId of [...player.pieceIds]) world.removeEntity(pieceId);
    room.tick(); // détecte la mort -> onPlayerDeath -> broadcast.ts

    await waitUntil(() => messages.some((m) => m.type === 'died'));
    const died = messages.find((m) => m.type === 'died')!;
    expect(died.finalScore).toBe(3000);
    expect(died.xpEarned).toBe(456);
    // LE POINT CENTRAL : un identifiant opaque, JAMAIS le score/XP en clair (voir le commentaire
    // de `AccountsService.createScoreClaim` sur pourquoi — un client authentifié pourrait sinon
    // frauder son propre crédit de compte en appelant directement l'endpoint de réclamation).
    expect(typeof died.claimId).toBe('string');
    socket.close();

    // Inscription juste après la mort (scénario voulu : proposer de créer un compte sur l'écran
    // de fin de partie) — puis réclamation du score en attente avec le tout nouveau token.
    const pseudo = uniquePseudo('guestscorer');
    const { token } = await accounts.register(pseudo, 'motdepasse123');
    const accountId = accounts.resolveToken(token)!;

    const claimResponse = await fetch(`http://localhost:${port}/api/account/claim-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ claimId: died.claimId }),
    });
    expect(claimResponse.status).toBe(200);
    expect(await claimResponse.json()).toEqual({ claimed: true });

    const profile = await accounts.getProfile(accountId);
    expect(profile?.bestScores).toEqual([{ modeId: 'vanilla', bestScore: 3000 }]);
    expect(profile?.xp).toBe(456);

    // Usage UNIQUE (voir `PendingScoreClaims.consume`) : une seconde tentative avec le MÊME
    // claimId échoue silencieusement, ne recrédite jamais deux fois.
    const secondAttempt = await fetch(`http://localhost:${port}/api/account/claim-score`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ claimId: died.claimId }),
    });
    expect(await secondAttempt.json()).toEqual({ claimed: false });
  });

  it('POST /api/admin/login : 503 sans ADMIN_PASSWORD_HASH, 401 si mauvais mot de passe, 200 + token sinon', async () => {
    const { port } = await startServer(false);

    const notConfigured = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'whatever' }),
    });
    expect(notConfigured.status).toBe(503);
  });

  it('POST /api/admin/login accepte le bon mot de passe, refuse le mauvais', async () => {
    const { port } = await startServer();

    const wrong = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
    });
    expect(wrong.status).toBe(401);

    const right = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
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
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    const searchResponse = await fetch(
      `http://localhost:${port}/api/admin/players?q=${encodeURIComponent(pseudo)}`,
      { headers: authHeaders },
    );
    expect(searchResponse.status).toBe(200);
    const { rows } = (await searchResponse.json()) as {
      rows: Array<{ id: number; pseudo: string }>;
      total: number;
    };
    expect(rows.some((r) => r.id === accountId)).toBe(true);

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

  it('GET /api/admin/rooms liste les salons (y compris privés) avec leurs joueurs (cahier_des_charges_admin.md §3.3)', async () => {
    const { port, manager } = await startServer();
    const pub = manager.createRoom({ name: 'Public', modId: 'test', visibility: 'public' });
    const priv = manager.createRoom({ name: 'Privé', modId: 'test', visibility: 'private' });

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    const socket = await connectedClient(port, pub.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    const roomsResponse = await fetch(`http://localhost:${port}/api/admin/rooms`, {
      headers: authHeaders,
    });
    expect(roomsResponse.status).toBe(200);
    const rooms = (await roomsResponse.json()) as Array<{
      id: string;
      visibility: string;
      players: Array<{ nickname: string; isBot: boolean }>;
    }>;
    expect(rooms.map((r) => r.id)).toEqual(expect.arrayContaining([pub.id, priv.id]));
    const pubRoom = rooms.find((r) => r.id === pub.id)!;
    expect(pubRoom.players.some((p) => p.nickname === 'Alice' && p.isBot === false)).toBe(true);

    socket.close();
  });

  it('GET/PUT /api/admin/base-rooms lit et réécrit server/rooms.json, restauré après le test (§13 cahier_des_charges_admin.md)', async () => {
    const { port } = await startServer();

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };
    const authHeaders = { Authorization: `Bearer ${adminToken}` };

    const getResponse = await fetch(`http://localhost:${port}/api/admin/base-rooms`, {
      headers: authHeaders,
    });
    expect(getResponse.status).toBe(200);
    const original = (await getResponse.json()) as Array<{ name: string; modId: string }>;
    expect(original.length).toBeGreaterThanOrEqual(1);

    try {
      const rejectedPut = await fetch(`http://localhost:${port}/api/admin/base-rooms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify([{ name: 'Sans mode', modId: 'mode-inexistant' }]),
      });
      expect(rejectedPut.status).toBe(400);

      const draft = [{ name: 'Salon Vanilla Test', modId: 'vanilla' }];
      const putResponse = await fetch(`http://localhost:${port}/api/admin/base-rooms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(draft),
      });
      expect(putResponse.status).toBe(200);

      const afterPut = await fetch(`http://localhost:${port}/api/admin/base-rooms`, {
        headers: authHeaders,
      });
      expect(await afterPut.json()).toEqual(draft);
    } finally {
      await fetch(`http://localhost:${port}/api/admin/base-rooms`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', ...authHeaders },
        body: JSON.stringify(original),
      });
    }
  });

  it('POST /api/admin/rooms/:id/action exécute une action générique (kill) sur un joueur (§4.3)', async () => {
    const { port, manager } = await startServer();
    const room = manager.createRoom({ name: 'Kill', modId: 'test', visibility: 'public' });

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };

    const socket = await connectedClient(port, room.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;
    const playerId = welcome.playerId as string;

    // Le mod de test ("test") n'a pas de onPlayerJoin : aucun morceau au join, donc on en spawn un
    // directement (même principe que le test XP plus haut, qui manipule `player.lifeStats`).
    manager.getManagedRoom(room.id)!.room!.world.spawnPiece(playerId, { x: 0, y: 0 }, 50);

    const actionResponse = await fetch(
      `http://localhost:${port}/api/admin/rooms/${room.id}/action`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
        body: JSON.stringify({ action: { kind: 'kill', playerId } }),
      },
    );
    expect(actionResponse.status).toBe(200);
    expect(await actionResponse.json()).toMatchObject({ ok: true });
    expect(
      manager.getManagedRoom(room.id)!.room!.world.getPiecesByOwner(playerId),
    ).toHaveLength(0);

    socket.close();
  });

  it('POST /api/admin/rooms/:id/kick ferme la connexion du joueur ciblé (§3.3)', async () => {
    const { port, manager } = await startServer();
    const room = manager.createRoom({ name: 'Kick', modId: 'test', visibility: 'public' });

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };

    const socket = await connectedClient(port, room.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Carol' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const playerId = messages.find((m) => m.type === 'welcome')!.playerId as string;

    const kickResponse = await fetch(`http://localhost:${port}/api/admin/rooms/${room.id}/kick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ playerId }),
    });
    expect(kickResponse.status).toBe(200);
    await waitUntil(() => socket.readyState === WebSocket.CLOSED);
  });

  it('POST /api/admin/broadcast diffuse une annonce à tous les joueurs connectés (§4.6)', async () => {
    const { port, manager } = await startServer();
    const room = manager.createRoom({ name: 'Broadcast', modId: 'test', visibility: 'public' });

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };

    const socket = await connectedClient(port, room.id);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Dave' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    const broadcastResponse = await fetch(`http://localhost:${port}/api/admin/broadcast`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
      body: JSON.stringify({ text: 'Salut tout le monde', color: '#ff0000', durationMs: 2000 }),
    });
    expect(broadcastResponse.status).toBe(200);
    expect(await broadcastResponse.json()).toMatchObject({ success: true, sent: 1 });

    await waitUntil(() => messages.some((m) => m.type === 'announcement'));
    const announcement = messages.find((m) => m.type === 'announcement')!;
    expect(announcement).toMatchObject({ text: 'Salut tout le monde', color: '#ff0000' });

    socket.close();
  });

  it('canal WS admin (?admin=1) : rejette un token invalide, diffuse le snapshot complet et exécute une action (§4-§5.2)', async () => {
    const { port, manager } = await startServer();
    const room = manager.createRoom({ name: 'Creative', modId: 'test', visibility: 'public' });
    manager.getManagedRoom(room.id)!.room!.world.addPlayer('bot-1', 'Bot');
    manager.getManagedRoom(room.id)!.room!.world.spawnPiece('bot-1', { x: 100, y: 100 }, 42);

    const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
    });
    const { token: adminToken } = (await loginResponse.json()) as { token: string };

    const rejected = new WebSocket(
      `ws://localhost:${port}/?roomId=${room.id}&admin=1&token=bogus`,
    );
    await new Promise<void>((resolve) => rejected.once('close', () => resolve()));

    const adminSocket = new WebSocket(
      `ws://localhost:${port}/?roomId=${room.id}&admin=1&token=${encodeURIComponent(adminToken)}`,
    );
    const adminMessages = collectMessages(adminSocket);
    await waitForOpen(adminSocket);
    await waitUntil(() => adminMessages.some((m) => m.type === 'welcome'));

    adminSocket.send(
      JSON.stringify({
        type: 'admin_action',
        actionId: 'test-1',
        action: { kind: 'setMass', playerId: 'bot-1', mass: 999 },
      }),
    );
    await waitUntil(() =>
      adminMessages.some((m) => m.type === 'admin_action_result' && m.actionId === 'test-1'),
    );
    const actionResult = adminMessages.find((m) => m.type === 'admin_action_result')!;
    expect(actionResult).toMatchObject({ result: { ok: true } });

    adminSocket.close();
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
        body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
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
        expect(socket.readyState).toBe(1);
        socket.close();
      } finally {
        customHandle.close();
      }
    });

    it('supporte GET/PUT /api/admin/mods/:id et POST /api/admin/server/reload (v6.1)', async () => {
      const { port } = await startServer();
      const loginResponse = await fetch(`http://localhost:${port}/api/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: 'admin', password: 'adminpass123' }),
      });
      const { token } = (await loginResponse.json()) as { token: string };

      // GET /api/admin/mods/vanilla
      const getModRes = await fetch(`http://localhost:${port}/api/admin/mods/vanilla`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(getModRes.status).toBe(200);
      const modConfig = (await getModRes.json()) as { id: string };
      expect(modConfig.id).toBe('vanilla');

      // PUT /api/admin/mods/vanilla
      const putModRes = await fetch(`http://localhost:${port}/api/admin/mods/vanilla`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(modConfig),
      });
      expect(putModRes.status).toBe(200);

      // POST /api/admin/server/reload
      const reloadRes = await fetch(`http://localhost:${port}/api/admin/server/reload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      });
      expect(reloadRes.status).toBe(200);
      const reloadBody = (await reloadRes.json()) as { success: boolean };
      expect(reloadBody.success).toBe(true);
    });
  });
});
