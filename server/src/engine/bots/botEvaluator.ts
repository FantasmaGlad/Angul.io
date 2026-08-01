import { add, distance, normalize, scale, sub, type Vector2 } from '@angulio/shared';
import type { Entity, PlayerId } from '../types.js';
import type { World } from '../world.js';
import { DEFAULT_BOT_BEHAVIOR_CONFIG, type BotBehaviorConfig } from './behaviorConfig.js';
import type { BotProfileKind } from './botTypes.js';

export interface BotStateMemory {
  lastWanderAngle?: number;
  lastDir?: Vector2;
  lastSplitAtMs?: number;
  /** Horodatage (`performance.now()`) depuis lequel ce bot est resté "contre" un mur en continu
   * (voir `WALL_STUCK_FACTOR_THRESHOLD`/`WALL_STUCK_MAX_MS` ci-dessous) — `undefined` tant qu'il
   * n'y est pas collé. Remis à zéro dès qu'il s'en écarte suffisamment. */
  wallStuckSinceMs?: number;
}

/** Seuil de `wallFactor` (0 loin du mur, 1 collé dessus) au-delà duquel un bot est considéré
 * "contre" le mur pour la mesure de temps ci-dessous — pas 1.0 strictement : un bot déjà très
 * proche du bord souffre du même frottement visuel qu'un bot qui le touche exactement. */
const WALL_STUCK_FACTOR_THRESHOLD = 0.6;
/** Durée maximale (ms) qu'un bot peut rester "contre" un mur avant que ce module ne force son
 * échappée (retour utilisateur : "il faut qu'ils évitent de rester contre un mur trop longtemps,
 * 2 secondes max") — voir le commentaire d'en-tête du mélange `wallFactor` plus bas : ce mélange
 * pointe déjà dans la bonne direction dès que `wallFactor > 0`, mais le lissage de direction
 * (`directionSmoothing`, EMA à chaque ÉVALUATION, pas chaque tick) combiné à la cadence
 * d'évaluation "ambiante" des bots (2 Hz par défaut, `updateFrequencyHz`, botManager.ts) fait que
 * converger d'un cap pointant DANS le mur vers un cap pointant à l'opposé prend en pratique
 * plusieurs SECONDES (~4s mesuré à 2Hz/0.25 de lissage) avant que le bot ne s'en écarte
 * franchement — largement au-dessus de ce qu'un spectateur perçoit comme "un bot qui évite les
 * murs". Passé ce délai, l'échappée COURT-CIRCUITE le lissage habituel (voir plus bas) : direction
 * imposée directement à `away`, intensité maximale, jusqu'à ce que le bot quitte la zone de marge. */
const WALL_STUCK_MAX_MS = 2000;

