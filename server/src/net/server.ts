import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import {
  distance,
  type ClientMessage,
  type EntitySnapshot,
  type ServerMessage,
} from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { SpatialHash } from '../engine/spatialHash.js';
import type { Entity, PlayerId } from '../engine/types.js';
import type { Room } from '../engine/room.js';

export interface GameServerOptions {
  port: number;
  /** Répertoire de fichiers statiques du client à servir (Lot 1.7), optionnel. */
  staticDir?: string;
  /** Rayon (px, unité de simulation) autour de la caméra de chaque joueur au-delà duquel les
   * entités ne sont plus diffusées à ce client — voir "interest management" ci-dessous.
   * Volontairement généreux et fixe plutôt que calé sur le zoom réel du client (qui varie avec
   * sa taille d'écran, inconnue du serveur) : suffisant pour la plupart des cas, à affiner plus
   * tard si le client transmet un jour ses dimensions de viewport. */
  interestRadiusPx?: number;
}

const MAX_NICKNAME_LENGTH = 20;
const INTEREST_RADIUS_PX_DEFAULT = 3000;

export interface GameServerHandle {
  /** Résout avec le port réellement utilisé (utile en test avec `port: 0`). */
  whenReady: Promise<number>;
  close(): void;
}

/**
 * Branche une Room existante sur un serveur HTTP + WebSocket : gère join/input/close et
 * diffuse l'état du monde à chaque tick. Optimisations réseau (Lot 1.8) :
 *   - compression WebSocket (`perMessageDeflate`) ;
 *   - nombres arrondis avant sérialisation (la précision flottante complète est inutile) ;
 *   - *interest management* : chaque client ne reçoit que les entités proches de sa propre
 *     caméra (+ toujours ses propres morceaux), pas le monde entier — toujours pas de delta
 *     compression (un snapshot complet, mais restreint, à chaque tick).
 */
export function startGameServer(room: Room, options: GameServerOptions): GameServerHandle {
  const interestRadiusPx = options.interestRadiusPx ?? INTEREST_RADIUS_PX_DEFAULT;

  const httpServer = createServer((req, res) => {
    void serveStatic(options.staticDir, req, res);
  });

  const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });
  const sockets = new Map<PlayerId, WebSocket>();
  // Grille dédiée à l'interest management, distincte de celle des collisions (World) : maille
  // large (= interestRadiusPx) pour qu'une requête sur les 9 cellules voisines couvre bien tout
  // le rayon d'intérêt, quel que soit l'endroit de sa cellule où se trouve le point interrogé.
  const interestHash = new SpatialHash(interestRadiusPx);
  // Id courts plutôt que des UUID — voir World.spawnEntity et plan Lot 1.8 (bande passante).
  let nextPlayerId = 1;

  wss.on('connection', (socket: WebSocket) => {
    let playerId: PlayerId | undefined;

    socket.on('message', (raw: Buffer) => {
      const message = parseClientMessage(raw);
      if (!message) return;

      if (message.type === 'join' && !playerId) {
        playerId = String(nextPlayerId++);
        sockets.set(playerId, socket);
        const nickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || 'Joueur';
        room.addPlayer(playerId, nickname);
        send(socket, { type: 'welcome', playerId, mapSize: room.world.mapSize });

        // Le nouvel arrivant apprend les pseudos déjà connus (les autres, pas lui — couvert
        // par la diffusion ci-dessous, qui l'inclut).
        for (const existingPlayer of room.world.allPlayers()) {
          if (existingPlayer.id === playerId) continue;
          send(socket, {
            type: 'player',
            playerId: existingPlayer.id,
            nickname: existingPlayer.nickname,
          });
        }
        // Tout le monde apprend le nouveau pseudo — message rare, pas répété à chaque tick (Lot 1.8).
        const playerInfo: ServerMessage = { type: 'player', playerId, nickname };
        for (const otherSocket of sockets.values()) send(otherSocket, playerInfo);
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

    interestHash.clear();
    for (const entity of room.world.allEntities()) interestHash.insert(entity);

    for (const [playerId, socket] of sockets) {
      const ownPieces = room.world.getPiecesByOwner(playerId);
      const center = centroidOf(ownPieces) ?? {
        x: room.world.mapSize / 2,
        y: room.world.mapSize / 2,
      };

      // Toujours voir ses propres morceaux, même hors du rayon d'intérêt (ne devrait pas
      // arriver en pratique puisque le rayon est centré dessus, mais reste correct si jamais).
      const visible = new Map<string, Entity>();
      for (const piece of ownPieces) visible.set(piece.id, piece);

      for (const id of interestHash.queryNearby(center)) {
        const entity = room.world.getEntity(id);
        if (entity && distance(entity.position, center) <= interestRadiusPx) {
          visible.set(entity.id, entity);
        }
      }

      const entities: EntitySnapshot[] = [...visible.values()].map(toSnapshot);
      send(socket, { type: 'state', tick, entities });
    }
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

function centroidOf(pieces: Entity[]): { x: number; y: number } | undefined {
  if (pieces.length === 0) return undefined;

  let totalMass = 0;
  let x = 0;
  let y = 0;
  for (const piece of pieces) {
    totalMass += piece.mass;
    x += piece.position.x * piece.mass;
    y += piece.position.y * piece.mass;
  }
  return { x: x / totalMass, y: y / totalMass };
}

/** Arrondi à 1 décimale : la précision flottante complète (ex. `1579.9018746980125`) n'apporte
 * rien visuellement mais alourdit sensiblement chaque message (Lot 1.8). Utilisé pour
 * position/rayon, qui affectent directement le rendu — le dixième de pixel évite un
 * "escalier" perceptible au zoom maximal du client (×2, render.ts). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** La masse n'est jamais utilisée pixel par pixel côté client (seul `r`, déjà arrondi, sert au
 * rendu ; `m` n'influence que le calcul de zoom de la caméra, insensible à ±0.5) — un entier
 * suffit et coûte un caractère de moins par entité que `round1`. */
function roundMass(value: number): number {
  return Math.round(value);
}

function toSnapshot(entity: Entity): EntitySnapshot {
  return {
    i: entity.id,
    k: entity.kind === 'particle' ? 'f' : 'c',
    x: round1(entity.position.x),
    y: round1(entity.position.y),
    r: round1(entity.radius),
    m: roundMass(entity.mass),
    p: entity.ownerId,
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
