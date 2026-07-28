import {
  add,
  circleOverlapArea,
  distance,
  isBotId,
  length,
  massToArea,
  moveToward,
  scale,
  sub,
  type Vector2,
} from '@angulio/shared';
import type { GameMod } from '../../engine/mod.js';
import { isGodPlayerId } from '../../engine/godmode.js';
import type { Entity, PlayerId, PlayerInput } from '../../engine/types.js';
import type { World } from '../../engine/world.js';
import { creditMassEatenXp, creditPlayerEatenXp } from '../../engine/xp.js';
import { logEvent } from '../../log.js';
import { applyBorder } from './border.js';

import type { ParametricModConfig } from './config.js';
import {
  applyPassiveDecay,
  accelerationForMass,
  foodTargetCount,
  randomFoodMass,
  velocityForMass,
} from './physics.js';
import { pieceState } from './pieceState.js';

const FALLBACK_DIRECTION: Vector2 = { x: 1, y: 0 };

/**
 * Construit un mode de jeu entièrement défini par `config` (voir config.ts). Aucune règle de
 * jeu n'est codée en dur ici — seule la mécanique générique (vitesse/accélération, split,
 * fusion, alimentation, bords de carte) est implémentée, paramétrée par les valeurs du mod.
 * Vanilla est une instance de cette même fonction (server/configs/*.json).
 */
