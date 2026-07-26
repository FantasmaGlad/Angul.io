import type { Entity } from '../../engine/types.js';
import type { ParametricModConfig } from './config.js';

/**
 * Comportement aux bords de la carte (dictionnaire de la feuille Excel : STRICT_WALL,
 * ELASTIC_BOUNCE, TOROIDAL, TOXIC_ZONE). Seuls les trois premiers sont pleinement définis —
 * TOXIC_ZONE nécessiterait des paramètres de dégâts que ni la feuille ni le cahier des charges
 * ne précisent encore ; on échoue explicitement plutôt que d'inventer une valeur.
 */
export function applyBorder(entity: Entity, config: ParametricModConfig): void {
  const { width, height, borderType } = config.arena;

  switch (borderType) {
    case 'STRICT_WALL':
      applyStrictWall(entity, width, height);
      return;
    case 'ELASTIC_BOUNCE':
      applyElasticBounce(entity, width, height, config.arena.bounceRestitution ?? 1);
      return;
    case 'TOROIDAL':
      applyToroidal(entity, width, height);
      return;
    case 'TOXIC_ZONE':
      throw new Error(
        "borderType TOXIC_ZONE n'est pas encore implémenté (paramètres de dégâts non spécifiés).",
      );
  }
}

function applyStrictWall(entity: Entity, mapWidth: number, mapHeight: number): void {
  const minX = entity.radius;
  const maxX = mapWidth - entity.radius;
  const minY = entity.radius;
  const maxY = mapHeight - entity.radius;

  if (entity.position.x < minX) {
    entity.position.x = minX;
    entity.velocity.x = 0;
  } else if (entity.position.x > maxX) {
    entity.position.x = maxX;
    entity.velocity.x = 0;
  }

  if (entity.position.y < minY) {
    entity.position.y = minY;
    entity.velocity.y = 0;
  } else if (entity.position.y > maxY) {
    entity.position.y = maxY;
    entity.velocity.y = 0;
  }
}

function applyElasticBounce(
  entity: Entity,
  mapWidth: number,
  mapHeight: number,
  restitution: number,
): void {
  const minX = entity.radius;
  const maxX = mapWidth - entity.radius;
  const minY = entity.radius;
  const maxY = mapHeight - entity.radius;

  if (entity.position.x < minX) {
    entity.position.x = minX;
    entity.velocity.x = -entity.velocity.x * restitution;
  } else if (entity.position.x > maxX) {
    entity.position.x = maxX;
    entity.velocity.x = -entity.velocity.x * restitution;
  }

  if (entity.position.y < minY) {
    entity.position.y = minY;
    entity.velocity.y = -entity.velocity.y * restitution;
  } else if (entity.position.y > maxY) {
    entity.position.y = maxY;
    entity.velocity.y = -entity.velocity.y * restitution;
  }
}

function applyToroidal(entity: Entity, mapWidth: number, mapHeight: number): void {
  entity.position.x = ((entity.position.x % mapWidth) + mapWidth) % mapWidth;
  entity.position.y = ((entity.position.y % mapHeight) + mapHeight) % mapHeight;
}
