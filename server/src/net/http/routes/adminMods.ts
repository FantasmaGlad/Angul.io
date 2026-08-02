import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AdminAuth } from '../../../admin/adminAuth.js';
import { logAdminEvent } from '../../../admin/activityLog.js';
import {
  listAvailableBotBehaviorIds,
  loadBotBehaviorConfig,
  saveBotBehaviorConfig,
} from '../../../engine/bots/loadBehaviorConfig.js';
import { validateBotBehaviorConfig } from '../../../engine/bots/validateBehaviorConfig.js';
import { loadModConfig, saveModConfig } from '../../../mods/parametric/loadConfig.js';
import { validateParametricModConfig } from '../../../mods/parametric/validateConfig.js';
import { readJsonBody, respondJson } from '../httpUtils.js';
import { requireAdmin } from './admin.js';

/** Sélecteur de profil de comportement des vagues de bots (§10.3 cahier_des_charges_admin.md,
 * `spawnBots{behaviorProfile}`) — `listAvailableBotBehaviorIds()` existait déjà côté moteur
 * (`server/configs/bots/*.json`) mais n'était jamais exposée à l'admin, voir §1
 * plan-implementation-admin.md. Lecture seule, aucune info sensible (mêmes fichiers que
 * `/api/modes`). */
export function handleAdminListBotBehaviors(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  respondJson(res, 200, listAvailableBotBehaviorIds());
}

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

/** `PUT /api/admin/mods/:id` (A8, §13.2 cahier_des_charges_admin.md) — validation COMPLÈTE via
 * `validateParametricModConfig` AVANT écriture disque (§2.4 plan-implementation-admin.md) : un
 * JSON syntaxiquement correct mais sémantiquement faux (champ manquant, mauvais type, enum
 * invalide) est refusé avec `{errors: [{path, message}]}`, jamais écrit tel quel. */
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

  const validated = validateParametricModConfig(body);
  if (!validated.ok) {
    respondJson(res, 400, { error: 'Configuration de mod invalide.', errors: validated.errors });
    return;
  }

  try {
    saveModConfig(modId, validated.value);
    logAdminEvent('admin_mod_updated', { modId });
    respondJson(res, 200, {
      success: true,
      modId,
      note: "Mod sauvegardé. Les salons déjà lancés sur ce mode ne relisent la config qu'à leur prochain changement de mode ou reset (voir l'onglet Salons, ou « Appliquer les changements » dans Configuration pour un salon d'accueil).",
    });
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}

/** `GET /api/admin/bot-behaviors/:id` (P6, §8.7) — contenu JSON complet d'un profil (voir
 * `handleAdminListBotBehaviors` pour la simple liste d'ids). 404 si le fichier n'existe pas ; NE
 * PAS confondre avec le repli silencieux de `loadBotBehaviorConfig` (utilisé pendant une partie,
 * jamais approprié pour un éditeur — un admin qui ouvre un id inexistant doit le savoir). */
export function handleAdminGetBotBehavior(
  admin: AdminAuth | undefined,
  behaviorId: string,
  availableBehaviorIds: string[],
  req: IncomingMessage,
  res: ServerResponse,
): void {
  if (!requireAdmin(admin, req, res)) return;
  if (!availableBehaviorIds.includes(behaviorId)) {
    respondJson(res, 404, { error: `Profil de comportement "${behaviorId}" introuvable.` });
    return;
  }
  respondJson(res, 200, loadBotBehaviorConfig(behaviorId));
}

/** `PUT /api/admin/bot-behaviors/:id` (P6, §8.7) — mêmes garanties que `handleAdminUpdateModConfig`
 * (validation avant écriture), via `validateBotBehaviorConfig` (structurelle, voir son
 * commentaire). Accepte un id encore inexistant (nouveau profil) : contrairement aux mods (liste
 * fermée `availableModIds`, un dossier fixe), un admin peut vouloir créer un profil de bots
 * inédit directement depuis l'éditeur JSON. */
export async function handleAdminUpdateBotBehavior(
  admin: AdminAuth | undefined,
  behaviorId: string,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const validated = validateBotBehaviorConfig(body);
  if (!validated.ok) {
    respondJson(res, 400, { error: 'Profil de comportement invalide.', errors: validated.errors });
    return;
  }

  try {
    saveBotBehaviorConfig(behaviorId, validated.value);
    logAdminEvent('admin_bot_behavior_updated', { behaviorId });
    respondJson(res, 200, { success: true, behaviorId });
  } catch (error) {
    respondJson(res, 500, { error: (error as Error).message });
  }
}
