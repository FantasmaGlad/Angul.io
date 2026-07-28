import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import type { RoomManager } from '../../../engine/roomManager.js';
import { buildHealthSnapshot } from '../../metrics.js';
import { respondJson } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

/** `GET /api/admin/health` — réservé à l'interface admin existante (même garde que
 * `/api/admin/players`) : ces métriques (délai de l'event loop, charge par salon) ne doivent pas
 * être exposées publiquement, elles pourraient renseigner un attaquant sur le moment idéal pour
 * saturer le serveur. */
export function handleAdminHealth(
  roomManager: RoomManager,
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  respondJson(res, 200, buildHealthSnapshot(roomManager));
}