export function computeBotInput(
  world: World,
  botPlayerId: PlayerId,
  profile: BotProfileKind,
  memory: BotStateMemory = {},
  behavior: BotBehaviorConfig = DEFAULT_BOT_BEHAVIOR_CONFIG,
): { input: { target: Vector2; intensity: number; split: boolean }; memory: BotStateMemory } {
  const defaultInput = {
    input: { target: { x: 0, y: 0 }, intensity: 0, split: false },
    memory,
  };

  const player = world.getPlayer(botPlayerId);
  if (!player || player.pieceIds.length === 0) {
    return defaultInput;
  }

  // Récupère toutes les pièces du bot
  const botPieces: Entity[] = [];
  let totalMass = 0;
  let centerSum: Vector2 = { x: 0, y: 0 };

  for (const pieceId of player.pieceIds) {
    const piece = world.getEntity(pieceId);
    if (piece) {
      botPieces.push(piece);
      totalMass += piece.mass;
      centerSum = add(centerSum, piece.position);
    }
  }

  if (botPieces.length === 0) return defaultInput;

  const center: Vector2 = scale(centerSum, 1 / botPieces.length);
  const mapSize = world.mapSize;

  // Interrogation broad-phase des entités environnantes
  const nearbyIds = world.spatialHash.queryRadius(center, behavior.neighborQueryRadiusPx);

  const predators: Entity[] = [];
  const prey: Entity[] = [];
  const food: Entity[] = [];

  for (const id of nearbyIds) {
    const entity = world.getEntity(id);
    if (!entity) continue;

    // Ignorer ses propres morceaux
    if (entity.kind === 'piece' && entity.ownerId === botPlayerId) continue;

    if (entity.kind === 'particle') {
      food.push(entity);
    } else if (entity.kind === 'piece' && entity.ownerId) {
      // Autre morceau de joueur
      if (entity.mass >= totalMass * behavior.predatorMassRatio) {
        predators.push(entity);
      } else if (entity.mass <= totalMass * behavior.preyMassRatio) {
        prey.push(entity);
      }
    }
  }

  // --- Logique propre à chaque profil ---
  let targetDir: Vector2 = { x: 0, y: 0 };
  let intensity = 1.0;
  let split = false;

  const effectiveProfile = profile === 'challenger' ? 'agressif' : profile;

  switch (effectiveProfile) {
    case 'fuis': {
      const cfg = behavior.fuis;
      const closePredators = predators.filter((p) => distance(center, p.position) <= cfg.predatorRadiusPx);
      if (closePredators.length > 0) {
        // Fuite : s'éloigne du barycentre des prédateurs
        let predCenterSum: Vector2 = { x: 0, y: 0 };
        for (const p of closePredators) predCenterSum = add(predCenterSum, p.position);
        const predCenter = scale(predCenterSum, 1 / closePredators.length);
        const awayVec = sub(center, predCenter);
        targetDir = normalize(awayVec);
        intensity = cfg.fleeIntensity;
      } else {
        // Cherche la nourriture la plus proche
        const nearestFood = findNearest(center, food);
        if (nearestFood) {
          targetDir = normalize(sub(nearestFood.position, center));
          intensity = cfg.foodSeekIntensity;
        } else {
          targetDir = getWanderDir(center, mapSize, memory);
          intensity = cfg.wanderIntensity;
        }
      }
      split = false;
      break;
    }

    case 'neutre': {
      const cfg = behavior.neutre;
      const closePredator = predators.find((p) => distance(center, p.position) <= cfg.predatorRadiusPx);
      if (closePredator) {
        targetDir = normalize(sub(center, closePredator.position));
        intensity = cfg.cautionIntensity;
      } else {
        // Focus sur nourriture
        const nearestFood = findNearest(center, food);
        if (nearestFood) {
          targetDir = normalize(sub(nearestFood.position, center));
          intensity = cfg.foodSeekIntensity;
        } else {
          targetDir = getWanderDir(center, mapSize, memory);
          intensity = cfg.wanderIntensity;
        }
      }
      split = false;
      break;
    }

    case 'agressif': {
      const cfg = behavior.agressif;
      const threat = predators.find((p) => distance(center, p.position) <= cfg.threatRadiusPx);
      if (threat) {
        targetDir = normalize(sub(center, threat.position));
        intensity = cfg.fleeIntensity;
      } else {
        // Recherche de la meilleure proie
        const targetPrey = findBestPrey(center, prey);
        if (targetPrey) {
          const distToPrey = distance(center, targetPrey.position);
          const preyVel = targetPrey.velocity ?? { x: 0, y: 0 };
          const predictedPos = add(targetPrey.position, scale(preyVel, cfg.preyPredictionSeconds));

          targetDir = normalize(sub(predictedPos, center));
          intensity = cfg.chaseIntensity;

          // Seuil de Split Létal : uniquement si le bot a 1 seul morceau, dist <= threatRadiusPx
          // et cooldown écoulé.
          const now = performance.now();
          const cooldownOk =
            memory.lastSplitAtMs === undefined || now - memory.lastSplitAtMs >= cfg.splitCooldownMs;
          if (
            botPieces.length < 2 &&
            cooldownOk &&
            distToPrey <= cfg.threatRadiusPx &&
            totalMass / 2 >= targetPrey.mass * cfg.splitMassMultiplier
          ) {
            split = true;
            memory.lastSplitAtMs = now;
          }
        } else {
          // Nourriture si pas de proie
          const nearestFood = findNearest(center, food);
          if (nearestFood) {
            targetDir = normalize(sub(nearestFood.position, center));
            intensity = cfg.foodSeekIntensity;
          } else {
            targetDir = getWanderDir(center, mapSize, memory);
            intensity = cfg.wanderIntensity;
          }
        }
      }
      break;
    }

    case 'fou': {
      const cfg = behavior.fou;
      if (Math.random() < cfg.pauseChance) {
        intensity = 0.0;
        targetDir = { x: 0, y: 0 };
      } else {
        intensity = Math.random() * cfg.intensityRange + cfg.intensityMin;
        targetDir = getWanderDir(center, mapSize, memory, cfg.wanderMaxDeviation);
      }

      // Split très rare si masse suffisante et cooldown écoulé.
      const now = performance.now();
      const cooldownOk =
        memory.lastSplitAtMs === undefined || now - memory.lastSplitAtMs >= cfg.splitCooldownMs;
      if (botPieces.length < 2 && cooldownOk && totalMass >= cfg.splitMinMass && Math.random() < cfg.splitChance) {
        split = true;
        memory.lastSplitAtMs = now;
      }
      break;
    }
  }

  // S'éloigne activement des bordures (demande utilisateur : les bots doivent quitter les murs
  // pour dynamiser la partie et éviter le "frottement" visuel — un bot qui reste coincé contre le
  // bord, clampé chaque tick par border.ts pendant que son cap continue de pointer VERS le mur,
  // produit un tremblement/glissement visuel sur place plutôt qu'un vrai demi-tour). L'ancienne
  // version se contentait d'un simple vecteur ADDITIF (`targetDir + push`) : trop faible face à un
  // comportement de profil qui continue de tirer dans la direction opposée (fuite d'un prédateur
  // acculé contre le mur, poursuite d'une proie collée au bord…) — le bot oscillait alors JUSTE au
  // bord, le cap net restant proche de zéro (les deux forces s'annulant), d'où le frottement
  // observé. Remplacé par un MÉLANGE dont le poids (`wallFactor`, 0 loin du mur, 1 collé dessus)
  // fait progressivement DOMINER puis REMPLACER complètement le cap du profil — jamais un ajout
  // qu'une autre force peut annuler, un vrai changement de priorité qui va jusqu'au demi-tour net
  // à mesure que le bot s'approche du bord.
  const margin = behavior.wallAvoidance.marginPx;
  const wallPush: Vector2 = { x: 0, y: 0 };
  let wallFactor = 0;
  if (center.x < margin) {
    const f = (margin - center.x) / margin;
    wallPush.x += f;
    wallFactor = Math.max(wallFactor, f);
  } else if (center.x > mapSize - margin) {
    const f = (center.x - (mapSize - margin)) / margin;
    wallPush.x -= f;
    wallFactor = Math.max(wallFactor, f);
  }
  if (center.y < margin) {
    const f = (margin - center.y) / margin;
    wallPush.y += f;
    wallFactor = Math.max(wallFactor, f);
  } else if (center.y > mapSize - margin) {
    const f = (center.y - (mapSize - margin)) / margin;
    wallPush.y -= f;
    wallFactor = Math.max(wallFactor, f);
  }

  // Mesure du temps passé "contre" le mur (voir WALL_STUCK_MAX_MS) — indépendante de la décision
  // ci-dessous, doit rester à jour même quand `wallFactor` est sous le seuil (bot qui vient de
  // s'écarter : le compteur doit repartir de zéro, pas juste ne plus avancer).
  const nowMs = performance.now();
  if (wallFactor >= WALL_STUCK_FACTOR_THRESHOLD) {
    memory.wallStuckSinceMs ??= nowMs;
  } else {
    memory.wallStuckSinceMs = undefined;
  }
  const wallStuckTooLong =
    memory.wallStuckSinceMs !== undefined && nowMs - memory.wallStuckSinceMs >= WALL_STUCK_MAX_MS;

  let away: Vector2 | undefined;
  if (wallFactor > 0) {
    away = normalize(wallPush);
    const blendedDir = normalize({
      x: targetDir.x * (1 - wallFactor) + away.x * wallFactor,
      y: targetDir.y * (1 - wallFactor) + away.y * wallFactor,
    });
    targetDir = blendedDir.x !== 0 || blendedDir.y !== 0 ? blendedDir : away;
    // Intensité au moins proportionnelle à la proximité du mur : un bot en pause ('fou' à
    // l'arrêt, intensity 0) ou en approche prudente ('neutre', 0.6-0.8) doit tout de même
    // s'écarter franchement plutôt que de dériver lentement pendant que le prochain tick le
    // recolle contre le bord.
    intensity = Math.max(intensity, wallFactor);
  }

  let normDir = normalize(targetDir);
  if (memory.lastDir && (normDir.x !== 0 || normDir.y !== 0)) {
    const lerpRate = behavior.directionSmoothing;
    normDir = normalize({
      x: memory.lastDir.x + (normDir.x - memory.lastDir.x) * lerpRate,
      y: memory.lastDir.y + (normDir.y - memory.lastDir.y) * lerpRate,
    });
  }
  // Passé WALL_STUCK_MAX_MS collé au mur, COURT-CIRCUITE le lissage ci-dessus : celui-ci est
  // exactement ce qui, combiné à la cadence d'évaluation ambiante des bots, fait traîner
  // l'échappée sur plusieurs secondes (voir le commentaire de WALL_STUCK_MAX_MS) — direction
  // imposée directement à `away` (pleine intensité) le temps que le bot quitte la marge, plutôt
  // que de continuer à converger lentement vers elle évaluation après évaluation.
  if (wallStuckTooLong && away) {
    normDir = away;
    intensity = 1;
  }
  memory.lastDir = normDir;

  // Calcul du point de destination dans le monde (loin devant le bot pour que toutes ses pièces
  // gardent la même direction globale).
  const targetWorldPos: Vector2 = add(center, scale(normDir, behavior.targetProjectionDistancePx));

  return {
    input: {
      target: targetWorldPos,
      intensity,
      split,
    },
    memory,
  };
}

function findNearest(from: Vector2, entities: Entity[]): Entity | undefined {
  let minCost = Infinity;
  let best: Entity | undefined;
  for (const e of entities) {
    const d = distance(from, e.position);
    if (d < minCost) {
      minCost = d;
      best = e;
    }
  }
  return best;
}

function findBestPrey(from: Vector2, preyList: Entity[]): Entity | undefined {
  let minCost = Infinity;
  let best: Entity | undefined;
  for (const p of preyList) {
    const d = distance(from, p.position);
    if (d < minCost) {
      minCost = d;
      best = p;
    }
  }
  return best;
}

function getWanderDir(
  center: Vector2,
  mapSize: number,
  memory: BotStateMemory,
  maxDev = 0.3,
): Vector2 {
  let angle = memory.lastWanderAngle ?? Math.random() * 6;
  angle += (Math.random() - 0.5) * maxDev;
  memory.lastWanderAngle = angle;

  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}
