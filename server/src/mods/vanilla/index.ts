import {
  add,
  circleOverlapArea,
  distance,
  massToArea,
  normalize,
  scale,
  sub,
  type Vector2,
} from '@angulio/shared';
import type { GameMod } from '../../engine/mod.js';
import type { Entity, PlayerId, PlayerInput } from '../../engine/types.js';
import type { World } from '../../engine/world.js';
import { VANILLA_CONSTANTS as C } from './constants.js';
import { applyPassiveDecay, boostFactor, velocityForMass } from './physics.js';
import { pieceState } from './pieceState.js';

const FALLBACK_DIRECTION: Vector2 = { x: 1, y: 0 };

function randomPositionInMap(mapSize: number, margin: number): Vector2 {
  return {
    x: margin + Math.random() * (mapSize - 2 * margin),
    y: margin + Math.random() * (mapSize - 2 * margin),
  };
}

function spawnPlayerPiece(world: World, playerId: PlayerId): void {
  const margin = Math.sqrt(C.M_START); // rayon de départ, évite de spawn hors carte
  const position = randomPositionInMap(world.mapSize, margin);
  world.spawnPiece(playerId, position, C.M_START);
}

function directionOf(piece: Entity): Vector2 {
  const dir = pieceState(piece).inputDir;
  return dir.x === 0 && dir.y === 0 ? FALLBACK_DIRECTION : normalize(dir);
}

/** Tente de splitter un morceau existant en 2 (metriques.md §9). Ne fait rien si les conditions
 * (masse minimale, nombre de morceaux du joueur) ne sont pas remplies. */
function trySplitPiece(world: World, playerId: PlayerId, piece: Entity): void {
  if (piece.mass < C.M_SPLIT_MIN) return;
  if (world.getPiecesByOwner(playerId).length >= C.N_PIECES_MAX) return;

  const half = piece.mass / 2;
  const dir = directionOf(piece);

  world.setMass(piece, half);
  const originState = pieceState(piece);
  originState.splitElapsedS = 0;

  const radiusAfterSplit = piece.radius; // world.setMass a déjà recalculé le rayon
  const ejectedPosition = add(piece.position, scale(dir, radiusAfterSplit * 2));
  const ejected = world.spawnPiece(playerId, ejectedPosition, half);

  const ejectedState = pieceState(ejected);
  ejectedState.inputDir = { ...originState.inputDir };
  ejectedState.splitElapsedS = 0;
  ejectedState.boostRemainingS = C.T_BOOST;
  ejectedState.boostDir = dir;
}

/** Écarte deux morceaux qui se chevauchent sans condition d'absorption remplie (metriques.md §8). */
function applyRepulsion(a: Entity, b: Entity): void {
  const d = distance(a.position, b.position);
  const penetration = a.radius + b.radius - d;
  if (penetration <= 0) return;

  const dir = d > 0 ? scale(sub(a.position, b.position), 1 / d) : FALLBACK_DIRECTION;
  const totalMass = a.mass + b.mass;
  const moveA = penetration * (b.mass / totalMass);
  const moveB = penetration * (a.mass / totalMass);

  a.position = add(a.position, scale(dir, moveA));
  b.position = sub(b.position, scale(dir, moveB));
}

function tryMerge(world: World, a: Entity, b: Entity): void {
  const stateA = pieceState(a);
  const stateB = pieceState(b);
  const cooldownElapsed =
    Math.min(stateA.splitElapsedS, stateB.splitElapsedS) >= C.T_MERGE_COOLDOWN;
  if (!cooldownElapsed) return;

  const overlap = circleOverlapArea(a.radius, b.radius, distance(a.position, b.position));
  const totalArea = massToArea(a.mass, C.K_AREA) + massToArea(b.mass, C.K_AREA);
  if (overlap < totalArea * C.OVERLAP_MERGE_MIN_FRACTION) return;

  world.mergeEntities(a, b);
}

