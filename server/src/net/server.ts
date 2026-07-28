import { createServer, type IncomingMessage } from 'node:http';
import { WS_CLOSE_ROOM_EXPIRED } from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AccountsService } from '../accounts/service.js';
import type { AdminAuth } from '../admin/adminAuth.js';
import type { ManagedRoom, RoomManager } from '../engine/roomManager.js';
import { handleHttpRequest } from './http/router.js';
import { RateLimiter } from './rateLimiter.js';
import { wireRoom as wireRoomBroadcast, type RoomRuntime } from './ws/broadcast.js';
import { handleWsConnection } from './ws/connectionHandler.js';

export interface GameServerOptions {
  port: number;
  staticDir?: string;
  interestRadiusPx?: number;
  availableModIds?: string[];
  accounts?: AccountsService;
  admin?: AdminAuth;
  adminStaticDir?: string;
  /** Limite de tentatives par minute (Défaut : 3). Définir à 0 pour désactiver (ex : tests). */
  rateLimitMaxAttempts?: number;
}

const INTEREST_RADIUS_PX_DEFAULT = 9000;

export interface GameServerHandle {
  whenReady: Promise<number>;
  close(): void;
}

export function startGameServer(
  roomManager: RoomManager,
  options: GameServerOptions,
): GameServerHandle {
  const interestRadiusPx = options.interestRadiusPx ?? INTEREST_RADIUS_PX_DEFAULT;
  const runtimes = new Map<string, RoomRuntime>();

  const maxAttempts = options.rateLimitMaxAttempts ?? 3;
  const authRateLimiter = new RateLimiter(maxAttempts, 60_000);
  const adminRateLimiter = new RateLimiter(maxAttempts, 60_000);
  const wsRateLimiter = new RateLimiter(maxAttempts, 60_000);
  // Écran de mort personnalisé (cahier des charges fourni) : 10 modifications/minute — un
  // plafond bien plus généreux que l'auth (essayer plusieurs bannières d'affilée est un usage
  // normal, pas une attaque), indépendant de `rateLimitMaxAttempts` pour ne pas se retrouver à 0
  // (donc désactivé) dans les tests qui désactivent l'auth rate-limiting.
  const deathScreenRateLimiter = new RateLimiter(10, 60_000);

  function wireRoom(managed: ManagedRoom): void {
    wireRoomBroadcast(managed, interestRadiusPx, options.accounts, runtimes);
  }

  for (const managed of roomManager.allManagedRooms()) wireRoom(managed);
  roomManager.onRoomCreated(wireRoom);

  roomManager.onRoomRemoved((roomId) => {
    const runtime = runtimes.get(roomId);
    if (runtime) {
      for (const socket of runtime.sockets.values()) {
        socket.close(WS_CLOSE_ROOM_EXPIRED, 'Salon fermé (durée écoulée).');
      }
    }
    runtimes.delete(roomId);
  });

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(
      roomManager,
      options.staticDir,
      options.availableModIds ?? [],
      options.accounts,
      options.admin,
      options.adminStaticDir,
      authRateLimiter,
      adminRateLimiter,
      deathScreenRateLimiter,
      req,
      res,
    );
  });

  const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    handleWsConnection(socket, request, roomManager, runtimes, options.accounts, wsRateLimiter);
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
