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
  restingDistanceForOverlap,
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
  absorptionDurationSec,
  applyPassiveDecay,
  accelerationForMass,
  decelerationForMass,
  eatOverlapFraction,
  ejectEnabled,
  foodTargetCount,
  randomFoodMass,
  splitEnabled,
  velocityForMass,
} from './physics.js';
import { pieceState } from './pieceState.js';

/** Masse résiduelle (px, en unités de masse) en-dessous de laquelle une cible en cours
 * d'absorption (voir `beginConsumption`) est retirée entièrement plutôt que de laisser traîner un
 * reliquat quasi nul — le drain est linéaire (voir `advanceConsumptions`) mais un dernier tick
 * peut ne pas tomber exactement sur 0 selon `dt`. */
const ABSORPTION_REMOVE_FLOOR = 0.5;

/** Amorce l'absorption d'un morceau dont le seuil de recouvrement vient d'être franchi —
 * n'effectue AUCUN transfert de masse elle-même, seulement une marque posée sur `target` (voir
 * `ParametricPieceState.consumedBy`), consommée ensuite tick après tick par
 * `advanceConsumptions` (interne à `createParametricMod`, mais qui s'applique à TOUT morceau
 * marqué quel que soit le mod appelant — voir mods/hardcore/index.ts, qui appelle cette fonction
 * avec son propre `massGainMultiplier`). Sans effet si `target` est déjà en cours d'absorption
 * (ne réinitialise jamais `massAtStart`/`gainMultiplier` une fois posés — l'issue est scellée). */
export function beginConsumption(target: Entity, attackerPieceId: string, gainMultiplier = 1): void {
  const state = pieceState(target);
  if (state.consumedBy) return;
  state.consumedBy = { attackerPieceId, massAtStart: target.mass, gainMultiplier };
}

/** Crédite `amount` à `attacker` (masse + XP + reset de son propre délai de grâce de decay) —
 * factorisé (niveau module, pas seulement interne au mod paramétrique) car appelé aussi bien pour
 * une tranche de drain (`advanceConsumptions`) que pour un transfert instantané (Blob Dieu), par
 * Vanilla ET Hardcore. */
export function creditAttacker(world: World, attacker: Entity, amount: number): void {
  world.setMass(attacker, attacker.mass + amount);
  pieceState(attacker).timeSinceLastEatenS = 0;
  creditMassEatenXp(world, attacker.ownerId, amount, performance.now());
}

/** Clôture une absorption terminée (masse déjà entièrement créditée, via `creditAttacker`,
 * incrémentalement pour un drain ou en un coup pour Blob Dieu) : journal, écran de mort
 * personnalisé, retrait du monde, bonus XP fixe. `totalMassEaten` sert uniquement au journal
 * (`player_eaten`), pas à un nouveau crédit de masse. `attacker` peut être `undefined` si le
 * morceau qui absorbait a disparu en cours de route (fusion, mort...) — la victime disparaît
 * quand même, simplement sans que personne n'en soit crédité. Niveau module (comme
 * `creditAttacker`) pour être réutilisée par Hardcore sans dupliquer cette logique. */
export function finalizeConsumedEntity(
  world: World,
  attacker: Entity | undefined,
  target: Entity,
  totalMassEaten: number,
): void {
  if (attacker && attacker.ownerId && target.ownerId) {
    const attackerPlayer = world.getPlayer(attacker.ownerId);
    const targetPlayer = world.getPlayer(target.ownerId);
    logEvent('player_eaten', {
      attackerId: attacker.ownerId,
      attackerNickname: attackerPlayer?.nickname ?? attacker.ownerId,
      victimId: target.ownerId,
      victimNickname: targetPlayer?.nickname ?? target.ownerId,
      mass: Math.floor(totalMassEaten),
    });
    // Écran de mort personnalisé ("Éliminé par : X") — voir World.recordAttacker.
    world.recordAttacker(target.ownerId, attacker.ownerId);
  }
  world.removeEntity(target.id);
  if (attacker?.ownerId) creditPlayerEatenXp(world, attacker.ownerId, performance.now());
}

