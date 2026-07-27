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
  private spatialHash: SpatialHash;
  /** Compteur d'ids courts plutôt que des UUID — mesuré au Lot 1.8 : la taille des ids sur le
   * réseau compte beaucoup à 20 Hz avec des centaines d'entités. */
  private nextEntityId = 1;

  constructor(options: WorldOptions) {
    this.mapSize = options.mapSize;
    this.kArea = options.kArea ?? Math.PI;
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
      radius: massToRadius(mass, this.kArea),
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
    entity.radius = massToRadius(mass, this.kArea);
  }

  // --- Joueurs -----------------------------------------------------------

  addPlayer(id: PlayerId, nickname: string): PlayerState {
    const player: PlayerState = {
      id,
      nickname,
      pieceIds: [],
      alive: false,
      lifeStats: createLifeStats(),
    };
    this.players.set(id, player);
    return player;
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

  /** Paires d'entités dont les cercles se chevauchent réellement (narrow-phase après le broad-phase). */
  findOverlappingPairs(): Array<[Entity, Entity]> {
    const pairs: Array<[Entity, Entity]> = [];
    const seen = new Set<string>();

    for (const entity of this.entities.values()) {
      const nearbyIds = this.spatialHash.queryNearby(entity.position);
      for (const otherId of nearbyIds) {
        if (otherId === entity.id) continue;
        const other = this.entities.get(otherId);
        if (!other) continue;

        const pairKey =
          entity.id < other.id ? `${entity.id}|${other.id}` : `${other.id}|${entity.id}`;
        if (seen.has(pairKey)) continue;
        seen.add(pairKey);

        if (distance(entity.position, other.position) < entity.radius + other.radius) {
          pairs.push([entity, other]);
        }
      }
    }

    return pairs;
  }
}
