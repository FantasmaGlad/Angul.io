import type { Vector2 } from '@angulio/shared';

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
}

export interface PlayerInput {
  dir: Vector2;
  split: boolean;
}
