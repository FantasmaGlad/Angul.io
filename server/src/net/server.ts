import { createServer, type IncomingMessage } from 'node:http';
import { WS_CLOSE_ROOM_EXPIRED } from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import type { AccountsService } from '../accounts/service.js';
import type { AdminAuth } from '../admin/adminAuth.js';
import type { ManagedRoom, RoomManager } from '../engine/roomManager.js';
import { handleHttpRequest } from './http/router.js';
import { startMetrics } from './metrics.js';
import { RateLimiter } from './rateLimiter.js';
import { wireRoom as wireRoomBroadcast, type RoomRuntime } from './ws/broadcast.js';
import { handleWsConnection } from './ws/connectionHandler.js';

export interface GameServerOptions {
  port: number;
  staticDir?: string;
  availableModIds?: string[];
  accounts?: AccountsService;
  admin?: AdminAuth;
  adminStaticDir?: string;
  /** Limite de tentatives par minute (Défaut : 3). Définir à 0 pour désactiver (ex : tests). */
  rateLimitMaxAttempts?: number;
  /** Délai de grâce (ms) avant qu'une déconnexion ne devienne définitive (voir
   * connectionHandler.ts `DEFAULT_GRACE_PERIOD_MS`, correctif "déconnexion = perte immédiate de
   * l'XP en cours") — surchargeable pour les tests (délai court plutôt que d'attendre 8s dans une
   * suite vitest). Défaut : 8000ms. */
  disconnectGraceMs?: number;
  /** Identifiant de build transmis dans chaque `welcome` (voir protocol.ts) — un client qui
   * reçoit une valeur différente de celle de son `welcome` précédent sait qu'il a reconnecté vers
   * un nouveau déploiement (nouveau process serveur) et se recharge automatiquement (voir
   * GameView.tsx). Repli sur `Date.now()` au démarrage de CE process si absent (jamais recalculé
   * ensuite) : suffisant en pratique, un déploiement redémarrant toujours le process. */
  buildVersion?: string;
}

export interface GameServerHandle {
  whenReady: Promise<number>;
  close(): void;
}

export function startGameServer(
  roomManager: RoomManager,
  options: GameServerOptions,
): GameServerHandle {
  startMetrics();

  const buildVersion = options.buildVersion ?? String(Date.now());
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
    wireRoomBroadcast(managed, options.accounts, runtimes);
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
      runtimes,
      req,
      res,
    );
  });

  const wss = new WebSocketServer({
    server: httpServer,
    perMessageDeflate: {
      zlibDeflateOptions: {
        chunkSize: 1024,
        memLevel: 7,
        level: 3,
      },
      zlibInflateOptions: {
        chunkSize: 10 * 1024,
      },
      clientNoContextTakeover: true,
      serverNoContextTakeover: true,
      threshold: 1024,
    },
  });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    handleWsConnection(
      socket,
      request,
      roomManager,
      runtimes,
      options.accounts,
      wsRateLimiter,
      options.admin,
      buildVersion,
      options.disconnectGraceMs,
    );
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
