import type { BaseRoomConfig } from '../roomsConfig.js';
import { TWO_HOUR_RESET_SCHEDULE } from './resetSchedule.js';
import type { CreateRoomOptions, ModResolver } from './roomManager.js';

/** Repli historique (server/src/index.ts, avant extraction de ce module) — capacité par défaut
 * d'un salon de base quand ni `BaseRoomConfig.maxPlayers` ni `ParametricModConfig['room']` ne la
 * renseignent. */
const BASE_ROOM_MAX_PLAYERS = 30;

/** Dérive les options de création d'un salon depuis une entrée `BaseRoomConfig` (P6, §8.3/§8.4
 * plan-implementation-admin.md) — logique UNIQUE, partagée entre le peuplement au démarrage
 * (server/src/index.ts) et les routes diff/apply à chaud (adminRooms.ts) : les deux chemins
 * doivent produire EXACTEMENT le même salon pour la même config, sinon un salon recréé à chaud
 * différerait subtilement de son équivalent "au démarrage du process". */
export function resolveBaseRoomCreateOptions(
  base: BaseRoomConfig,
  resolveMod: ModResolver,
): Omit<CreateRoomOptions, 'visibility' | 'permanent'> {
  const { room, mapSize: modMapSize } = resolveMod(base.modId);
  return {
    name: base.name,
    modId: base.modId,
    maxPlayers: base.maxPlayers ?? room?.maxPlayers ?? BASE_ROOM_MAX_PLAYERS,
    mapSize: base.mapSize ?? modMapSize,
    resetSchedule:
      base.resetDurationMin !== undefined
        ? base.resetDurationMin > 0
          ? { type: 'everyNMinutes', minutes: base.resetDurationMin, timeZone: 'Europe/Paris' }
          : undefined
        : (room?.resetSchedule ?? TWO_HOUR_RESET_SCHEDULE),
    baseRoomId: base.id,
  };
}