export function createParametricMod(config: ParametricModConfig): GameMod {
  function randomPositionInMap(margin: number): Vector2 {
    return {
      x: margin + Math.random() * (config.arena.width - 2 * margin),
      y: margin + Math.random() * (config.arena.height - 2 * margin),
    };
  }

  function isUnderPlayerPiece(world: World, pos: Vector2): boolean {
    for (const entity of world.allEntities()) {
      if (entity.kind === 'piece' || entity.ownerId !== undefined) {
        const dist = distance(pos, entity.position);
        if (dist < entity.radius + 5) {
          return true;
        }
      }
    }
    return false;
  }

  function randomFoodPosition(world: World, margin: number = 1): Vector2 {
    const MAX_ATTEMPTS = 15;
    let candidate = randomPositionInMap(margin);

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!isUnderPlayerPiece(world, candidate)) {
        return candidate;
      }
      candidate = randomPositionInMap(margin);
    }

    return candidate;
  }

  function isNearBigPlayerPiece(world: World, pos: Vector2, safeDistance: number = 150): boolean {
    for (const entity of world.allEntities()) {
      if (entity.kind === 'piece') {
        const dist = distance(pos, entity.position);
        if (dist < entity.radius + safeDistance) {
          return true;
        }
      }
    }
    return false;
  }

  function randomSafePlayerPosition(world: World, margin: number): Vector2 {
    const MAX_ATTEMPTS = 25;
    let candidate = randomPositionInMap(margin);
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (!isNearBigPlayerPiece(world, candidate, 150)) {
        return candidate;
      }
      candidate = randomPositionInMap(margin);
    }
    return candidate;
  }

  function spawnPlayerPiece(world: World, playerId: PlayerId): void {
    const margin = Math.sqrt((config.areaConstant * config.player.startMass) / 3);
    world.spawnPiece(playerId, randomSafePlayerPosition(world, margin), config.player.startMass);
  }

  /**
   * Direction ET intensité d'un morceau donné vers la cible du joueur (`inputTarget`, position
   * monde du curseur — voir pieceState.ts). Calculée **par morceau** (à partir de sa propre
   * position) plutôt qu'une direction unique partagée par tous les morceaux du joueur : si le
   * curseur est positionné entre plusieurs morceaux, chacun s'en rapproche indépendamment
   * (regroupement), au lieu que tous partent dans la même direction relative.
   */
  function inputVectorOf(piece: Entity): { direction: Vector2; intensity: number } {
    const state = pieceState(piece);
    const offset = sub(state.inputTarget, piece.position);
    const dist = length(offset);
    if (dist === 0) return { direction: FALLBACK_DIRECTION, intensity: state.inputIntensity };
    return { direction: scale(offset, 1 / dist), intensity: state.inputIntensity };
  }

  /** Divise un morceau en deux (masse restante m/2, éjecté = m/2 * eta_W — metriques.md §9,
   * généralisé par `config.split.ejectEfficiency`). */
  function trySplitPiece(world: World, playerId: PlayerId, piece: Entity): void {
    if (piece.mass < config.player.minSplitMass) return;
    if (world.getPiecesByOwner(playerId).length >= config.player.maxSplits) return;

    const half = piece.mass / 2;
    const { direction: dir } = inputVectorOf(piece); // le split ignore l'intensité, toujours "plein"

    world.setMass(piece, half);
    const originState = pieceState(piece);
    originState.splitElapsedS = 0;
    originState.massAtSplit = half;

    const ejectedMass = half * config.split.ejectEfficiency;
    const ejectedPosition = add(piece.position, scale(dir, piece.radius * 2));
    const ejected = world.spawnPiece(playerId, ejectedPosition, ejectedMass);
    ejected.velocity = scale(
      dir,
      velocityForMass(ejectedMass, config) * config.split.ejectSpeedFactor,
    );

    const ejectedState = pieceState(ejected);
    ejectedState.inputTarget = { ...originState.inputTarget };
    ejectedState.inputIntensity = originState.inputIntensity;
    ejectedState.splitElapsedS = 0;
    ejectedState.massAtSplit = ejectedMass;
  }

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

  /** Cooldown de fusion mass-dépendant : T(m) = Tbase + gamma_rec*m (par morceau, feuille
   * Excel — gamma_rec est 0 pour Vanilla à ce jour, donc un cooldown fixe en pratique).
   * Renvoie `true` si la fusion a eu lieu — l'appelant (`onCollision`) s'en sert pour savoir s'il
   * doit à la place repousser les deux morceaux (voir le correctif "chevauchement post-split"). */
  function tryMerge(world: World, a: Entity, b: Entity): boolean {
    const stateA = pieceState(a);
    const stateB = pieceState(b);
    const requiredA = config.merge.baseTimeSec + config.merge.massFactor * stateA.massAtSplit;
    const requiredB = config.merge.baseTimeSec + config.merge.massFactor * stateB.massAtSplit;
    if (stateA.splitElapsedS < requiredA || stateB.splitElapsedS < requiredB) return false;

    const overlap = circleOverlapArea(a.radius, b.radius, distance(a.position, b.position));
    const totalArea =
      massToArea(a.mass, config.areaConstant) + massToArea(b.mass, config.areaConstant);
    if (overlap < totalArea * config.merge.overlapMinFraction) return false;

    world.mergeEntities(a, b);
    return true;
  }

  /** Blob Dieu (§4.5 cahier_des_charges_admin.md) : invincibilité + "manger n'importe quelle
   * entité" — vérifié ici (seul point de décision d'avantage de masse, utilisé pour l'absorption
   * ET la répulsion) plutôt que dupliqué à chaque appelant. */
  function hasMassAdvantage(attacker: Entity, target: Entity): boolean {
    if (isGodPlayerId(target.ownerId)) return false;
    if (isGodPlayerId(attacker.ownerId)) return true;
    return attacker.mass >= target.mass * (1 + config.eating.massAdvantage);
  }

  function handleEatAttempt(world: World, attacker: Entity, target: Entity): boolean {
    if (hasMassAdvantage(attacker, target)) {
      const dist = distance(attacker.position, target.position);
      const overlap = circleOverlapArea(attacker.radius, target.radius, dist);
      const targetArea = 3 * target.radius * target.radius;

      // Exige un chevauchement d'au moins 1/3 (33.3%) de la surface de la cible pour l'absorber
      if (overlap >= targetArea / 3) {
        const gainedMass = target.mass;

        if (attacker.ownerId && target.ownerId) {
          const attackerPlayer = world.getPlayer(attacker.ownerId);
          const targetPlayer = world.getPlayer(target.ownerId);
          logEvent('player_eaten', {
            attackerId: attacker.ownerId,
            attackerNickname: attackerPlayer?.nickname ?? attacker.ownerId,
            victimId: target.ownerId,
            victimNickname: targetPlayer?.nickname ?? target.ownerId,
            mass: Math.floor(gainedMass),
          });
          // Écran de mort personnalisé ("Éliminé par : X") — voir World.recordAttacker.
          world.recordAttacker(target.ownerId, attacker.ownerId);
        }

        world.setMass(attacker, attacker.mass + gainedMass);
        const attackerState = pieceState(attacker);
        attackerState.timeSinceLastEatenS = 0;
        world.removeEntity(target.id);
        const now = performance.now();
        creditMassEatenXp(world, attacker.ownerId, gainedMass, now);
        creditPlayerEatenXp(world, attacker.ownerId, now);
        return true;
      }
    }
    return false;
  }

  let foodSpawnCredit = 0;

  return {
    id: config.id,

    getAccelerationForMass(mass) {
      return accelerationForMass(mass, config);
    },

    onPlayerJoin(world, playerId) {
      spawnPlayerPiece(world, playerId);
    },

    onPlayerDeath() {
      // Attendre que le joueur réclame son respawn via le menu / bouton Rejouer
    },

    onPlayerInput(world: World, playerId: PlayerId, input: PlayerInput) {
      const pieces = world.getPiecesByOwner(playerId);
      for (const piece of pieces) {
        const state = pieceState(piece);
        state.inputTarget = input.target;
        state.inputIntensity = input.intensity;
      }

      if (input.split) {
        // Snapshot pris avant les splits de ce tick : on ne re-splitte pas un morceau tout juste créé.
        for (const piece of pieces) {
          if (world.getPiecesByOwner(playerId).length >= config.player.maxSplits) break;
          trySplitPiece(world, playerId, piece);
        }
      }
    },

    onTick(world: World, dt: number) {
      for (const entity of world.allEntities()) {
        if (entity.kind !== 'piece') continue;

        const state = pieceState(entity);
        state.splitElapsedS += dt;
        state.timeSinceLastEatenS += dt;
        state.foodEatenThisTick = 0;

        const { direction, intensity } = inputVectorOf(entity);
        // Le curseur proche du centre donne un contrôle fin (faible intensité) ; loin, le
        // plein régime — vitesse cible ET taux d'accélération sont tous deux réduits.
        const targetVelocity = scale(direction, velocityForMass(entity.mass, config) * intensity);
        const maxChange = accelerationForMass(entity.mass, config) * intensity * dt;
        entity.velocity = moveToward(entity.velocity, targetVelocity, maxChange);

        const decayedMass = applyPassiveDecay(entity.mass, dt, config, state.timeSinceLastEatenS);
        if (decayedMass !== entity.mass) world.setMass(entity, decayedMass);
      }

      const allPlayers = world.allPlayers();
      const humanCount = allPlayers.filter((p) => !isBotId(p.id)).length;
      const particleCount = world.allEntities().filter((e) => e.kind === 'particle').length;
      const target = foodTargetCount(config, humanCount);
      if (particleCount < target) {
        foodSpawnCredit += config.food.respawnRatePerSecond * dt;
        const toSpawn = Math.min(Math.floor(foodSpawnCredit), target - particleCount);
        foodSpawnCredit -= toSpawn;
        for (let i = 0; i < toSpawn; i++) {
          world.spawnParticle(randomFoodPosition(world, 1), randomFoodMass(config));
        }
      }
    },

    onPostMove(world: World) {
      for (const entity of world.allEntities()) {
        applyBorder(entity, config);
      }
    },

    onCollision(world: World, a: Entity, b: Entity) {
      if (a.kind === 'particle' && b.kind === 'particle') return;

      // Nourriture mangée par un morceau
      if (a.kind === 'particle' || b.kind === 'particle') {
        const [particle, piece] = a.kind === 'particle' ? [a, b] : [b, a];
        if (piece.mass >= config.eating.minMassToEatFood) {
          const state = pieceState(piece);
          state.foodEatenThisTick = (state.foodEatenThisTick ?? 0) + particle.mass;
          if (state.foodEatenThisTick <= 25) {
            const gainedMass = particle.mass;
            world.setMass(piece, piece.mass + gainedMass);
            world.removeEntity(particle.id);
            state.timeSinceLastEatenS = 0;
            creditMassEatenXp(world, piece.ownerId, gainedMass, performance.now());
          }
        }
        return;
      }

      // Deux morceaux du même joueur : candidats à la fusion, jamais à l'absorption — mais tant
      // que la fusion n'a pas lieu (cooldown post-split pas écoulé, ou chevauchement insuffisant),
      // ils doivent quand même se repousser comme deux morceaux de joueurs différents, plutôt que
      // de se chevaucher librement (correctif : "après un split, les entités se chevauchent au
      // lieu de collisionner").
      if (a.ownerId && a.ownerId === b.ownerId) {
        if (!tryMerge(world, a, b)) applyRepulsion(a, b);
        return;
      }

      // Deux morceaux de joueurs différents : absorption si avantage de masse + 1/3 chevauchement,
      // sinon répulsion uniquement si aucun des deux n'a d'avantage de masse (afin d'autoriser le chevauchement progressif).
      const eaten = handleEatAttempt(world, a, b) || handleEatAttempt(world, b, a);
      if (!eaten && !hasMassAdvantage(a, b) && !hasMassAdvantage(b, a)) {
        applyRepulsion(a, b);
      }
    },
  };
}
