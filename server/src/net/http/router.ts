import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AccountsService } from '../../accounts/service.js';
import type { AdminAuth } from '../../admin/adminAuth.js';
import type { RoomManager } from '../../engine/roomManager.js';
import type { RateLimiter } from '../rateLimiter.js';
import type { RoomRuntime } from '../ws/broadcast.js';
import {
  handleAdminGetPlayer,
  handleAdminLogin,
  handleAdminLogout,
  handleAdminResetBestScore,
  handleAdminSearchPlayers,
  handleAdminUpdatePlayer,
} from './routes/admin.js';
import {
  handleAdminBroadcast,
  handleAdminGetBaseRooms,
  handleAdminKick,
  handleAdminListRooms,
  handleAdminRoomAction,
  handleAdminTransfer,
  handleAdminUpdateBaseRooms,
} from './routes/adminRooms.js';
import {
  handleAdminGetModConfig,
  handleAdminServerReload,
  handleAdminUpdateModConfig,
} from './routes/adminMods.js';
import { handleAdminHealth } from './routes/health.js';
import { handleGetAvatars } from './routes/avatars.js';
import {
  handleClaimScore,
  handleGetProfile,
  handleLogout,
  handleRegisterOrLogin,
  handleUpdateAvatarColor,
  handleUpdateDeathScreen,
} from './routes/auth.js';
import {
  handleCreateRoom,
  handleGetLeaderboard,
  handleGetModes,
  handleGetRooms,
  handleGetStats,
} from './routes/lobby.js';
import { serveStatic } from './staticServer.js';

