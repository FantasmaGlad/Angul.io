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
  /** Position du curseur en coordonnées MONDE (pas écran), calculée côté client à partir de sa
   * caméra (centre + zoom, voir client/src/render.ts `Camera`). Le serveur calcule la direction
   * de chaque morceau individuellement vers ce point (`target - position du morceau`) plutôt que
   * de leur appliquer une direction unique : si le curseur est positionné entre plusieurs
   * morceaux du joueur, chacun s'en rapproche indépendamment (regroupement), au lieu que tous
   * partent dans la même direction relative. */
  target: Vector2;
  /** Intensité de contrôle ∈ [0,1] : distance du curseur au centre de l'écran, plafonnée côté
   * client — contrôle "analogique" (fin près du centre, plein régime au-delà d'un certain
   * rayon) plutôt que tout-ou-rien. Indépendante de `target` : ne module que la vitesse/le taux
   * d'accélération, jamais la direction visée. */
  intensity: number;
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

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  isSelf?: boolean;
}

export interface WorldStateMessage {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  leaderboard?: LeaderboardEntry[];
  /** Valeurs propres au destinataire de ce message, jamais partagées avec les autres clients
   * (contrairement à `entities`, diffusé tel quel). */
  self?: {
    /** Taux d'accélération courant (uc/s²) du joueur, pour le panneau de stats (Pseudo/Guilde/
     * Masse/Vitesse). Absent si le mod n'expose pas `getAccelerationForMass` ou si le joueur n'a
     * aucun morceau. */
    accelerationPerSec2?: number;
    /** Combo de joueurs mangés actif (demande utilisateur, voir server/src/engine/xp.ts) — un
     * compteur entier ("Combo x{level}", niveau 1 au premier déclenchement) plutôt que le
     * multiplicateur d'XP décimal réel, plus lisible en gros texte à l'écran. Absent si aucun
     * combo n'est actif pour ce joueur. */
    combo?: { level: number };
  };
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
  /** Couleur du blob de ce joueur (refonte UI/UX, avatar procédural) — choisie par le compte
   * (`players.avatar_color`) ou dérivée du pseudo pour un invité, voir
   * `colorForNickname`/`connectionHandler.ts`. Optionnel côté type pour rester tolérant à un
   * message malformé (voir `render.ts` `colorFor`, repli sur `DEFAULT_BLOB_COLOR`). */
  color?: string;
}

export interface PlayerDiedMessage {
  type: 'died';
}

export type ServerMessage =
  WelcomeMessage | WorldStateMessage | PlayerInfoMessage | PlayerDiedMessage | PongMessage;

/** Codes de fermeture WebSocket applicatifs (plage privée 4000-4999 de la RFC 6455), partagés
 * entre le serveur (net/server.ts, qui ferme la socket avec l'un de ces codes) et le client
 * (GameView.tsx, qui les inspecte dans `CloseEvent.code` pour choisir un message clair) — évite
 * que les deux côtés se resynchronisent "à l'œil" sur des nombres magiques dupliqués. */
export const WS_CLOSE_ROOM_NOT_FOUND = 4004;
export const WS_CLOSE_NICKNAME_TAKEN = 4009;
export const WS_CLOSE_ROOM_FULL = 4010;
export const WS_CLOSE_ROOM_EXPIRED = 4011;
