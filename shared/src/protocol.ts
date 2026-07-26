import type { Vector2 } from './vector.js';

/** 'f' = particule de nourriture, 'c' = morceau de joueur ("creature"). Codes courts : ce champ
 * est répété pour chaque entité à chaque tick (voir plan Lot 1.8, bande passante). */
export type WireEntityKind = 'f' | 'c';

/**
 * Une entrée du snapshot envoyé au client, à chaque tick, pour chaque entité visible.
 * Champs volontairement courts (`i`, `k`, `r`, `m`, `p`) — mesuré au Lot 1.8 : avec des UUID et
 * des noms de clé longs, la diffusion d'état complet à 50 joueurs coûtait ~387 Mbit/s d'upload
 * serveur. Pas de delta compression ni d'interest management pour autant (différés, voir plan
 * §1.4) — seulement une sérialisation moins verbeuse.
 */
export interface EntitySnapshot {
  /** Identifiant court (pas un UUID — voir World/server.ts). */
  i: string;
  k: WireEntityKind;
  x: number;
  y: number;
  r: number;
  m: number;
  /** Identifiant court du joueur propriétaire, absent pour la nourriture. */
  p?: string;
}

export interface ClientJoinMessage {
  type: 'join';
  nickname: string;
}

export interface ClientInputMessage {
  type: 'input';
  /** Direction ET intensité vers le curseur : la norme (∈ [0,1], clampée côté client) code
   * l'intensité — contrôle "analogique" plutôt que tout-ou-rien ({0,0} si le curseur est au
   * centre de l'écran). */
  dir: Vector2;
  /** true uniquement sur le tick où le split est demandé (déclenchement, pas un état maintenu). */
  split: boolean;
}

/** Mesure de latence réelle (aller-retour), pour l'écran de debug F3 — le serveur renvoie `t`
 * tel quel dans un `pong` dès réception, le client calcule le round-trip lui-même. */
export interface ClientPingMessage {
  type: 'ping';
  t: number;
}

export type ClientMessage = ClientJoinMessage | ClientInputMessage | ClientPingMessage;

export interface WelcomeMessage {
  type: 'welcome';
  playerId: string;
  mapSize: number;
}

export interface WorldStateMessage {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  /** Valeurs propres au destinataire de ce message, jamais partagées avec les autres clients
   * (contrairement à `entities`, diffusé tel quel) — pour l'instant seulement le taux
   * d'accélération courant (uc/s²) du joueur, pour le panneau de stats (Pseudo/Guilde/Masse/
   * Vitesse/Accélération). Absent si le mod n'expose pas `getAccelerationForMass` ou si le
   * joueur n'a aucun morceau. */
  self?: { accelerationPerSec2: number };
}

/** Réponse immédiate à un `ping` (voir ClientPingMessage). */
export interface PongMessage {
  type: 'pong';
  t: number;
}

/** Envoyé une fois par joueur (à sa connexion, et rétroactivement à tout nouvel arrivant pour les
 * joueurs déjà présents) plutôt que répété sur chaque entité à chaque tick (Lot 1.8). */
export interface PlayerInfoMessage {
  type: 'player';
  playerId: string;
  nickname: string;
}

export interface PlayerDiedMessage {
  type: 'died';
}

export type ServerMessage =
  WelcomeMessage | WorldStateMessage | PlayerInfoMessage | PlayerDiedMessage | PongMessage;
