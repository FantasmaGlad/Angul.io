import type { IncomingMessage, ServerResponse } from 'node:http';
import { getActivityLog } from '../../../admin/activityLog.js';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import { respondJson } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

/** `GET /api/admin/activity` (P5, §7.2/§14.1 plan-implementation-admin.md) — dernières actions
 * admin journalisées (`logAdminEvent`, admin/activityLog.ts), plus récentes en premier. */
export function handleAdminActivity(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  respondJson(res, 200, getActivityLog());
}
