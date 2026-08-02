import type { BaseRoomConfig } from './roomsConfig.js';

export type RoomDiffStatus = 'created' | 'closed' | 'hot-reconfigured' | 'recreated' | 'unchanged';

export interface RoomDiffEntry {
  /** Id proposé — vide (`''`) pour une entrée `created` sans id (nouvelle ligne ajoutée côté UI,
   * pas encore sauvegardée) : `apply` en génère un frais à ce moment-là, pas ici. */
  id: string;
  name: string;
  status: RoomDiffStatus;
}

/** Compare la config PRÉCÉDEMMENT sauvegardée à la config PROPOSÉE (P6, §8.4
 * plan-implementation-admin.md) — diff PAR ID STABLE (§8.1), jamais par nom (fragile, voir
 * l'ex-`handleAdminServerReload`) ni par état vivant du salon : une entrée proposée SANS id est
 * TOUJOURS `created`. `mapSize`/`maxPlayers` différents => `recreated` (fermeture + recréation,
 * expulse les joueurs connectés) ; `modId`/`resetDurationMin` différents SANS changement
 * structurel => `hot-reconfigured` (switchMod+reset, ou reprogrammation du reset, jamais
 * d'expulsion) ; une entrée précédente absente des proposées => `closed`. Pure : ne touche ni au
 * disque ni à `RoomManager` (testable en isolation, voir roomsDiff.test.ts) — l'enrichissement
 * avec le nombre de joueurs réellement affectés se fait dans la route (adminRooms.ts), seule à
 * avoir accès à `RoomManager`. */
export function diffBaseRooms(previous: BaseRoomConfig[], proposed: BaseRoomConfig[]): RoomDiffEntry[] {
  const previousById = new Map(previous.map((room) => [room.id, room]));
  const proposedIds = new Set(proposed.filter((room) => room.id).map((room) => room.id));
  const entries: RoomDiffEntry[] = [];

  for (const next of proposed) {
    const prev = next.id ? previousById.get(next.id) : undefined;
    if (!prev) {
      entries.push({ id: next.id ?? '', name: next.name, status: 'created' });
      continue;
    }
    const structuralChange = prev.mapSize !== next.mapSize || prev.maxPlayers !== next.maxPlayers;
    const softChange = prev.modId !== next.modId || prev.resetDurationMin !== next.resetDurationMin;
    if (structuralChange) {
      entries.push({ id: next.id, name: next.name, status: 'recreated' });
    } else if (softChange) {
      entries.push({ id: next.id, name: next.name, status: 'hot-reconfigured' });
    } else {
      entries.push({ id: next.id, name: next.name, status: 'unchanged' });
    }
  }

  for (const prev of previous) {
    if (proposedIds.has(prev.id)) continue;
    entries.push({ id: prev.id, name: prev.name, status: 'closed' });
  }

  return entries;
}

const MIN_MAP_SIZE = 1000;
const MAX_MAP_SIZE = 50_000;
const MIN_MAX_PLAYERS = 1;
const MAX_MAX_PLAYERS = 200;

export type ValidatedBaseRooms =
  | { ok: true; value: BaseRoomConfig[] }
  | { ok: false; errors: string[] };

/** Validation serveur complète (A10 cahier_des_charges_admin.md) pour les routes diff/apply —
 * plus stricte que l'ancienne `isValidBaseRoomsPayload` (adminRooms.ts, `PUT` seul, qui n'exigeait
 * que name/modId) : `mapSize`/`maxPlayers`/`resetDurationMin` sont désormais bornés explicitement,
 * jamais laissés `undefined` à la merci d'un repli implicite côté moteur. */
export function validateBaseRoomsPayload(rooms: unknown, availableModIds: string[]): ValidatedBaseRooms {
  if (!Array.isArray(rooms) || rooms.length === 0) {
    return { ok: false, errors: ['Au moins un salon est requis.'] };
  }

  const errors: string[] = [];
  const value: BaseRoomConfig[] = [];

  rooms.forEach((entry, index) => {
    if (typeof entry !== 'object' || entry === null) {
      errors.push(`Salon #${index + 1} : entrée invalide.`);
      return;
    }
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === 'string' ? record.name.trim() : '';
    const label = name || `#${index + 1}`;
    if (!name) errors.push(`Salon ${label} : nom requis.`);

    const modId = typeof record.modId === 'string' ? record.modId : '';
    if (!availableModIds.includes(modId)) {
      errors.push(`Salon ${label} : mode "${modId || '?'}" inconnu.`);
    }

    const mapSize = Number(record.mapSize);
    if (!Number.isFinite(mapSize) || mapSize < MIN_MAP_SIZE || mapSize > MAX_MAP_SIZE) {
      errors.push(`Salon ${label} : taille de carte hors bornes [${MIN_MAP_SIZE}, ${MAX_MAP_SIZE}].`);
    }

    const maxPlayers = Number(record.maxPlayers);
    if (!Number.isFinite(maxPlayers) || maxPlayers < MIN_MAX_PLAYERS || maxPlayers > MAX_MAX_PLAYERS) {
      errors.push(`Salon ${label} : joueurs max hors bornes [${MIN_MAX_PLAYERS}, ${MAX_MAX_PLAYERS}].`);
    }

    const resetDurationMin = Number(record.resetDurationMin);
    if (!Number.isFinite(resetDurationMin) || resetDurationMin < 0) {
      errors.push(`Salon ${label} : durée de reset invalide (>= 0 attendu, 0 = désactivé).`);
    }

    const id = typeof record.id === 'string' && record.id ? record.id : undefined;
    value.push({ id: id ?? '', name, modId, mapSize, maxPlayers, resetDurationMin });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value };
}
