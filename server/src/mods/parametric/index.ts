import {
  add,
  circleOverlapArea,
  clamp,
  distance,
  dot,
  isBotId,
  length,
  moveToward,
  PI,
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
  absorptionRatePerSec,
  applyPassiveDecay,
  accelerationForMass,
  foodTargetCount,
  randomFoodMass,
  velocityForMass,
} from './physics.js';
import { pieceState } from './pieceState.js';

const FALLBACK_DIRECTION: Vector2 = { x: 1, y: 0 };
/** Rayon (px monde) autour de la cible du curseur en-deçà duquel `inputVectorOf` n'applique plus
 * aucune force de pilotage — voir son commentaire (élimine l'instabilité de normalisation d'un
 * vecteur quasi nul, seule vraiment visible via la prédiction locale du client). */
const TARGET_DEAD_ZONE_PX = 3;

/** Portée SUPPLÉMENTAIRE (au-delà du rayon du morceau lui-même) du halo de gravité (demande
 * utilisateur : "léger halo autour du joueur où les particules sont absorbées, comme par une
 * gravité") — volontairement modeste ("léger"), pas un aimant qui viderait toute une zone. */
const FOOD_GRAVITY_RANGE_PX = 60;
/** Vitesse d'attraction (px/s) de la nourriture dans le halo — assez rapide pour se sentir comme
 * une vraie aspiration sur la courte portée du halo, jamais assez pour ressembler à un
 * téléport. */
const FOOD_GRAVITY_SPEED_PX_PER_S = 220;

/** Attire vers `piece` (jamais vers un AUTRE morceau de joueur, demande utilisateur : "pas les
 * joueurs") toute particule de nourriture à portée du halo — un simple déplacement direct de
 * position (la nourriture n'a pas de vélocité propre en dehors de cet effet), borné à
 * `FOOD_GRAVITY_SPEED_PX_PER_S * dt` par tick pour ne jamais dépasser la distance réelle qui
 * sépare la particule du morceau (évite un dépassement/tremblement si la particule est déjà
 * quasiment au contact). `world.queryNearby` : mêmes positions que le tick précédent, la grille
 * spatiale n'étant reconstruite qu'après `onTick` (voir Room.tick()) — même décalage d'un tick
 * que l'utilise déjà `BotManager.isTouchingHuman`, imperceptible pour un effet de cette nature. */
function applyFoodGravity(world: World, piece: Entity, dt: number): void {
  const range = piece.radius + FOOD_GRAVITY_RANGE_PX;
  const maxStep = FOOD_GRAVITY_SPEED_PX_PER_S * dt;
  for (const nearbyId of world.queryNearby(piece.position, range)) {
    const particle = world.getEntity(nearbyId);
    if (!particle || particle.kind !== 'particle') continue;
    const offset = sub(piece.position, particle.position);
    const dist = length(offset);
    if (dist <= 0 || dist > range) continue;
    particle.position = add(particle.position, scale(offset, Math.min(maxStep, dist) / dist));
  }
}

/** Repousse deux morceaux hors de leur pénétration mutuelle — correction de POSITION (résout
 * 100% du chevauchement en un seul appel, mass-weighted), commune aux deux variantes. `hard`
 * (réservé aux morceaux d'un MÊME joueur, voir `onCollision` — demande utilisateur : "collisions
 * d'une même équipe dures, sans rebond") ajoute une correction de VÉLOCITÉ : annule la
 * composante de la vélocité relative dirigée le long de la normale de contact, pour un contact
 * SOLIDE qui ne se refait pas repousser en boucle par sa propre vélocité résiduelle à la frame
 * suivante — contrairement à la répulsion molle entre adversaires (jamais `hard`), qui laisse
 * volontairement les deux morceaux libres de se rapprocher à nouveau au tick suivant (permet le
 * chevauchement progressif pendant une absorption, voir `handleEatAttempt`).
 *
 * Fonction de niveau module (pas de dépendance à `config`) plutôt qu'interne à
 * `createParametricMod` : exportée pour que `mods/hardcore/index.ts` puisse l'appeler directement
 * plutôt que de dépendre d'un `base.onCollision?.()` délégué (qui, avec l'absorption progressive,
 * ré-exécuterait aussi `handleEatAttempt` — celui du mod PARAMÉTRIQUE, non multiplié — en plus de
 * celui, déjà exécuté, du mod Hardcore : un double transfert de masse). */
