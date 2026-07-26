import type { Vector2 } from './vector.js';

export type EntityKind = 'particle' | 'piece';

/** Une entrée du snapshot envoyé au client — pas de delta compression au MVP (metriques.md/plan §1.4). */
export interface EntitySnapshot {
  id: string;
  kind: EntityKind;
  x: number;
  y: number;
  radius: number;
  mass: number;
  ownerId?: string;
  ownerNickname?: string;
}

export interface ClientJoinMessage {
  type: 'join';
  nickname: string;
}

export interface ClientInputMessage {
  type: 'input';
  /** Direction normalisée vers le curseur, {0,0} si le joueur ne bouge pas. */
  dir: Vector2;
  /** true uniquement sur le tick où le split est demandé (déclenchement, pas un état maintenu). */
  split: boolean;
}

export type ClientMessage = ClientJoinMessage | ClientInputMessage;

export interface WelcomeMessage {
  type: 'welcome';
  playerId: string;
  mapSize: number;
}

export interface WorldStateMessage {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
}

export interface PlayerDiedMessage {
  type: 'died';
}

export type ServerMessage = WelcomeMessage | WorldStateMessage | PlayerDiedMessage;
