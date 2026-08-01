import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import type { RoomManager } from '../../../engine/roomManager.js';
import { loadModConfig, saveModConfig } from '../../../mods/parametric/loadConfig.js';
import type { ParametricModConfig } from '../../../mods/parametric/config.js';
import { logEvent } from '../../../log.js';
import { loadBaseRoomsConfig } from '../../../roomsConfig.js';
import { readJsonBody, respondJson, isRecord } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

export function handleAdminGetModConfig(
  admin: AdminAuth | undefined,
  modId: string,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;

  try {
    const config = loadModConfig(modId);
    respondJson(res, 200, config);
  } catch (error) {
    respondJson(res, 404, { error: (error as Error).message });
  }
}

export async function handleAdminUpdateModConfig(
  admin: AdminAuth | undefined,
  availableModIds: string[],
  modId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  if (!availableModIds.includes(modId)) {
    respondJson(res, 400, { error: `Mod "${modId}" non reconnu.` });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  if (!isRecord(body)) {
    respondJson(res, 400, { error: 'Payload de configuration invalide.' });
    return;
  }

  try {
    saveModConfig(modId, body as unknown as ParametricModConfig);
    logEvent('admin_mod_updated', { modId });
    respondJson(res, 200, {
      success: true,
      modId,
      note: 'Mod sauvegardé. Cliquez sur Synchroniser pour appliquer aux salons.',
    });
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}

export function handleAdminServerReload(
  roomManager: RoomManager,
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;

  try {
    const baseRooms = loadBaseRoomsConfig();
    const managedRooms = roomManager.allManagedRooms();

    // Réinitialise / bascule chaque salon permanent existant avec sa nouvelle config
    for (const base of baseRooms) {
      const existing = managedRooms.find((r) => r.name === base.name || r.id === base.name);
      if (existing) {
        void existing.handle.adminAction({ kind: 'switchMod', modId: base.modId });
        void existing.handle.adminAction({ kind: 'reset' });
      }
    }

    logEvent('admin_server_reloaded', { baseRoomsCount: baseRooms.length });
    respondJson(res, 200, {
      success: true,
      message: 'Modifications synchronisées ! Les salons ont été rechargés et réinitialisés.',
    });
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}