export function applyRepulsion(a: Entity, b: Entity, hard = false): void {
  const d = distance(a.position, b.position);
  const penetration = a.radius + b.radius - d;
  if (penetration <= 0) return;

  const dir = d > 0 ? scale(sub(a.position, b.position), 1 / d) : FALLBACK_DIRECTION;
  const totalMass = a.mass + b.mass;
  const moveA = penetration * (b.mass / totalMass);
  const moveB = penetration * (a.mass / totalMass);

  a.position = add(a.position, scale(dir, moveA));
  b.position = sub(b.position, scale(dir, moveB));

  if (hard) {
    // `dir` pointe de b vers a : une vélocité relative (a-b) dont la projection sur `dir` est
    // négative signifie que les deux morceaux se rapprochent encore le long de la normale de
    // contact malgré la correction de position ci-dessus — on annule CETTE composante (mass-
    // weighted, même répartition que la correction de position), sans toucher la composante
    // tangentielle (le joueur garde le contrôle du mouvement le long du contact).
    const closingSpeed = dot(sub(a.velocity, b.velocity), dir);
    if (closingSpeed < 0) {
      a.velocity = sub(a.velocity, scale(dir, closingSpeed * (b.mass / totalMass)));
      b.velocity = add(b.velocity, scale(dir, closingSpeed * (a.mass / totalMass)));
    }
  }
}

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
  function inputVectorOf(piece: Entity): { direction: Vector2; intensity: number; accelIntensity: number } {
    const state = pieceState(piece);
    const offset = sub(state.inputTarget, piece.position);
    const dist = length(offset);
    // Zone morte autour de la cible : en-deçà, normaliser `offset` diviserait par un nombre
    // proche de zéro — un bruit de position infime (arrondi flottant, un pixel de souris) produit
    // alors une direction qui peut faire des allers-retours complets d'une frame à l'autre. Le
    // serveur ne l'expose jamais visuellement à lui seul (dilué dans l'interpolation entre deux
    // ticks, voir renderEngine.ts), mais la prédiction locale du client (prediction.ts, qui
    // rejoue ce même calcul à chaque frame de rendu, jusqu'à 240 fois/seconde) l'expose telle
    // quelle. `intensity` à 0 annule bien la vitesse CIBLE, mais `accelIntensity` reste à 1 (au
    // lieu de suivre `intensity`) pour que `moveToward` (onTick) puisse toujours décélérer la
    // vélocité résiduelle vers 0 dans cette zone — sinon `maxChange` tombe aussi à 0 et la
    // vélocité reste figée telle quelle, ce qui faisait déraper le morceau hors zone puis
    // ré-entrer, geler/dégeler en boucle : le tremblotement visible du blob (absent des robots/
    // joueurs distants, toujours lissés par l'interpolation, jamais recalculés bruts par frame).
    if (dist < TARGET_DEAD_ZONE_PX) return { direction: FALLBACK_DIRECTION, intensity: 0, accelIntensity: 1 };
    return { direction: scale(offset, 1 / dist), intensity: state.inputIntensity, accelIntensity: state.inputIntensity };
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
    // Aire RÉELLE (dérivée du rayon effectif, voir shared/geometry.ts `massToRadius`), pas
    // `massToArea`/kArea — les deux formules ont divergé (le rayon des morceaux de joueur n'est
    // plus fonction de kArea du tout, voir `massToRadius`), comparer `overlap` à un total dérivé
    // de kArea faussait le seuil de fusion (chevauchement requis trop petit ou trop grand selon
    // le mode, jusqu'à rendre la fusion imperceptible ou au contraire quasi immédiate).
    const totalArea = PI * a.radius * a.radius + PI * b.radius * b.radius;
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

  /** Masse minimale sous laquelle une cible en cours d'absorption est retirée entièrement plutôt
   * que de laisser traîner indéfiniment un reliquat quasi nul (la décroissance appliquée par
   * `handleEatAttempt` est exponentielle, elle n'atteint jamais exactement 0). */
  const ABSORPTION_REMOVE_FLOOR = 0.5;

  /** Absorption PROGRESSIVE (demande utilisateur : pas "juste téléportation et disparition") :
   * tant que `attacker` a l'avantage de masse et chevauche `target`, lui transfère chaque tick une
   * fraction de sa masse RESTANTE proportionnelle à la fraction de sa surface actuellement
   * recouverte (`absorptionRatePerSec`, physics.ts) — la cible rétrécit visiblement à mesure
   * qu'elle est mangée (et l'attaquant grossit en retour), au lieu de disparaître d'un coup une
   * fois un seuil de recouvrement franchi. Remplace l'ancien comportement à seuil unique (aucune
   * répulsion pendant l'approche — `onCollision` désactive la répulsion dès qu'un avantage de masse
   * existe, voir plus bas — puis un transfert intégral instantané une fois 2/3 de la cible
   * recouverts), qui laissait la cible interpénétrer librement l'attaquant sans aucun retour visuel
   * jusqu'à ce "pop" soudain.
   *
   * Retourne `true` tant qu'un transfert a eu lieu ce tick (même partiel, cible pas encore
   * entièrement consommée) — `onCollision` s'en sert pour savoir s'il doit à la place repousser
   * les deux morceaux (aucun avantage de masse). */
  function handleEatAttempt(world: World, attacker: Entity, target: Entity, dt: number): boolean {
    if (!hasMassAdvantage(attacker, target)) return false;

    const dist = distance(attacker.position, target.position);
    const overlap = circleOverlapArea(attacker.radius, target.radius, dist);
    if (overlap <= 0) return false;

    // Même convention d'aire que `circleOverlapArea` (voir shared/geometry.ts) — les deux
    // valeurs doivent partager la même unité pour que leur ratio soit une vraie fraction ∈ [0,1].
    const targetArea = PI * target.radius * target.radius;
    const overlapFraction = targetArea > 0 ? clamp(overlap / targetArea, 0, 1) : 1;
    const massToTransfer = Math.min(
      target.mass,
      target.mass * absorptionRatePerSec(config) * overlapFraction * dt,
    );
    if (massToTransfer <= 0) return false;

    world.setMass(attacker, attacker.mass + massToTransfer);
    const attackerState = pieceState(attacker);
    attackerState.timeSinceLastEatenS = 0;
    creditMassEatenXp(world, attacker.ownerId, massToTransfer, performance.now());

    const remainingMass = target.mass - massToTransfer;
    if (remainingMass <= ABSORPTION_REMOVE_FLOOR) {
      if (attacker.ownerId && target.ownerId) {
        const attackerPlayer = world.getPlayer(attacker.ownerId);
        const targetPlayer = world.getPlayer(target.ownerId);
        logEvent('player_eaten', {
          attackerId: attacker.ownerId,
          attackerNickname: attackerPlayer?.nickname ?? attacker.ownerId,
          victimId: target.ownerId,
          victimNickname: targetPlayer?.nickname ?? target.ownerId,
          mass: Math.floor(target.mass), // masse de la cible au dernier tick d'absorption
        });
        // Écran de mort personnalisé ("Éliminé par : X") — voir World.recordAttacker.
        world.recordAttacker(target.ownerId, attacker.ownerId);
      }
      world.removeEntity(target.id);
      if (attacker.ownerId) creditPlayerEatenXp(world, attacker.ownerId, performance.now());
    } else {
      world.setMass(target, remainingMass);
    }
    return true;
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

        const { direction, intensity, accelIntensity } = inputVectorOf(entity);
        // Le curseur proche du centre donne un contrôle fin (faible intensité) ; loin, le
        // plein régime — vitesse cible ET taux d'accélération sont réduits de concert, SAUF dans
        // la zone morte (intensity=0, accelIntensity=1) où l'on garde l'accélération pleine pour
        // décélérer réellement la vélocité résiduelle vers 0 (voir inputVectorOf).
        const targetVelocity = scale(direction, velocityForMass(entity.mass, config) * intensity);
        const maxChange = accelerationForMass(entity.mass, config) * accelIntensity * dt;
        entity.velocity = moveToward(entity.velocity, targetVelocity, maxChange);

        const decayedMass = applyPassiveDecay(entity.mass, dt, config, state.timeSinceLastEatenS);
        if (decayedMass !== entity.mass) world.setMass(entity, decayedMass);

        applyFoodGravity(world, entity, dt);
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

    onCollision(world: World, a: Entity, b: Entity, dt: number) {
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

      // Deux morceaux du MÊME joueur ("même équipe", demande utilisateur) : candidats à la
      // fusion, jamais à l'absorption — mais tant que la fusion n'a pas lieu (cooldown post-split
      // pas écoulé, ou chevauchement insuffisant), collision DURE, SANS REBOND (position +
      // annulation de la vélocité de rapprochement, voir `applyRepulsion(hard=true)`) plutôt qu'un
      // chevauchement libre ou une répulsion molle qui se refait repousser en boucle par l'input
      // du joueur (perçu comme un rebond/tremblement).
      if (a.ownerId && a.ownerId === b.ownerId) {
        if (!tryMerge(world, a, b)) applyRepulsion(a, b, true);
        return;
      }

      // Deux morceaux de joueurs différents : absorption PROGRESSIVE si avantage de masse (voir
      // handleEatAttempt), TOUJOURS combinée à une répulsion molle — correctif d'une régression :
      // la répulsion était auparavant désactivée dès qu'un avantage de masse existait (même
      // infime), pour toute la durée (désormais longue, "progressive") de l'absorption ; sans
      // aucune force de séparation pendant tout ce temps, deux joueurs de masse différente (le cas
      // quasi général) pouvaient se traverser librement (régression signalée : "on peut passer à
      // travers les joueurs"). La répulsion continue de séparer les deux morceaux chaque tick — le
      // chevauchement qui alimente l'absorption ne vient donc que du rattrapage réel de
      // l'attaquant (une vraie poursuite), jamais d'un contact figé sans résistance.
      if (!handleEatAttempt(world, a, b, dt)) handleEatAttempt(world, b, a, dt);
      applyRepulsion(a, b);
    },
  };
}
