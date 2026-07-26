import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import type { GameMod } from '../engine/mod.js';
import { Room } from '../engine/room.js';
import { startGameServer, type GameServerHandle } from './server.js';

function waitForMessage(socket: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    socket.once('message', (raw: Buffer) => resolve(JSON.parse(raw.toString())));
  });
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
    const welcomePromise = waitForMessage(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Test' }));
    const welcome = await welcomePromise;

    expect(welcome).toMatchObject({ type: 'welcome', mapSize: 1234 });
    expect(typeof welcome.playerId).toBe('string');

    socket.close();
  });

  it('diffuse l’état du monde après un join, avec le morceau du joueur', async () => {
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
    socket.send(JSON.stringify({ type: 'join', nickname: 'Alice' }));
    await waitForMessage(socket); // welcome

    const statePromise = waitForMessage(socket);
    room.tick();
    const state = await statePromise;

    expect(state.type).toBe('state');
    const entities = state.entities as Array<{ ownerNickname?: string }>;
    expect(entities.some((e) => e.ownerNickname === 'Alice')).toBe(true);

    socket.close();
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
    socket.send(JSON.stringify({ type: 'join', nickname: 'Bob' }));
    await waitForMessage(socket); // welcome

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
    socket.send('ceci n’est pas du JSON');

    const welcomePromise = waitForMessage(socket);
    socket.send(JSON.stringify({ type: 'join', nickname: 'Carol' }));
    const welcome = await welcomePromise;

    expect(welcome.type).toBe('welcome');

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
    const welcome = await (async () => {
      const p = waitForMessage(socket);
      socket.send(JSON.stringify({ type: 'join', nickname: 'Dan' }));
      return p;
    })();

    socket.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(removedPlayerIds).toEqual([welcome.playerId]);
  });
});