export async function handleHttpRequest(
  roomManager: RoomManager,
  staticDir: string | undefined,
  availableModIds: string[],
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  adminStaticDir: string | undefined,
  authRateLimiter: RateLimiter,
  adminRateLimiter: RateLimiter,
  deathScreenRateLimiter: RateLimiter,
  runtimes: Map<string, RoomRuntime>,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');
  // `URL.pathname` (API WHATWG) garde le chemin PERCENT-ENCODÉ tel quel (`%20`, `%C3%89`...) — ce
  // n'est PAS déjà décodé, contrairement à ce qu'on pourrait attendre. Un chemin de fichier statique
  // contenant un espace/caractère accentué (ex. un skin d'avatar, `assets/Profil/Samouraï.png`)
  // ne correspondait donc jamais au vrai nom de fichier sur disque (`stat()`/comparaison insensible
  // à la casse de `serveStatic` comparés à un `%20` littéral) — retour utilisateur : 404 sur un
  // skin dont le nom de fichier contient un espace. Repli sur le chemin brut si le décodage échoue
  // (séquence `%` malformée) plutôt que de planter toute la requête.
  const decodedPathname = ((): string => {
    try {
      return decodeURIComponent(url.pathname);
    } catch {
      return url.pathname;
    }
  })();

  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    handleGetRooms(roomManager, res);
    return;
  }

  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    await handleCreateRoom(roomManager, accounts, req, res);
    return;
  }

  if (url.pathname === '/api/modes' && req.method === 'GET') {
    handleGetModes(availableModIds, res);
    return;
  }

  if (url.pathname === '/api/stats' && req.method === 'GET') {
    handleGetStats(roomManager, res);
    return;
  }

  if (url.pathname === '/api/leaderboard' && req.method === 'GET') {
    await handleGetLeaderboard(accounts, url, res);
    return;
  }

  if (url.pathname === '/api/avatars' && req.method === 'GET') {
    await handleGetAvatars(staticDir ?? '', res);
    return;
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    await handleRegisterOrLogin(accounts, authRateLimiter, 'register', req, res);
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    await handleRegisterOrLogin(accounts, authRateLimiter, 'login', req, res);
    return;
  }

  if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
    handleLogout(accounts, req, res);
    return;
  }

  if (url.pathname === '/api/account/me' && req.method === 'GET') {
    await handleGetProfile(accounts, req, res);
    return;
  }

  if (url.pathname === '/api/account/me' && req.method === 'PATCH') {
    await handleUpdateAvatarColor(accounts, req, res);
    return;
  }

  if (url.pathname === '/api/account/death-screen' && req.method === 'PATCH') {
    await handleUpdateDeathScreen(accounts, deathScreenRateLimiter, req, res);
    return;
  }

  if (url.pathname === '/api/account/claim-score' && req.method === 'POST') {
    await handleClaimScore(accounts, req, res);
    return;
  }

  // --- Interface admin ---

  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    await handleAdminLogin(admin, adminRateLimiter, req, res);
    return;
  }

  if (url.pathname === '/api/admin/logout' && req.method === 'POST') {
    handleAdminLogout(admin, req, res);
    return;
  }

  if (url.pathname === '/api/admin/players' && req.method === 'GET') {
    await handleAdminSearchPlayers(accounts, admin, url, req, res);
    return;
  }

  if (url.pathname === '/api/admin/health' && req.method === 'GET') {
    handleAdminHealth(roomManager, admin, req, res);
    return;
  }

  const adminPlayerMatch = /^\/api\/admin\/players\/(\d+)$/.exec(url.pathname);
  if (adminPlayerMatch && req.method === 'GET') {
    await handleAdminGetPlayer(accounts, admin, Number(adminPlayerMatch[1]), req, res);
    return;
  }
  if (adminPlayerMatch && req.method === 'PATCH') {
    await handleAdminUpdatePlayer(accounts, admin, Number(adminPlayerMatch[1]), req, res);
    return;
  }

  const adminResetBestScoreMatch = /^\/api\/admin\/players\/(\d+)\/reset-best-score$/.exec(
    url.pathname,
  );
  if (adminResetBestScoreMatch && req.method === 'POST') {
    await handleAdminResetBestScore(accounts, admin, Number(adminResetBestScoreMatch[1]), req, res);
    return;
  }

  if (url.pathname === '/api/admin/rooms' && req.method === 'GET') {
    await handleAdminListRooms(roomManager, runtimes, admin, req, res);
    return;
  }

  if (url.pathname === '/api/admin/base-rooms' && req.method === 'GET') {
    handleAdminGetBaseRooms(admin, req, res);
    return;
  }
  if (url.pathname === '/api/admin/base-rooms' && req.method === 'PUT') {
    await handleAdminUpdateBaseRooms(admin, availableModIds, req, res);
    return;
  }

  if (url.pathname === '/api/admin/broadcast' && req.method === 'POST') {
    await handleAdminBroadcast(runtimes, admin, req, res);
    return;
  }

  if (url.pathname === '/api/admin/server/reload' && req.method === 'POST') {
    handleAdminServerReload(roomManager, admin, req, res);
    return;
  }

  const adminModMatch = /^\/api\/admin\/mods\/([^/]+)$/.exec(url.pathname);
  if (adminModMatch && req.method === 'GET') {
    handleAdminGetModConfig(admin, decodeURIComponent(adminModMatch[1]!), req, res);
    return;
  }
  if (adminModMatch && req.method === 'PUT') {
    await handleAdminUpdateModConfig(admin, availableModIds, decodeURIComponent(adminModMatch[1]!), req, res);
    return;
  }

  const adminRoomActionMatch = /^\/api\/admin\/rooms\/([^/]+)\/action$/.exec(url.pathname);
  if (adminRoomActionMatch && req.method === 'POST') {
    await handleAdminRoomAction(roomManager, admin, decodeURIComponent(adminRoomActionMatch[1]!), req, res);
    return;
  }

  const adminKickMatch = /^\/api\/admin\/rooms\/([^/]+)\/kick$/.exec(url.pathname);
  if (adminKickMatch && req.method === 'POST') {
    await handleAdminKick(runtimes, admin, decodeURIComponent(adminKickMatch[1]!), req, res);
    return;
  }

  const adminTransferMatch = /^\/api\/admin\/rooms\/([^/]+)\/transfer$/.exec(url.pathname);
  if (adminTransferMatch && req.method === 'POST') {
    await handleAdminTransfer(
      roomManager,
      runtimes,
      admin,
      decodeURIComponent(adminTransferMatch[1]!),
      req,
      res,
    );
    return;
  }

  if (adminStaticDir && (decodedPathname === '/admin' || decodedPathname.startsWith('/admin/'))) {
    const stripped = decodedPathname.slice('/admin'.length);
    await serveStatic(
      adminStaticDir,
      stripped === '' || stripped === '/' ? '/index.html' : stripped,
      res,
    );
    return;
  }

  await serveStatic(staticDir, decodedPathname === '/' ? '/index.html' : decodedPathname, res);
}
