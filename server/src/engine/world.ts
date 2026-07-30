import { distance, massToRadius, type Vector2 } from '@angulio/shared';
import { SpatialHash } from './spatialHash.js';
import type { Entity, EntityId, EntityKind, PlayerId, PlayerState } from './types.js';
import { createLifeStats } from './xp.js';

export interface WorldOptions {
  mapSize: number;
  /** Constante de conversion masse -> aire, voir metriques.md §2. Défaut : π (Rayon = √masse). */
  kArea?: number;
  /** Taille de cellule de la grille spatiale (Lot 1.2). Défaut : 50 (quelques rayons de départ). */
  spatialCellSize?: number;
}

/**
 * État générique d'une room : entités + joueurs + index spatial. Ne contient aucune règle de
 * jeu (pas de masse de départ, pas de decay, pas de condition de manger) — tout ça vit dans le
 * mod chargé (voir mods/vanilla), conformément à l'architecture de hooks (plan Lot 1.5).
 */
export class World {
  readonly mapSize: number;
  private readonly kArea: number;
  private readonly entities = new Map<EntityId, Entity>();
  private readonly players = new Map<PlayerId, PlayerState>();
  readonly spatialHash: SpatialHash;

  /** Compteur d'ids courts plutôt que des UUID — mesuré au Lot 1.8 : la taille des ids sur le
   * réseau compte beaucoup à 20 Hz avec des centaines d'entités. */
  private nextEntityId = 1;

  constructor(options: WorldOptions) {
    this.mapSize = options.mapSize;
    this.kArea = options.kArea ?? 3;
    this.spatialHash = new SpatialHash(options.spatialCellSize ?? 50);
  }

  // --- Entités ---------------------------------------------------------

  spawnParticle(position: Vector2, mass: number): Entity {
    return this.spawnEntity('particle', position, mass);
  }

  spawnPiece(ownerId: PlayerId, position: Vector2, mass: number, velocity?: Vector2): Entity {
    const entity = this.spawnEntity('piece', position, mass, velocity);
    entity.ownerId = ownerId;
    const player = this.players.get(ownerId);
    if (player) player.pieceIds.push(entity.id);
    return entity;
  }

  private spawnEntity(
    kind: EntityKind,
    position: Vector2,
    mass: number,
    velocity?: Vector2,
  ): Entity {
    const entity: Entity = {
      id: String(this.nextEntityId++),
      kind,
      position: { ...position },
      velocity: velocity ? { ...velocity } : { x: 0, y: 0 },
      mass,
      radius: massToRadius(mass, this.kArea, kind === 'particle'),
      data: {},
    };
    this.entities.set(entity.id, entity);
    return entity;
  }

  removeEntity(id: EntityId): void {
    const entity = this.entities.get(id);
    if (!entity) return;
    this.entities.delete(id);
    if (entity.ownerId) {
      const player = this.players.get(entity.ownerId);
      if (player) player.pieceIds = player.pieceIds.filter((pieceId) => pieceId !== id);
    }
  }

  getEntity(id: EntityId): Entity | undefined {
    return this.entities.get(id);
  }

  allEntities(): Entity[] {
    return [...this.entities.values()];
  }

  getPiecesByOwner(ownerId: PlayerId): Entity[] {
    const player = this.players.get(ownerId);
    if (!player) return [];
    return player.pieceIds
      .map((id) => this.entities.get(id))
      .filter((entity): entity is Entity => entity !== undefined);
  }