const FALLBACK_DIRECTION: Vector2 = { x: 1, y: 0 };
/** Rayon (px monde) autour de la cible du curseur en-deçà duquel `inputVectorOf` n'applique plus
 * aucune force de pilotage — voir son commentaire (élimine l'instabilité de normalisation d'un
 * vecteur quasi nul, seule vraiment visible via la prédiction locale du client). */
const TARGET_DEAD_ZONE_PX = 3;

/** Éjection de masse (demande utilisateur, touche configurable — `config.eject.amount`) : un
 * morceau ne peut éjecter que s'il pèse au moins CE multiple de la masse envoyée (demande
 * utilisateur : "impossible d'envoyer de la masse si le joueur est plus petit de 4x la masse
 * d'envoi") — jamais un pourcentage réglable par mode, une règle fixe indépendante de
 * `config.eject.amount`. */
const EJECT_MIN_MASS_MULTIPLIER = 4;
/** Anti-spam (pas une mécanique de jeu réglable) : une touche maintenue/répétition clavier OS ne
 * doit pas vider la masse d'un morceau en une fraction de seconde. */
const EJECT_COOLDOWN_SECONDS = 0.15;
/** Vitesse initiale (px/s) de la particule éjectée — assez pour un vrai "jet" visible, freiné
 * ensuite par `EJECT_FRICTION_PER_SEC` (voir `onTick`) jusqu'à l'arrêt. */
const EJECT_LAUNCH_SPEED_PX_PER_S = 900;
/** Coefficient de frottement (1/s) appliqué UNIQUEMENT aux particules à vélocité non nulle (voir
 * `onTick`) — la nourriture normale a toujours une vélocité nulle à son spawn, ce frottement n'a
 * donc d'effet que sur les particules volontairement lancées (éjection de masse), qui doivent
 * ralentir jusqu'à l'arrêt plutôt que dériver indéfiniment à vitesse constante (rien d'autre ne
 * freine une particule). */
const EJECT_FRICTION_PER_SEC = 4;

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
/** Distance de repos par défaut (séparation complète, chevauchement nul) — voir `restDistance`
 * de `applyRepulsion`. */
function fullSeparationDistance(a: Entity, b: Entity): number {
  return a.radius + b.radius;
}

/** Fraction de la pénétration réellement corrigée EN UN SEUL TICK (le reste se résorbe sur les
 * ticks suivants) — voir `applyRepulsion`. Une résolution à 100% (valeur historique) compose mal
 * quand un même morceau appartient à PLUSIEURS paires en chevauchement le même tick (ex. beaucoup
 * de morceaux qui se regroupent en même temps pour fusionner) : chaque paire déplace une position
 * déjà décalée par la paire précédente CE MÊME tick, sans plafond, donc le déplacement cumulé d'un
 * morceau peut dépasser de loin la pénétration réelle d'une seule paire — visible côté client comme
 * une "explosion" (saut de position > 200px entre deux snapshots, voir `smoothMap` de
 * renderEngine.ts, qui bascule alors sur un snap instantané au lieu d'un lissage). Amortir la
 * correction lisse ce cumul sur quelques ticks (~100-150ms à 30Hz, imperceptible en soi) plutôt que
 * de résoudre un chevauchement profond d'un coup. */
const REPULSION_CORRECTION_FACTOR = 0.3;

