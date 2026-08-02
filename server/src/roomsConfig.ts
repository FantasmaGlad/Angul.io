import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `server/rooms.json`, résolu relativement à ce fichier compilé (server/dist/roomsConfig.js)
 * plutôt qu'au cwd du process — même principe que `mods/parametric/loadConfig.ts`. Volontairement
 * SÉPARÉ de `server/configs/` (réservé aux configs de MOD paramétriques, énumérées telles quelles
 * par `listAvailableModIds()`) : un fichier de plus dans ce dossier serait interprété à tort comme
 * un mod supplémentaire. */
const ROOMS_CONFIG_PATH = fileURLToPath(new URL('../rooms.json', import.meta.url));
const LOCAL_ROOMS_CONFIG_PATH = fileURLToPath(new URL('../rooms.local.json', import.meta.url));

/** Un salon permanent de l'accueil (§8.4/§13 cahier_des_charges_admin.md) — capacité/taille/bots
 * restent définis par la config du mod lui-même (`server/configs/<modId>.json`), pas dupliqués
 * ici : ce fichier ne décide QUE de la liste des salons qui existent par défaut et du mode
 * attribué à chacun. `id` (P6, §8.1 plan-implementation-admin.md) : identifiant stable, généré
 * une fois et jamais réattribué — remplace l'ancien appariement fragile par nom (voir
 * `roomManager.ts` `baseRoomId`/`findByBaseRoomId`, utilisé par les routes diff/apply). */
export interface BaseRoomConfig {
  id: string;
  name: string;
  modId: string;
  mapSize?: number;
  maxPlayers?: number;
  resetDurationMin?: number;
}

export function loadBaseRoomsConfig(): BaseRoomConfig[] {
  let raw: string;
  try {
    raw = readFileSync(LOCAL_ROOMS_CONFIG_PATH, 'utf-8');
  } catch {
    try {
      raw = readFileSync(ROOMS_CONFIG_PATH, 'utf-8');
    } catch {
      throw new Error(`Configuration des salons de base introuvable (attendue à ${ROOMS_CONFIG_PATH})`);
    }
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('Le fichier de salons doit contenir un tableau de { name, modId }.');
  }

  // Migration silencieuse (§8.1) : un fichier existant écrit avant l'introduction de `id` (ou une
  // entrée ajoutée à la main) reçoit un id fraîchement généré, persisté IMMÉDIATEMENT — jamais
  // recalculé à une lecture suivante, sinon l'appariement (`baseRoomId`) redeviendrait aussi
  // fragile que l'ancien appariement par nom qu'il remplace.
  let migrated = false;
  const rooms: BaseRoomConfig[] = (parsed as Array<Partial<BaseRoomConfig>>).map((room) => {
    if (room.id) return room as BaseRoomConfig;
    migrated = true;
    return { ...room, id: randomUUID() } as BaseRoomConfig;
  });
  if (migrated) saveBaseRoomsConfig(rooms);
  return rooms;
}

/** Écrit `server/rooms.local.json` (et `server/rooms.json` en secours) — utilisé par la route admin
 * `PUT /api/admin/base-rooms`. Permet de conserver les modifications locales des salons de l'accueil
 * sans qu'elles ne soient écrasées par git. */
export function saveBaseRoomsConfig(rooms: BaseRoomConfig[]): void {
  const content = `${JSON.stringify(rooms, null, 2)}\n`;
  writeFileSync(LOCAL_ROOMS_CONFIG_PATH, content, 'utf-8');
  try {
    writeFileSync(ROOMS_CONFIG_PATH, content, 'utf-8');
  } catch {
    // Fichier principal optionnel si restreint
  }
}
