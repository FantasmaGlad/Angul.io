import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import type { ClientMessage, EntitySnapshot, ServerMessage } from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { Room } from '../engine/room.js';
import type { PlayerId } from '../engine/types.js';

export interface GameServerOptions {
  port: number;
  /** Répertoire de fichiers statiques du client à servir (Lot 1.7), optionnel. */
  staticDir?: string;
}

const MAX_NICKNAME_LENGTH = 20;

export interface GameServerHandle {
  /** Résout avec le port réellement utilisé (utile en test avec `port: 0`). */
  whenReady: Promise<number>;
  close(): void;
}

/**
 * Branche une Room existante sur un serveur HTTP + WebSocket : gère join/input/close et
 * diffuse l'état du monde à chaque tick (état complet, pas de delta compression au MVP —
 * voir plan Lot 1.4).
 */
export function startGameServer(room: Room, options: GameServerOptions): GameServerHandle {
  const httpServer = createServer((req, res) => {
    void serveStatic(options.staticDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer });
  const sockets = new Map<PlayerId, WebSocket>();

  wss.on('connection', (socket: WebSocket) => {
    let playerId: PlayerId | undefined;

    socket.on('message', (raw: Buffer) => {
      const message = parseClientMessage(raw);
      if (!message) return;

      if (message.type === 'join' && !playerId) {
        playerId = randomUUID();
        sockets.set(playerId, socket);
        const nickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || 'Joueur';
        room.addPlayer(playerId, nickname);
        send(socket, { type: 'welcome', playerId, mapSize: room.world.mapSize });
        return;
      }

      if (message.type === 'input' && playerId) {
        room.handleInput(playerId, { dir: message.dir, split: message.split });
      }
    });

    socket.on('close', () => {
      if (!playerId) return;
      room.removePlayer(playerId);
      sockets.delete(playerId);
    });
  });

  room.onState((tick) => {
    if (sockets.size === 0) return; // rien à diffuser si personne n'est connecté
    const entities: EntitySnapshot[] = room.world.allEntities().map((entity) => ({
      id: entity.id,
      kind: entity.kind,
      x: entity.position.x,
      y: entity.position.y,
      radius: entity.radius,
      mass: entity.mass,
      ownerId: entity.ownerId,
      ownerNickname: entity.ownerId ? room.world.getPlayer(entity.ownerId)?.nickname : undefined,
    }));
    const stateMessage: ServerMessage = { type: 'state', tick, entities };
    for (const socket of sockets.values()) send(socket, stateMessage);
  });

  room.onPlayerDeath((playerId) => {
    const socket = sockets.get(playerId);
    if (socket) send(socket, { type: 'died' });
  });

  const whenReady = new Promise<number>((resolvePort) => {
    httpServer.listen(options.port, () => {
      const address = httpServer.address();
      resolvePort(typeof address === 'object' && address ? address.port : options.port);
    });
  });

  return {
    whenReady,
    close: () => {
      wss.close();
      httpServer.close();
    },
  };
}

function parseClientMessage(raw: Buffer): ClientMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as ClientMessage;
    }
  } catch {
    // message malformé : ignoré silencieusement, pas de crash serveur pour un client qui envoie n'importe quoi
  }
  return undefined;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

async function serveStatic(
  dir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!dir) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rootDir = resolve(dir);
  const requestedPath = req.url && req.url !== '/' ? req.url.split('?')[0] : '/index.html';
  const filePath = join(rootDir, normalize(String(requestedPath)));

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    await stat(filePath);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath) });
  createReadStream(filePath).pipe(res);
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  return 'application/octet-stream';
}
