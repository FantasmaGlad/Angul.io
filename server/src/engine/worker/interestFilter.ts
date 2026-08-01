import type { Vector2 } from '@angulio/shared';
import type { Entity, EntityId, PlayerId } from '../types.js';

/**
 * Filtrage par intérêt réseau (cahier_des_charges_perf_reseau_grande_carte.md §3) — borne QUELLES
 * entités sont envoyées à un joueur donné (celles proches de lui), indépendamment du nombre total
 * d'entités du salon.
 *
 * Volontairement PAS une réutilisation telle quelle de `World.spatialHash` (cellSize=50, voir
 * engine/spatialHash.ts) pour ces requêtes : ce cellSize est dimensionné pour la collision (rayon
 * de recherche de l'ordre de quelques dizaines à centaines de px), alors qu'un rayon d'intérêt
 * peut dépasser 10000px pour un très gros joueur zoomé à `MIN_SCALE` (voir shared/src/camera.ts)
 * — `queryRadius` à ce cellSize y coûterait des centaines de milliers de lookups de cellule PAR
 * JOUEUR PAR TICK (cellRange = ceil(rayon/50), jusqu'à ~270, soit (2×270+1)² ≈ 290 000 lookups),
 * un vrai risque de régression CPU avec ne serait-ce que quelques gros joueurs simultanés. Cet
 * index dédié, cellSize=1000 (même unité que `food.density`, "pastilles par bloc de 1000×1000px",
 * voir mods/parametric/physics.ts `foodTargetCount`), reconstruit une fois par tick à partir des
 * SEULES particules de nourriture (jamais des morceaux, bien moins nombreux et filtrés par simple
 * distance, voir `roomInstance.ts`), ramène ce coût à quelques centaines de lookups même pour le
 * rayon le plus large. Reste néanmoins bon marché à construire (O(nb particules), comparable à ce
 * que `World.rebuildSpatialHash()` paie déjà chaque tick) — pas la structure fine, redondante,
 * dont le coût avait justifié le retrait de l'ancien système d'intérêt (voir §1.2/§3.2 du cahier
 * des charges).
 */
export interface CoarseFoodIndex {
  cellSize: number;
  cells: Map<number, EntityId[]>;
}

const COARSE_FOOD_CELL_SIZE = 1000;

function coarseCellKey(cx: number, cy: number): number {
  return ((cx & 0xffff) << 16) | (cy & 0xffff);
}

export function buildCoarseFoodIndex(
  particles: readonly Entity[],
  cellSize: number = COARSE_FOOD_CELL_SIZE,
): CoarseFoodIndex {
  const cells = new Map<number, EntityId[]>();
  for (const particle of particles) {
    const cx = Math.floor(particle.position.x / cellSize);
    const cy = Math.floor(particle.position.y / cellSize);
    const key = coarseCellKey(cx, cy);
    let bucket = cells.get(key);
    if (!bucket) {
      bucket = [];
      cells.set(key, bucket);
    }
    bucket.push(particle.id);
  }
  return { cellSize, cells };
}

/** Ids de particules dont la CELLULE (pas le cercle exact) tombe dans `radius` autour de
 * `center` — approximation volontaire (une particule jusqu'à `cellSize` px au-delà du rayon
 * demandé peut être incluse) : sans conséquence ici, `radius` inclut déjà une marge de sécurité
 * généreuse (`INTEREST_SAFETY_MARGIN_WORLD_PX`, shared/src/camera.ts), et l'appelant filtre de
 * toute façon par-dessus via `cullEntitiesForViewport` côté client. */
export function queryCoarseFoodIndex(
  index: CoarseFoodIndex,
  center: Vector2,
  radius: number,
): EntityId[] {
  const cellRange = Math.ceil(radius / index.cellSize);
  const cx = Math.floor(center.x / index.cellSize);
  const cy = Math.floor(center.y / index.cellSize);
  const result: EntityId[] = [];

  for (let dx = -cellRange; dx <= cellRange; dx++) {
    for (let dy = -cellRange; dy <= cellRange; dy++) {
      const bucket = index.cells.get(coarseCellKey(cx + dx, cy + dy));
      if (bucket) result.push(...bucket);
    }
  }
  return result;
}

/** Intervalle (en secondes) entre deux resynchronisations complètes de la nourriture pour un même
 * joueur — filet de sécurité peu coûteux qui rattrape toute divergence (perte de paquet, joueur
 * qui a quitté puis retrouvé une zone dense...), voir cahier des charges §3.5. */
export const RESYNC_INTERVAL_SEC = 5;

/** Décalage (en ticks, dans `[0, intervalTicks[`) auquel un joueur donné doit resynchroniser —
 * déterministe par joueur (hash simple de son id) pour ÉTALER les resynchronisations sur
 * l'intervalle plutôt que de les concentrer sur le même tick pour tout le monde (ce qui
 * annulerait le bénéfice du delta une fois toutes les `RESYNC_INTERVAL_SEC` secondes). */
export function resyncOffsetForPlayer(playerId: PlayerId, intervalTicks: number): number {
  if (intervalTicks <= 0) return 0;
  let hash = 0;
  for (let i = 0; i < playerId.length; i++) {
    hash = (hash * 31 + playerId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % intervalTicks;
}

export function isResyncTick(playerId: PlayerId, tick: number, intervalTicks: number): boolean {
  if (intervalTicks <= 0) return true;
  return tick % intervalTicks === resyncOffsetForPlayer(playerId, intervalTicks);
}
