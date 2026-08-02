/** Grille de secteurs 3×3 (A1-C3) — extraite de `client/src/components/Minimap.tsx` (P2, décision
 * plan-implementation-admin.md §2.2) pour devenir la référence mutualisée entre la minimap joueur
 * et la future minimap du studio admin. Distincte de la grille 10×10 (A-J/1-10) de
 * `client/src/debugOverlay.ts` (`calculateGridSector`, overlay de debug F3) — un outil différent,
 * non touché ici. */

const ROW_LETTERS = ['A', 'B', 'C'];

/** `x`/`y` doivent déjà être bornés à `[0, mapSize]` par l'appelant (voir `Minimap.tsx`, qui les
 * clamp pour son propre positionnement du point avant d'en dériver aussi le secteur). */
export function sectorForPosition(x: number, y: number, mapSize: number): string {
  const colIdx = Math.min(2, Math.floor((x / mapSize) * 3));
  const rowIdx = Math.min(2, Math.floor((y / mapSize) * 3));
  return `${ROW_LETTERS[rowIdx]}${colIdx + 1}`;
}