function handleEatAttempt(world: World, attacker: Entity, target: Entity): boolean {
  if (attacker.mass >= target.mass * (1 + C.EAT_MASS_ADVANTAGE)) {
    world.setMass(attacker, attacker.mass + target.mass);
    world.removeEntity(target.id);
    return true;
  }
  return false;
}

export const vanillaMod: GameMod = {
  id: 'vanilla',

  onPlayerJoin(world, playerId) {
    spawnPlayerPiece(world, playerId);
  },

  onPlayerDeath(world, playerId) {
    // Respawn immédiat — le MVP ne modélise pas d'écran d'attente entre deux vies.
    spawnPlayerPiece(world, playerId);
  },

  onPlayerInput(world: World, playerId: PlayerId, input: PlayerInput) {
    const pieces = world.getPiecesByOwner(playerId);
    for (const piece of pieces) {
      pieceState(piece).inputDir = input.dir;
    }

    if (input.split) {
      // Snapshot pris avant les splits de ce tick : on ne re-splitte pas un morceau tout juste créé.
      for (const piece of pieces) {
        if (world.getPiecesByOwner(playerId).length >= C.N_PIECES_MAX) break;
        trySplitPiece(world, playerId, piece);
      }
    }
  },

  onTick(world: World, dt: number) {
    for (const entity of world.allEntities()) {
      if (entity.kind !== 'piece') continue;

      const state = pieceState(entity);
      state.splitElapsedS += dt;

      const baseVelocity = scale(directionOf(entity), velocityForMass(entity.mass));

      if (state.boostRemainingS > 0) {
        const factor = boostFactor(state.boostRemainingS);
        const boost = scale(
          state.boostDir,
          C.BOOST_SPEED_FACTOR * velocityForMass(entity.mass) * factor,
        );
        entity.velocity = add(baseVelocity, boost);
        state.boostRemainingS = Math.max(0, state.boostRemainingS - dt);
      } else {
        entity.velocity = baseVelocity;
      }

      const decayedMass = applyPassiveDecay(entity.mass, dt);
      if (decayedMass !== entity.mass) world.setMass(entity, decayedMass);
    }

    const particleCount = world.allEntities().filter((e) => e.kind === 'particle').length;
    const toSpawn = Math.min(
      C.FOOD_SPAWN_PER_TICK,
      Math.max(0, C.FOOD_TARGET_COUNT - particleCount),
    );
    for (let i = 0; i < toSpawn; i++) {
      world.spawnParticle(randomPositionInMap(world.mapSize, 1), C.M_FOOD);
    }
  },

  onPostMove(world: World) {
    for (const entity of world.allEntities()) {
      const min = entity.radius;
      const max = world.mapSize - entity.radius;

      if (entity.position.x < min) {
        entity.position.x = min;
        entity.velocity.x = 0;
      } else if (entity.position.x > max) {
        entity.position.x = max;
        entity.velocity.x = 0;
      }

      if (entity.position.y < min) {
        entity.position.y = min;
        entity.velocity.y = 0;
      } else if (entity.position.y > max) {
        entity.position.y = max;
        entity.velocity.y = 0;
      }
    }
  },

  onCollision(world: World, a: Entity, b: Entity) {
    if (a.kind === 'particle' && b.kind === 'particle') return;

    // Nourriture mangée par un morceau
    if (a.kind === 'particle' || b.kind === 'particle') {
      const [particle, piece] = a.kind === 'particle' ? [a, b] : [b, a];
      if (piece.mass >= C.M_EAT_FOOD_MIN) {
        world.setMass(piece, piece.mass + particle.mass);
        world.removeEntity(particle.id);
      }
      return;
    }

    // Deux morceaux du même joueur : candidats à la fusion, jamais à l'absorption ni la répulsion
    if (a.ownerId && a.ownerId === b.ownerId) {
      tryMerge(world, a, b);
      return;
    }

    // Deux morceaux de joueurs différents : absorption si 5% d'avantage, sinon répulsion
    if (!handleEatAttempt(world, a, b) && !handleEatAttempt(world, b, a)) {
      applyRepulsion(a, b);
    }
  },
};