  /** Requête spatiale publique (broad-phase) pour un rayon arbitraire autour d'un point — utilisée
   * par les consommateurs externes au moteur (ex. l'IA des bots, `engine/bots/botEvaluator.ts`) qui
   * n'ont pas de raison d'accéder à `spatialHash` lui-même (grille interne dimensionnée pour la
   * narrow-phase des collisions, voir `rebuildSpatialHash`/`findOverlappingPairs`). Combine la
   * grille (`SpatialHash.queryRadius`, jamais les grandes entités — voir son commentaire) et les
   * grandes entités (Blobs Challenger...) réellement à portée : un appelant générique comme l'IA
   * des bots doit toujours voir une grande entité proche, quelle que soit sa taille, exactement
   * comme avant l'introduction de `SpatialHash.getLargeEntities` (voir audit_chaleur.md). */
  queryNearby(position: Vector2, radius: number): EntityId[] {
    const gridIds = this.spatialHash.queryRadius(position, radius);
    const largeEntities = this.spatialHash.getLargeEntities();
    if (largeEntities.length === 0) return gridIds;

    const result = gridIds.slice();
    for (const entity of largeEntities) {
      const dx = entity.position.x - position.x;
      const dy = entity.position.y - position.y;
      const reach = radius + entity.radius;
      if (dx * dx + dy * dy <= reach * reach) result.push(entity.id);
    }
    return result;
  }

  /** Fusionne deux entités : masse additive, position barycentrique (metriques.md §10). */
  mergeEntities(a: Entity, b: Entity): Entity {
    const mergedMass = a.mass + b.mass;
    const position: Vector2 = {
      x: (a.position.x * a.mass + b.position.x * b.mass) / mergedMass,
      y: (a.position.y * a.mass + b.position.y * b.mass) / mergedMass,
    };
    const ownerId = a.ownerId ?? b.ownerId;
    this.removeEntity(a.id);
    this.removeEntity(b.id);
    if (ownerId) {
      return this.spawnPiece(ownerId, position, mergedMass);
    }
    return this.spawnParticle(position, mergedMass);
  }

  /** Recalcule le rayon après une modification manuelle de la masse d'une entité (ex: manger, decay). */
  setMass(entity: Entity, mass: number): void {
    entity.mass = mass;
    entity.radius = massToRadius(mass, this.kArea, entity.kind === 'particle');
  }

  // --- Joueurs -----------------------------------------------------------

  addPlayer(id: PlayerId, nickname: string, skin?: string): PlayerState {
    const player: PlayerState = {
      id,
      nickname,
      pieceIds: [],
      alive: false,
      lifeStats: createLifeStats(),
      spawnedAtMs: performance.now(),
      skin,
    };
    this.players.set(id, player);
    return player;
  }

  /** Enregistre `attackerId` comme dernier joueur à avoir mangé un morceau de `targetId` (écran
   * de mort personnalisé, "Éliminé par : X") — écrasé à chaque absorption, donc reflète
   * naturellement le dernier attaquant au moment où le dernier morceau disparaît. Ne fait rien
   * pour un joueur inconnu (déjà déconnecté). */
  recordAttacker(targetId: PlayerId, attackerId: PlayerId): void {
    const target = this.players.get(targetId);
    if (target) target.lastAttackerId = attackerId;
  }

  /** Remet à zéro les stats XP/combo d'un joueur (voir engine/xp.ts) — appelé par net/server.ts
   * juste après avoir lu/crédité `lifeStats.xpEarned` au compte, jamais par un mod (voir le
   * commentaire de `PlayerState.lifeStats`). Ne fait rien pour un id inconnu (joueur déjà
   * déconnecté entre-temps). */
  resetLifeStats(id: PlayerId): void {
    const player = this.players.get(id);
    if (player) player.lifeStats = createLifeStats();
  }

  removePlayer(id: PlayerId): void {
    const player = this.players.get(id);
    if (!player) return;
    for (const pieceId of [...player.pieceIds]) this.removeEntity(pieceId);
    this.players.delete(id);
  }

  getPlayer(id: PlayerId): PlayerState | undefined {
    return this.players.get(id);
  }

  allPlayers(): PlayerState[] {
    return [...this.players.values()];
  }

  // --- Collision (broad-phase générique, Lot 1.2) -------------------------

  rebuildSpatialHash(): void {
    this.spatialHash.clear();
    for (const entity of this.entities.values()) this.spatialHash.insert(entity);
  }

