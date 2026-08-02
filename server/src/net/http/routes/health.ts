import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import type { RoomManager } from '../../../engine/roomManager.js';
import { buildHealthSnapshot } from '../../metrics.js';
import { getHealthHistory } from '../../metrics/healthHistory.js';
import { respondJson } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

/** `GET /api/admin/health` — réservé à l'interface admin existante (même garde que
 * `/api/admin/players`) : ces métriques (délai de l'event loop, charge par salon) ne doivent pas
 * être exposées publiquement, elles pourraient renseigner un attaquant sur le moment idéal pour
 * saturer le serveur. */
export async function handleAdminHealth(
  roomManager: RoomManager,
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  respondJson(res, 200, await buildHealthSnapshot(roomManager));
}

/** Bornes larges plutôt qu'une liste stricte (1/6/24) — un client qui demande une période
 * inhabituelle reçoit un résultat cohérent (fenêtre bornée entre 5 minutes et les 24h réellement
 * conservées par le buffer, voir healthHistory.ts) plutôt qu'une erreur 400 pour un simple
 * paramètre d'affichage. */
const MIN_HISTORY_HOURS = 5 / 60;
const MAX_HISTORY_HOURS = 24;

/** `GET /api/admin/health/history?hours=1|6|24` (P5, §7.1) — découpe du buffer en mémoire de
 * `healthHistory.ts`, alimenté indépendamment de cette requête (voir `startHealthHistory`,
 * server/src/index.ts). */
export function handleAdminHealthHistory(
  admin: AdminAuth | undefined,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  const hoursParam = Number(url.searchParams.get('hours'));
  const hours = Number.isFinite(hoursParam)
    ? Math.min(MAX_HISTORY_HOURS, Math.max(MIN_HISTORY_HOURS, hoursParam))
    : MAX_HISTORY_HOURS;
  const sinceMs = Date.now() - hours * 60 * 60_000;
  respondJson(res, 200, getHealthHistory(sinceMs));
}