export function applyRepulsion(
  a: Entity,
  b: Entity,
  hard = false,
  restDistance: number = fullSeparationDistance(a, b),
): void {
  const d = distance(a.position, b.position);
  const penetration = restDistance - d;
  if (penetration <= 0) return;

  const dir = d > 0 ? scale(sub(a.position, b.position), 1 / d) : FALLBACK_DIRECTION;
  const totalMass = a.mass + b.mass;
  const correction = penetration * REPULSION_CORRECTION_FACTOR;
  const moveA = correction * (b.mass / totalMass);
  const moveB = correction * (a.mass / totalMass);

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
   *
   * `intensity` (contrôle analogique, voir `PlayerInput.intensity`) est forcée à 1 dès qu'un
   * joueur a plus d'un morceau : elle est dérivée côté client de la distance souris↔CENTRE ÉCRAN
   * (voir input.ts `CONTROL_RADIUS_PX`), et l'écran est centré sur le BARYCENTRE des morceaux du
   * joueur — placer le curseur "au milieu" pour regrouper ses morceaux après un split (l'intuition
   * naturelle, et le comportement demandé) donnait donc une intensité quasi nulle à chaque morceau
   * individuellement distant de ce barycentre, malgré une direction de convergence parfaitement
   * valide : les morceaux ne bougeaient quasiment pas au lieu de converger à pleine vitesse. Le
   * contrôle analogique fin ne garde son sens que pour un morceau unique (le curseur est alors
   * proche de SA position, pas d'un barycentre distinct).
   */
  function inputVectorOf(world: World, piece: Entity): { direction: Vector2; intensity: number; accelIntensity: number } {
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
    const hasMultiplePieces = piece.ownerId !== undefined && world.getPiecesByOwner(piece.ownerId).length > 1;
    const intensity = hasMultiplePieces ? 1 : state.inputIntensity;
    return { direction: scale(offset, 1 / dist), intensity, accelIntensity: 1 };
  }

  /** Divise un morceau en deux (masse restante m/2, éjecté = m/2 * eta_W — metriques.md §9,
   * généralisé par `config.split.ejectEfficiency`). */
  function trySplitPiece(world: World, playerId: PlayerId, piece: Entity): void {
    if (!splitEnabled(config)) return;
    if (piece.mass < config.player.minSplitMass) return;
    if (world.getPiecesByOwner(playerId).length >= config.player.maxSplits) return;

    const half = piece.mass / 2;
    const { direction: dir } = inputVectorOf(world, piece); // le split ignore l'intensité, toujours "plein"

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

  /** Éjection de masse (demande utilisateur) : recrache une particule de masse fixe
   * (`config.eject.amount`) dans la direction visée — une simple particule de nourriture
   * (`world.spawnParticle`), mangeable par n'importe qui, y compris un adversaire, pas un morceau
   * possédé comme le split. Refuse en silence (pas d'erreur envoyée au client) sous
   * `EJECT_MIN_MASS_MULTIPLIER × amount` ou pendant le cooldown anti-spam — un input "eject" qui
   * ne peut pas aboutir ce tick-ci est simplement ignoré, comme un split en-dessous de
   * `minSplitMass`. */
  function tryEjectMass(world: World, piece: Entity): void {
    if (!ejectEnabled(config)) return;
    const state = pieceState(piece);
    if (state.ejectCooldownS > 0) return;

    const amount = config.eject.amount;
    if (piece.mass < amount * EJECT_MIN_MASS_MULTIPLIER) return;

    const { direction: dir } = inputVectorOf(world, piece); // l'éjection ignore l'intensité, toujours "pleine"

    world.setMass(piece, piece.mass - amount);
    state.ejectCooldownS = EJECT_COOLDOWN_SECONDS;

    const ejectedPosition = add(piece.position, scale(dir, piece.radius + 5));
    const ejected = world.spawnParticle(ejectedPosition, amount);
    ejected.velocity = scale(dir, EJECT_LAUNCH_SPEED_PX_PER_S);
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

    const dist = distance(a.position, b.position);
    if (dist <= a.radius + b.radius + 1.0) {
      world.mergeEntities(a, b);
      return true;
    }
    return false;
  }

  /** Blob Dieu (§4.5 cahier_des_charges_admin.md) : invincibilité + "manger n'importe quelle
   * entité" — vérifié ici (seul point de décision d'avantage de masse, utilisé pour l'absorption
   * ET la répulsion) plutôt que dupliqué à chaque appelant. */
  function hasMassAdvantage(attacker: Entity, target: Entity): boolean {
    if (isGodPlayerId(target.ownerId)) return false;
    if (isGodPlayerId(attacker.ownerId)) return true;
    return attacker.mass > target.mass;
  }

  /** Décision d'absorption (avantage de masse + chevauchement suffisant, voir
   * `config.eating.eatOverlapFraction`/`eatOverlapFraction()`, physics.ts) — tant que ce seuil
   * n'est pas franchi, `target` reste librement chevauchable, sans aucun effet (demande
   * utilisateur : "comme sur le vrai agar.io"). Une fois franchi, la masse est transférée
   * PROGRESSIVEMENT sur `config.eating.absorptionDurationSec` (voir `beginConsumption`/
   * `advanceConsumptions` plus bas) plutôt qu'en un seul tick — un transfert instantané faisait
   * disparaître la cible en un temps trop court pour être perçu (~33ms à 30Hz dès que l'écart de
   * masse est important, voir l'audit ayant motivé ce correctif), donnant l'impression d'être
   * mangé "sans comprendre pourquoi". Exception : Blob Dieu (§4.5 cahier_des_charges_admin.md)
   * mange toujours instantanément — outil admin, pas une mécanique de jeu régulière.
   *
   * Retourne `true` si une absorption a débuté ou est en cours ce tick — `onCollision` s'en sert
   * pour savoir s'il doit à la place repousser les deux morceaux (aucun avantage de masse). */
  function handleEatAttempt(world: World, attacker: Entity, target: Entity): boolean {
    if (pieceState(target).consumedBy) return true; // déjà engagée, voir advanceConsumptions

    if (!hasMassAdvantage(attacker, target)) return false;

    // Distance minimale sur tout le trajet du tick (pas seulement la position de FIN de tick,
    // voir World.sweptMinDistance) : sans ce minimum, un attaquant rapide (Dash, gros morceau
    // lancé après un split) qui traverse ENTIÈREMENT sa cible en un seul tick peut déjà l'avoir
    // dépassée au moment où cette fonction s'exécute — la distance de fin de tick redevient
    // grande, l'aire de recouvrement retombe à 0, et la cible n'est jamais mangée malgré un
    // passage à travers parfaitement réel (retour utilisateur : "manger les joueurs" peu réactif
    // à haute vitesse). `findOverlappingPairs` détecte déjà cette paire via sa passe tunneling
    // (sinon `onCollision` ne serait jamais appelé pour elle), mais ne fait que DÉTECTER la
    // proximité — la décision de manger, elle, recalculait sa propre distance indépendamment.
    const dist = Math.min(
      distance(attacker.position, target.position),
      world.sweptMinDistance(attacker, target),
    );
    const overlap = circleOverlapArea(attacker.radius, target.radius, dist);
    if (overlap <= 0) return false;

    // Même convention d'aire que `circleOverlapArea` (voir shared/geometry.ts) — les deux
    // valeurs doivent partager la même unité pour que leur ratio soit une vraie fraction ∈ [0,1].
    const targetArea = PI * target.radius * target.radius;
    const overlapFraction = targetArea > 0 ? clamp(overlap / targetArea, 0, 1) : 1;

    if (overlapFraction < eatOverlapFraction(config)) return false;

    if (isGodPlayerId(attacker.ownerId)) {
      const massEaten = target.mass;
      creditAttacker(world, attacker, massEaten);
      finalizeConsumedEntity(world, attacker, target, massEaten);
      return true;
    }

    beginConsumption(target, attacker.id);
    return true;
  }

  /** Fait avancer chaque absorption en cours (voir `beginConsumption`) : draine une fraction
   * CONSTANTE de `massAtStart` par seconde (indépendante de la masse restante, donc un rythme
   * régulier plutôt qu'une décroissance exponentielle qui traînerait en fin de vie) jusqu'à
   * extinction, puis finalise. Tourne pour tout morceau marqué quel que soit le mod qui a posé la
   * marque : Hardcore délègue toujours son `onTick` à celui du mod paramétrique en premier (voir
   * mods/hardcore/index.ts), donc ses propres cibles sont drainées ici aussi — un seul point
   * d'implémentation du "temps qu'il faut pour manger quelqu'un", jamais dupliqué par mod. */
  function advanceConsumptions(world: World, dt: number): void {
    const duration = absorptionDurationSec(config);
    for (const entity of world.allEntities()) {
      if (entity.kind !== 'piece') continue;
      const consumption = pieceState(entity).consumedBy;
      if (!consumption) continue;

      const attacker = world.getEntity(consumption.attackerPieceId);
      const drainThisTick = Math.min(entity.mass, (consumption.massAtStart / duration) * dt);
      if (attacker) creditAttacker(world, attacker, drainThisTick * consumption.gainMultiplier);

      const remainingMass = entity.mass - drainThisTick;
      if (remainingMass <= ABSORPTION_REMOVE_FLOOR) {
        finalizeConsumedEntity(world, attacker, entity, consumption.massAtStart);
      } else {
        world.setMass(entity, remainingMass);
      }
    }
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

      if (input.eject) {
        for (const piece of pieces) tryEjectMass(world, piece);
      }
    },

    onTick(world: World, dt: number) {
      for (const entity of world.allEntities()) {
        if (entity.kind !== 'piece') {
          // Frottement des particules éjectées (éjection de masse) — la nourriture normale a
          // toujours une vélocité nulle à son spawn, ce frottement n'a donc d'effet que sur les
          // particules volontairement lancées, qui doivent ralentir jusqu'à l'arrêt plutôt que
          // dériver indéfiniment (voir `EJECT_FRICTION_PER_SEC`, rien d'autre ne freine une
          // particule).
          if (entity.velocity.x !== 0 || entity.velocity.y !== 0) {
            entity.velocity = scale(entity.velocity, Math.max(0, 1 - EJECT_FRICTION_PER_SEC * dt));
          }
          continue;
        }

        const state = pieceState(entity);
        state.splitElapsedS += dt;
        state.timeSinceLastEatenS += dt;
        state.foodEatenThisTick = 0;
        state.ejectCooldownS = Math.max(0, state.ejectCooldownS - dt);

        const { direction, intensity, accelIntensity } = inputVectorOf(world, entity);
        // Le curseur proche du centre donne un contrôle fin (faible intensité) ; loin, le
        // plein régime — vitesse cible ET taux d'accélération sont réduits de concert, SAUF dans
        // la zone morte (intensity=0, accelIntensity=1) où l'on garde l'accélération pleine pour
        // décélérer réellement la vélocité résiduelle vers 0 (voir inputVectorOf).
        const targetVelocity = scale(direction, velocityForMass(entity.mass, config) * intensity);
        // Freinage (vitesse cible < vitesse actuelle, ex. relâchement de l'input) vs mise en
        // mouvement (vitesse cible >= vitesse actuelle) : deux taux DISTINCTS depuis le cahier des
        // charges §4a ("que le blob ralentisse moins vite en fonction de sa masse") — un gros blob
        // reste aussi réactif qu'avant pour accélérer, mais conserve désormais nettement plus son
        // élan en freinant (voir `decelerationForMass`/`MovementConfig.decelerationMassExponent`).
        const isDecelerating = length(targetVelocity) < length(entity.velocity);
        const rate = isDecelerating
          ? decelerationForMass(entity.mass, config)
          : accelerationForMass(entity.mass, config);
        const maxChange = rate * accelIntensity * dt;
        entity.velocity = moveToward(entity.velocity, targetVelocity, maxChange);

        const decayedMass = applyPassiveDecay(entity.mass, dt, config, state.timeSinceLastEatenS);
        if (decayedMass !== entity.mass) world.setMass(entity, decayedMass);
      }

      advanceConsumptions(world, dt);

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

      // Deux morceaux du MÊME joueur ("même équipe") : candidats à la fusion
      if (a.ownerId && a.ownerId === b.ownerId) {
        if (!tryMerge(world, a, b)) {
          const targetArea = Math.min(PI * a.radius * a.radius, PI * b.radius * b.radius) * config.merge.overlapMinFraction;
          const restDist = restingDistanceForOverlap(a.radius, b.radius, targetArea);
          applyRepulsion(a, b, true, restDist);
        }
        return;
      }

      // Blob Dieu (§4.5 cahier_des_charges_admin.md) : mange n'importe quelle entité immédiatement sans condition de masse.
      if (isGodPlayerId(a.ownerId) || isGodPlayerId(b.ownerId)) {
        if (hasMassAdvantage(a, b)) handleEatAttempt(world, a, b);
        else if (hasMassAdvantage(b, a)) handleEatAttempt(world, b, a);
        return;
      }

      // Deux morceaux de joueurs différents : le plus gros tente de manger le plus petit dès
      // `config.eating.eatOverlapFraction` de chevauchement. Aucune répulsion entre joueurs.
      if (a.mass > b.mass) {
        handleEatAttempt(world, a, b);
      } else if (b.mass > a.mass) {
        handleEatAttempt(world, b, a);
      }
    },
  };
}
