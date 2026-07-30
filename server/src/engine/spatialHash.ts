import type { Vector2 } from '@angulio/shared';
import type { Entity, EntityId } from './types.js';

/** Rayon (en multiples de `cellSize`) au-delà duquel une entité est traitée comme "grande" (voir
 * `largeEntities` ci-dessous) plutôt qu'insérée dans la grille — `insert()` d'une entité de rayon
 * `r` coûte O((r/cellSize)²) cellules (voir son commentaire) : au-delà de ce seuil, ce coût
 * dépasse largement celui d'un simple parcours linéaire des quelques grandes entités présentes.
 * 1.5 attrape les Blobs Challenger (3x-50x M0 au spawn — voir `challengerMassMultiplierForRank`,
 * engine/bots/botTypes.ts) tout en restant assez haut pour qu'un joueur/bot de taille
 * "normale" en début/milieu de partie n'y tombe jamais — le budget de cette liste doit rester de
 * l'ordre de quelques entités, jamais des dizaines. */
const LARGE_ENTITY_RADIUS_FACTOR = 1.5;

/**
 * Grille uniforme pour la détection de collision en broad-phase (metriques.md/plan Lot 1.2) :
 * évite de tester chaque entité contre toutes les autres (O(n²)).
 *
 * Les entités "grandes" (voir `LARGE_ENTITY_RADIUS_FACTOR`) ne sont PAS insérées dans la grille :
 * une entité de rayon `r` occupe O((r/cellSize)²) cellules à l'insertion — pour un Blob Challenger
 * de rang 1 (rayon ~223px à cellSize=50), c'est ~80 cellules à CHAQUE tick, un coût mesuré au
 * profilage (voir audit_chaleur.md) qui plus que DOUBLE le coût de `rebuildSpatialHash` dès qu'un
 * premier joueur humain rejoint un salon (les 10 Blobs Challenger spawnent instantanément), pour
 * une "charge" qui semble pourtant légère (un seul joueur).
 *
 * Cette classe reste un simple garde-index, VOLONTAIREMENT sans logique d'appariement : ses
 * méthodes `queryNearby`/`queryRadius` ne renvoient QUE des candidats de la grille (jamais les
 * grandes entités) — c'est à l'appelant (`World.queryNearby`/`World.findOverlappingPairs`) de
 * décider comment les combiner avec `getLargeEntities()`, chacun avec le rayon de recherche qui
 * lui convient (une grande entité a besoin d'un rayon dimensionné sur SA PROPRE taille pour
 * trouver ses voisines, jamais un rayon fixe/petit comme `cellSize` — mélanger les deux logiques
 * ICI avait produit un bug de collision manquée lors du calibrage initial de ce correctif : une
 * grande entité "trouvée" par la requête à petit rayon d'une autre entité, mais son propre
 * chevauchement avec une petite entité EN BORDURE de son grand rayon jamais détecté en retour).
 */
export class SpatialHash {
  private readonly cellSize: number;
  private cells = new Map<number, EntityId[]>();
  private scratchSet = new Set<EntityId>();
  private largeEntities: Entity[] = [];

  constructor(cellSize: number) {
    this.cellSize = cellSize;
  }

  clear(): void {
    this.cells.clear();
    this.largeEntities.length = 0;
  }

  insert(entity: Entity): void {
    if (entity.radius > this.cellSize * LARGE_ENTITY_RADIUS_FACTOR) {
      this.largeEntities.push(entity);
      return;
    }

    const minCx = Math.floor((entity.position.x - entity.radius) / this.cellSize);
    const maxCx = Math.floor((entity.position.x + entity.radius) / this.cellSize);
    const minCy = Math.floor((entity.position.y - entity.radius) / this.cellSize);
    const maxCy = Math.floor((entity.position.y + entity.radius) / this.cellSize);

    for (let cx = minCx; cx <= maxCx; cx++) {
      for (let cy = minCy; cy <= maxCy; cy++) {
        const key = ((cx & 0xffff) << 16) | (cy & 0xffff);
        let bucket = this.cells.get(key);
        if (!bucket) {
          bucket = [];
          this.cells.set(key, bucket);
        }
        bucket.push(entity.id);
      }
    }
  }

  /** Entités au-dessus de `LARGE_ENTITY_RADIUS_FACTOR`, jamais dans la grille (voir le
   * commentaire de la classe) — à apparier explicitement par l'appelant. */
  getLargeEntities(): readonly Entity[] {
    return this.largeEntities;
  }

  /** Rayon maximal qu'une entité DE LA GRILLE peut avoir (voir `LARGE_ENTITY_RADIUS_FACTOR`) —
   * marge à ajouter au rayon de recherche d'un appelant qui interroge la grille EN PARTANT d'une
   * grande entité (voir `World.findOverlappingPairs`), pour ne jamais manquer une petite entité
   * en bordure de son grand rayon. */
  maxGridEntityRadius(): number {
    return this.cellSize * LARGE_ENTITY_RADIUS_FACTOR;
  }

  /** Identifiants des entités DE LA GRILLE (jamais les grandes, voir le commentaire de la
   * classe) dans la cellule de `position` et ses 8 voisines. */
  queryNearby(position: Vector2): EntityId[] {
    return this.queryRadius(position, this.cellSize);
  }

  /** Comme `queryNearby`, mais avec le rayon de recherche élargi de `extraRadius` (la distance
   * parcourue par l'appelant CE tick, voir `World.findTunnelingPairs`, correctif "tunneling") —
   * permet à une entité qui a beaucoup bougé de retrouver un candidat qu'elle aurait pu traverser
   * sans que sa seule position de FIN de tick tombe dans le rayon fixe de `queryNearby`. */
  queryNearbySwept(position: Vector2, extraRadius: number): EntityId[] {
    return this.queryRadius(position, this.cellSize + Math.max(0, extraRadius));
  }

  /** Identifiants des entités DE LA GRILLE (jamais les grandes, voir le commentaire de la
   * classe) dans un rayon donné (en pixels) autour de `position`. */
  queryRadius(position: Vector2, radius: number): EntityId[] {
    const cellRange = Math.ceil(radius / this.cellSize);
    const cx = Math.floor(position.x / this.cellSize);
    const cy = Math.floor(position.y / this.cellSize);
    const result: EntityId[] = [];
    this.scratchSet.clear();

    for (let dx = -cellRange; dx <= cellRange; dx++) {
      for (let dy = -cellRange; dy <= cellRange; dy++) {
        const key = (((cx + dx) & 0xffff) << 16) | ((cy + dy) & 0xffff);
        const bucket = this.cells.get(key);
        if (bucket) {
          for (let i = 0; i < bucket.length; i++) {
            const id = bucket[i]!;
            if (!this.scratchSet.has(id)) {
              this.scratchSet.add(id);
              result.push(id);
            }
          }
        }
      }
    }
    return result;
  }
}