  /** `true` si les cercles de `a` et `b` se chevauchent réellement — même convention de marge
   * (1.05x) qu'avant : une pastille de nourriture est considérée "mangée" un peu avant un contact
   * cercle-à-cercle strict côté morceau (retour utilisateur : le contact strict ratait des
   * pastilles pourtant visuellement recouvertes). */
  private isOverlapping(a: Entity, b: Entity): boolean {
    const radA = a.kind === 'piece' && b.kind === 'particle' ? a.radius * 1.05 : a.radius;
    const radB = b.kind === 'piece' && a.kind === 'particle' ? b.radius * 1.05 : b.radius;
    return distance(a.position, b.position) < radA + radB;
  }

  /** Paires d'entités dont les cercles se chevauchent réellement (narrow-phase après le broad-phase).
   *
   * Fonction la plus chaude du serveur au profilage (voir audit_chaleur.md — ~20% de tout le temps
   * CPU JS mesuré, y compris salons vides de joueurs humains, simplement peuplés de bots/nourriture
   * ambiants). Trois catégories de paires, JAMAIS mélangées entre elles (aucun risque de double
   * comptage, aucune paire manquée) :
   *
   * 1. Petites entités entre elles (grille SEULEMENT, voir `SpatialHash` — les grandes entités n'y
   *    sont jamais insérées, donc cette boucle ne peut jamais les y trouver). Chaque paire NON
   *    ORDONNÉE y est découverte deux fois par construction du broad-phase (une fois depuis
   *    chaque entité, la requête spatiale de l'une retrouvant forcément l'autre) — l'ancienne
   *    implémentation payait cette redondance avec un `Set<string>` de dédoublonnage RECRÉÉ à
   *    chaque appel (30x/s) et une clé de paire par CONCATÉNATION DE CHAÎNE pour CHAQUE candidat
   *    (avant même de savoir si les cercles se chevauchent réellement) — visible au profil
   *    (`FindOrderedHashSetEntry`, `RecordWriteSaveFP`/`GrowFastSmiOrObjectElements`, la pression
   *    GC qui va avec). `entity.id < otherId` (n'importe quel ordre total cohérent suffit, pas
   *    besoin d'un ordre numérique) élimine cette redondance À LA SOURCE : ni Set, ni chaîne, et
   *    la moitié des candidats est écartée AVANT même le calcul de `distance()`, pas après.
   *
   * 2. Chaque grande entité (Blob Challenger...) contre les petites entités réellement à sa
   *    portée — recherche à SA PROPRE taille (+ la plus grande taille possible d'une petite
   *    entité, `maxGridEntityRadius()`), jamais le rayon fixe de `queryNearby` : une grande
   *    entité qui chercherait ses voisines avec un petit rayon fixe manquerait des petites
   *    entités en bordure de son propre (grand) rayon — bug constaté et corrigé lors du calibrage
   *    initial de ce correctif (voir l'historique de ce fichier).
   *
   * 3. Grandes entités entre elles — leur nombre reste petit par construction (voir
   *    `LARGE_ENTITY_RADIUS_FACTOR`, spatialHash.ts), donc un simple O(k²) reste bon marché. */
  findOverlappingPairs(): Array<[Entity, Entity]> {
    const pairs: Array<[Entity, Entity]> = [];

    for (const entity of this.entities.values()) {
      const nearbyIds = this.spatialHash.queryNearby(entity.position);
      for (const otherId of nearbyIds) {
        if (!(entity.id < otherId)) continue;
        const other = this.entities.get(otherId);
        if (other && this.isOverlapping(entity, other)) pairs.push([entity, other]);
      }
    }

    const largeEntities = this.spatialHash.getLargeEntities();
    const maxSmallReach = this.spatialHash.maxGridEntityRadius();
    for (const large of largeEntities) {
      const nearbyIds = this.spatialHash.queryRadius(large.position, large.radius + maxSmallReach);
      for (const otherId of nearbyIds) {
        const other = this.entities.get(otherId);
        if (other && this.isOverlapping(large, other)) pairs.push([large, other]);
      }
    }

    for (let i = 0; i < largeEntities.length; i++) {
      for (let j = i + 1; j < largeEntities.length; j++) {
        const a = largeEntities[i]!;
        const b = largeEntities[j]!;
        if (this.isOverlapping(a, b)) pairs.push([a, b]);
      }
    }

    return pairs;
  }
}
