import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { GameMod } from '../engine/mod.js';
import { Room } from '../engine/room.js';
import { startGameServer, type GameServerHandle } from './server.js';

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

async function connectedClient(port: number): Promise<WebSocket> {
  const socket = new WebSocket(`ws://localhost:${port}`);
  await waitForOpen(socket);
  return socket;
}

describe('startGameServer', () => {
  let handle: GameServerHandle | undefined;

  afterEach(() => {
    handle?.close();
    handle = undefined;
  });

  it('répond à un join par un welcome contenant un id de joueur et la taille de la carte', async () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, { mapSize: 1234, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));

    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    expect(welcome).toMatchObject({ type: 'welcome', mapSize: 1234 });
    expect(typeof welcome.playerId).toBe('string');

    socket.close();
  });

  it('diffuse l’état du monde après un join, avec le morceau du joueur et son pseudo', async () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port);
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

    room.tick();
    await waitUntil(() => messages.some((m) => m.type === 'state'));
    const state = messages.find((m) => m.type === 'state') as { entities: Array<{ p?: string }> };

    expect(state.entities.some((e) => e.p === welcome.playerId)).toBe(true);

    socket.close();
  });

  it('envoie les pseudos déjà connus à un nouvel arrivant (backfill)', async () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const first = await connectedClient(port);
    const firstMessages = collectMessages(first);
    first.send(JSON.stringify({ type: 'join', nickname: 'Eve' }));
    await waitUntil(() => firstMessages.some((m) => m.type === 'welcome'));
    const firstWelcome = firstMessages.find((m) => m.type === 'welcome')!;

    const second = await connectedClient(port);
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
    const receivedInputs: Array<{ dir: { x: number; y: number }; split: boolean }> = [];
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
      onPlayerInput: (_world, _playerId, input) => {
        receivedInputs.push(input);
      },
    };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));

    socket.send(JSON.stringify({ type: 'input', dir: { x: 1, y: 0 }, split: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(receivedInputs).toEqual([{ dir: { x: 1, y: 0 }, split: true }]);

    socket.close();
  });

  it('ignore un message malformé sans planter le serveur', async () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port);
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
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    handle = startGameServer(room, { port: 0 });
    const port = await handle.whenReady;

    const socket = await connectedClient(port);
    const messages = collectMessages(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Dan' }));
    await waitUntil(() => messages.some((m) => m.type === 'welcome'));
    const welcome = messages.find((m) => m.type === 'welcome')!;

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(removedPlayerIds).toEqual([welcome.playerId]);
  });
});
