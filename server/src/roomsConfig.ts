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
 * attribué à chacun. */
export interface BaseRoomConfig {
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
  return parsed as BaseRoomConfig[];
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
