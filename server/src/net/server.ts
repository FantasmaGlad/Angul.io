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
  /** Limite de NOUVELLES connexions WebSocket de jeu par minute et par IP — voir
   * `WS_RATE_LIMIT_DEFAULT_MAX_ATTEMPTS` ci-dessous pour pourquoi ce plafond doit être
   * indépendant de `rateLimitMaxAttempts` (celui-ci reste dimensionné pour l'auth : 3
   * tentatives/minute contre le brute-force de mot de passe). Repli sur `rateLimitMaxAttempts`
   * SEULEMENT si celui-ci a été explicitement fourni par l'appelant (permet à `0` de continuer à
   * tout désactiver d'un coup, comme les tests de server.test.ts en dépendent), sinon sur son
   * propre défaut généreux. */
  wsRateLimitMaxAttempts?: number;
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

/** Défaut de `wsRateLimitMaxAttempts` quand ni lui ni `rateLimitMaxAttempts` ne sont fournis —
 * c'est-à-dire en PRODUCTION réelle (server/src/index.ts ne surcharge ni l'un ni l'autre). Avant
 * ce correctif, le canal WebSocket de jeu héritait silencieusement du défaut de l'auth (3/min,
 * voir `maxAttempts` ci-dessous) : bien trop bas pour une reconnexion de jeu légitime — une
 * simple coupure réseau (Wi-Fi, onglet mis en veille) déclenche une rafale de tentatives de
 * reconnexion automatique (voir `RECONNECT_DELAYS_MS`, client/src/net.ts), et plusieurs joueurs
 * derrière la même IP (NAT familial/scolaire/bureau) partagent le même compteur. Une fois ces 3
 * tentatives consommées, TOUTE nouvelle connexion (y compris un simple respawn) était rejetée
 * jusqu'à ce que la fenêtre d'une minute s'écoule — perçu comme un écran figé/blanc en
 * "reconnexion en cours…" qui ne se résorbe jamais tout seul (retour utilisateur, reproduit en
 * session : after ~3 (re)connexions rapprochées, `ws_rate_limited` en boucle pendant ~60s).
 * 30/minute reste un plafond réel contre un flood de connexions (DoS), tout en couvrant
 * confortablement l'usage légitime le plus chargé (plusieurs onglets/joueurs + reconnexions). */
const WS_RATE_LIMIT_DEFAULT_MAX_ATTEMPTS = 30;

export function startGameServer(
  roomManager: RoomManager,
  options: GameServerOptions,
): GameServerHandle {
  startMetrics();

  const buildVersion = options.buildVersion ?? String(Date.now());
  const runtimes = new Map<string, RoomRuntime>();

  const maxAttempts = options.rateLimitMaxAttempts ?? 3;
  const wsMaxAttempts =
    options.wsRateLimitMaxAttempts ??
    options.rateLimitMaxAttempts ??
    WS_RATE_LIMIT_DEFAULT_MAX_ATTEMPTS;
  const authRateLimiter = new RateLimiter(maxAttempts, 60_000);
  const adminRateLimiter = new RateLimiter(maxAttempts, 60_000);
  const wsRateLimiter = new RateLimiter(wsMaxAttempts, 60_000);
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
