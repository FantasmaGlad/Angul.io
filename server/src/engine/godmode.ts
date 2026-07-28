import type { PlayerId } from './types.js';

/** Préfixe des ids de joueur "Blob Dieu" (§4.5 cahier_des_charges_admin.md) — convention légère
 * (comme `bot-*` pour les bots, voir botManager.ts) plutôt qu'un champ dédié sur `PlayerState` :
 * évite de propager un nouveau concept à travers `World`/tous les mods pour une fonctionnalité
 * strictement admin. Un seul Blob Dieu actif par session admin (voir workerRoomHost.ts, qui
 * génère l'id à partir d'un compteur). */
const GOD_PLAYER_ID_PREFIX = 'admin-god-';

export function godPlayerId(sessionSeq: number): PlayerId {
  return `${GOD_PLAYER_ID_PREFIX}${sessionSeq}`;
}

export function isGodPlayerId(playerId: PlayerId | undefined): boolean {
  return playerId !== undefined && playerId.startsWith(GOD_PLAYER_ID_PREFIX);
}
