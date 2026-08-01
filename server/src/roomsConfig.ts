import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** `server/rooms.json`, résolu relativement à ce fichier compilé (server/dist/roomsConfig.js)
 * plutôt qu'au cwd du process — même principe que `mods/parametric/loadConfig.ts`. Volontairement
 * SÉPARÉ de `server/configs/` (réservé aux configs de MOD paramétriques, énumérées telles quelles
 * par `listAvailableModIds()`) : un fichier de plus dans ce dossier serait interprété à tort comme
 * un mod supplémentaire. */
const ROOMS_CONFIG_PATH = fileURLToPath(new URL('../rooms.json', import.meta.url));

/** Un salon permanent de l'accueil (§8.4/§13 cahier_des_charges_admin.md) — capacité/taille/bots
 * restent définis par la config du mod lui-même (`server/configs/<modId>.json`), pas dupliqués
 * ici : ce fichier ne décide QUE de la liste des salons qui existent par défaut et du mode
 * attribué à chacun. */
export interface BaseRoomConfig {
  name: string;
  modId: string;
}

export function loadBaseRoomsConfig(): BaseRoomConfig[] {
  let raw: string;
  try {
    raw = readFileSync(ROOMS_CONFIG_PATH, 'utf-8');
  } catch {
    throw new Error(`Configuration des salons de base introuvable (attendue à ${ROOMS_CONFIG_PATH})`);
  }
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) {
    throw new Error('server/rooms.json doit contenir un tableau de { name, modId }.');
  }
  return parsed as BaseRoomConfig[];
}

/** Écrit `server/rooms.json` (utilisé par la route admin `PUT /api/admin/base-rooms`, §13) — les
 * salons déjà démarrés ne sont PAS recréés à la volée (`RoomManager` ne sait pas fermer un salon
 * permanent existant, voir cahier des charges §8.4, pas encore implémenté) : un changement ne
 * s'applique qu'au prochain redémarrage du serveur, cohérent avec le reste du modèle de
 * déploiement de ce dépôt (voir .claude/launch.json, `deploySteps`, un redémarrage fait déjà
 * partie de chaque déploiement). */
export function saveBaseRoomsConfig(rooms: BaseRoomConfig[]): void {
  writeFileSync(ROOMS_CONFIG_PATH, `${JSON.stringify(rooms, null, 2)}\n`, 'utf-8');
}
