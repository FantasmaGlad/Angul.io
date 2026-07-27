import { add, distance, normalize, scale, sub, type Vector2 } from '@angulio/shared';
import type { Entity, PlayerId } from '../types.js';
import type { World } from '../world.js';
import type { BotProfileKind } from './botTypes.js';

export interface BotStateMemory {
  lastWanderAngle?: number;
}

export function computeBotInput(
  world: World,
  botPlayerId: PlayerId,
  profile: BotProfileKind,
  memory: BotStateMemory = {},
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

  // Interrogation broad-phase des entités environnantes dans un rayon de 500px
  const nearbyIds = world.spatialHash.queryRadius(center, 500);

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
      if (entity.mass >= totalMass * 1.05) {
        predators.push(entity);
      } else if (entity.mass <= totalMass * 0.8) {
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
      // Périmètre vision : 450px. Cherche prédateurs à < 350px.
      const closePredators = predators.filter((p) => distance(center, p.position) <= 350);
      if (closePredators.length > 0) {
        // Fuite : s'éloigne du barycentre des prédateurs
        let predCenterSum: Vector2 = { x: 0, y: 0 };
        for (const p of closePredators) predCenterSum = add(predCenterSum, p.position);
        const predCenter = scale(predCenterSum, 1 / closePredators.length);
        const awayVec = sub(center, predCenter);
        targetDir = normalize(awayVec);
        intensity = 1.0;
      } else {
        // Cherche la nourriture la plus proche
        const nearestFood = findNearest(center, food);
        if (nearestFood) {
          targetDir = normalize(sub(nearestFood.position, center));
          intensity = 0.5;
        } else {
          targetDir = getWanderDir(center, mapSize, memory);
          intensity = 0.5;
        }
      }
      split = false;
      break;
    }

    case 'neutre': {
      // Prudence si prédateur à < 150px
      const closePredator = predators.find((p) => distance(center, p.position) <= 150);
      if (closePredator) {
        targetDir = normalize(sub(center, closePredator.position));
        intensity = 0.8;
      } else {
        // Focus sur nourriture
        const nearestFood = findNearest(center, food);
        if (nearestFood) {
          targetDir = normalize(sub(nearestFood.position, center));
          intensity = 0.7;
        } else {
          targetDir = getWanderDir(center, mapSize, memory);
          intensity = 0.6;
        }
      }
      split = false;
      break;
    }

    case 'agressif': {
      // Fuite si prédateur très menaçant à < 200px
      const threat = predators.find((p) => distance(center, p.position) <= 200);
      if (threat) {
        targetDir = normalize(sub(center, threat.position));
        intensity = 1.0;
      } else {
        // Recherche de la meilleure proie
        const targetPrey = findBestPrey(center, prey);
        if (targetPrey) {
          const distToPrey = distance(center, targetPrey.position);
          const preyVel = targetPrey.velocity ?? { x: 0, y: 0 };
          const predictedPos = add(targetPrey.position, scale(preyVel, 0.3));

          targetDir = normalize(sub(predictedPos, center));
          intensity = 1.0;

          // Seuil de Split Létal : dist <= 300px et masse / 2 >= 1.15 * cible
          if (distToPrey <= 300 && totalMass / 2 >= targetPrey.mass * 1.15) {
            split = true;
          }
        } else {
          // Nourriture si pas de proie
          const nearestFood = findNearest(center, food);
          if (nearestFood) {
            targetDir = normalize(sub(nearestFood.position, center));
            intensity = 0.9;
          } else {
            targetDir = getWanderDir(center, mapSize, memory);
            intensity = 0.9;
          }
        }
      }
      break;
    }

    case 'fou': {
      // 10% chance pause
      if (Math.random() < 0.1) {
        intensity = 0.0;
        targetDir = { x: 0, y: 0 };
      } else {
        intensity = Math.random() * 0.8 + 0.2;
        targetDir = getWanderDir(center, mapSize, memory, 0.8);
      }

      // 5% chance split intempestif si masse > 40
      if (totalMass >= 40 && Math.random() < 0.05) {
        split = true;
      }
      break;
    }
  }

  // Évite d'avancer dans le mur si trop près des bordures
  const margin = 200;
  if (center.x < margin && targetDir.x < 0) targetDir.x = 1;
  if (center.x > mapSize - margin && targetDir.x > 0) targetDir.x = -1;
  if (center.y < margin && targetDir.y < 0) targetDir.y = 1;
  if (center.y > mapSize - margin && targetDir.y > 0) targetDir.y = -1;

  // Calcul du point de destination dans le monde (ex: 500px devant le bot)
  const targetWorldPos: Vector2 = add(center, scale(normalize(targetDir), 500));

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
  let angle = memory.lastWanderAngle ?? Math.random() * Math.PI * 2;
  angle += (Math.random() - 0.5) * maxDev;
  memory.lastWanderAngle = angle;

  return {
    x: Math.cos(angle),
    y: Math.sin(angle),
  };
}
