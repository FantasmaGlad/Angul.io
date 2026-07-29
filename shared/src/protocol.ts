import type { MovementConfig } from './movement.js';
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
  /** true uniquement sur le tick où le dash est demandé (touche F). */
  dash?: boolean;
  /** true uniquement sur le tick où l'éjection de masse est demandée (demande utilisateur,
   * touche configurable) — voir `config.eject` (server/src/mods/parametric/config.ts). */
  eject?: boolean;
}

/** Mesure de latence réelle (aller-retour), pour l'écran de debug F3 — le serveur renvoie `t`
 * tel quel dans un `pong` dès réception, le client calcule le round-trip lui-même. */
export interface ClientPingMessage {
  type: 'ping';
  t: number;
}

/** Round-trip mesuré côté client à partir de son propre `ping`/`pong` (voir GameView.tsx),
 * rapporté au serveur pour affichage dans l'interface admin ("Salons & Écrans" §3.3
 * cahier_des_charges_admin.md) — le serveur ne mesure pas lui-même la latence, il ne fait que
 * relayer la valeur du client. */
export interface ClientLatencyMessage {
  type: 'latency';
  ms: number;
}

export type ClientMessage =
  | ClientJoinMessage
  | ClientInputMessage
  | ClientPingMessage
  | ClientLatencyMessage;

export interface WelcomeMessage {
  type: 'welcome';
  playerId: string;
  mapSize: number;
  /** Cadence réelle de la boucle de simulation (Hz) — pour l'écran de diagnostic F3, plutôt
   * qu'une valeur supposée côté client (voir server/src/index.ts `TICK_RATE_HZ`). */
  tickRateHz: number;
  /** Modèle de mouvement du mode actif (vitesse/accélération en fonction de la masse, voir
   * shared/src/movement.ts) — permet au client de prédire localement le déplacement de son
   * propre blob avec exactement les mêmes formules que le serveur, sans attendre l'aller-retour
   * réseau (client/src/prediction.ts, plan_performance_reseau.md Phase 1). Envoyé une fois par
   * connexion (join/respawn), pas à chaque tick. */
  movement: MovementConfig;
  /** Identifiant du mode de jeu actif (ex: 'hardcore', 'vanilla') pour la musique et l'UI. */
  modId?: string;
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
    /** Vélocité autoritaire courante de chaque morceau du joueur (voir snapshotBuilder.ts
     * `buildStateMessage`) — utilisée uniquement par la réconciliation locale
     * (client/src/prediction.ts `reconcile`) pour ré-ancrer `predicted.velocity` avant de rejouer
     * l'historique d'inputs, plutôt que de repartir de la vélocité déjà avancée en direct (double
     * comptage de l'accélération sur la fenêtre rejouée, voir fix_vitesse_reseau.md). Volontairement
     * dans `self` (personnalisé par destinataire) et PAS dans `EntitySnapshot`/`entities` (diffusé à
     * tous les viewers d'un salon) : la vélocité n'est utile qu'au client qui possède le morceau, l'ajouter
     * à `entities` coûterait de la bande passante à tous les autres viewers pour rien. Absent si le
     * joueur n'a aucun morceau. */
    pieces?: Array<{ id: string; vx: number; vy: number }>;
    /** État du dash du joueur (mode Hardcore) pour le HUD en haut de l'écran. */
    dash?: {
      charges: number;
      maxCharges: number;
      canDash: boolean;
      rechargeProgress: number;
    };
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

/** Carte d'écran de mort personnalisée par le compte (ou valeurs par défaut pour un invité) —
 * voir `shared/src/deathBanners.ts`. `imageUrl` est réservé à une évolution future (upload
 * Premium, cahier des charges §1) : toujours absent pour l'instant, aucune route ne permet de
 * le renseigner. */
export interface DeathCustomCard {
  message: string;
  bannerId: string;
  imageUrl?: string;
}

export interface PlayerDiedMessage {
  type: 'died';
  /** Pseudo du dernier joueur ayant mangé un morceau de la victime — absent si mort par un bot
   * disparu entre-temps, par la nourriture/les bords, ou par déconnexion. */
  killerNickname?: string;
  /** Masse maximale atteinte pendant cette vie (identique au score déjà utilisé pour
   * `player_best_scores`). */
  finalScore: number;
  survivalTimeSec: number;
  /** XP gagnée pendant cette vie (voir engine/xp.ts) — 0 pour un invité (pas de compte à
   * créditer, mais affiché quand même : la progression "aurait été" gagnée). */
  xpEarned: number;
  customCard: DeathCustomCard;
}

/** Bannière/notification visuelle diffusée par l'admin (§4.6 cahier_des_charges_admin.md,
 * "Diffusion de Messages & Overlays") — affichée au centre de l'écran, `durationMs` plus tard le
 * client la retire de lui-même (pas de message de fin séparé). */
export interface AnnouncementMessage {
  type: 'announcement';
  text: string;
  color: string;
  durationMs: number;
}

/** Transfert forcé vers un autre salon (§3.3, "Changement de salon / Transfert") — le client
 * réagit en fermant sa connexion actuelle et en en ouvrant une nouvelle vers `roomId`, comme s'il
 * avait cliqué "Rejoindre" lui-même (voir GameView.tsx). */
export interface ForceRoomChangeMessage {
  type: 'forceRoomChange';
  roomId: string;
}

export type ServerMessage =
  | WelcomeMessage
  | WorldStateMessage
  | PlayerInfoMessage
  | PlayerDiedMessage
  | PongMessage
  | AnnouncementMessage
  | ForceRoomChangeMessage;

/** Codes de fermeture WebSocket applicatifs (plage privée 4000-4999 de la RFC 6455), partagés
 * entre le serveur (net/server.ts, qui ferme la socket avec l'un de ces codes) et le client
 * (GameView.tsx, qui les inspecte dans `CloseEvent.code` pour choisir un message clair) — évite
 * que les deux côtés se resynchronisent "à l'œil" sur des nombres magiques dupliqués. */
export const WS_CLOSE_ROOM_NOT_FOUND = 4004;
export const WS_CLOSE_NICKNAME_TAKEN = 4009;
export const WS_CLOSE_ROOM_FULL = 4010;
export const WS_CLOSE_ROOM_EXPIRED = 4011;
