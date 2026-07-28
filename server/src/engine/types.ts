import type { Vector2 } from '@angulio/shared';
import type { LifeStats } from './xp.js';

export type EntityId = string;
export type PlayerId = string;
export type EntityKind = 'particle' | 'piece';

export interface Entity {
  id: EntityId;
  kind: EntityKind;
  position: Vector2;
  velocity: Vector2;
  mass: number;
  radius: number;
  ownerId?: PlayerId;
  /** Sac libre pour l'état propre à un mod (ex: timer de cooldown de fusion, cf. mods/vanilla). */
  data: Record<string, unknown>;
}

export interface PlayerState {
  id: PlayerId;
  nickname: string;
  pieceIds: EntityId[];
  /** Suivi générique par le moteur pour détecter la transition vivant -> mort (voir Room). */
  alive: boolean;
  /** Stats XP/combo de la vie en cours (voir engine/xp.ts) — remises à zéro par net/server.ts au
   * moment où la vie est créditée au compte (`World.resetLifeStats`), jamais par le mod
   * lui-même : le respawn immédiat après une mort recrée un morceau avant que le réseau ait eu
   * la main pour lire le cumul de la vie qui vient de se terminer. */
  lifeStats: LifeStats;
  /** `performance.now()` du (re)spawn courant — sert à calculer `survivalTimeSec` à la mort
   * (écran de mort personnalisé, voir Room.tick). Fixé par `World.addPlayer`. */
  spawnedAtMs: number;
  /** Dernier joueur à avoir mangé un morceau de celui-ci — utilisé pour "Éliminé par : X" côté
   * écran de mort (voir `World.recordAttacker`, `Room.tick`). `undefined` si mort autrement
   * (bords de carte, décor) ou si personne ne l'a jamais mangé cette vie. */
  lastAttackerId?: PlayerId;
}

export interface PlayerInput {
  /** Position visée en coordonnées monde — voir ClientInputMessage (shared/src/protocol.ts). */
  target: Vector2;
  intensity: number;
  split: boolean;
}
