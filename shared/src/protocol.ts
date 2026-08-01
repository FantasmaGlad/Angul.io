import type { MovementConfig } from './movement.js';
import type { Vector2 } from './vector.js';

/** 'f' = particule de nourriture, 'c' = morceau de joueur ("creature"), 'v' = virus. Codes courts : ce champ
 * est répété pour chaque entité à chaque tick (voir plan Lot 1.8, bande passante). */
export type WireEntityKind = 'f' | 'c' | 'v';

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
  /** Identifiant court du joueur propriétaire, absent pour la nourriture et virus. */
  p?: string;
  /** ID du type de virus (1 = Vert, 2 = Rouge, 3 = Bleu). Present uniquement pour k === 'v'. */
  vId?: 1 | 2 | 3;
}

export interface ClientJoinMessage {
  type: 'join';
  nickname: string;
  /** Skin choisi par un invité (compte `localStorage['angulio.guestSkin']`, voir ProfilePage.tsx)
   * — absent pour un compte authentifié, dont le skin vient de la base (`players.avatar_color`,
   * toujours prioritaire côté serveur, voir connectionHandler.ts). Sans ce champ, le serveur
   * retombait sur un skin aléatoire à CHAQUE connexion d'un invité, ignorant son choix (retour
   * utilisateur : skin incohérent d'une connexion à l'autre). */
  skin?: string;
  /** Jeton reçu dans un `welcome` précédent (voir `WelcomeMessage.resumeToken`) — permet au
   * serveur de reconnaître une reconnexion transitoire (coupure Wi-Fi, App Nap Safari...) plutôt
   * qu'un tout nouveau joueur, et de reprendre la vie en cours (même `playerId`, même masse) au
   * lieu d'en créer une nouvelle (voir connectionHandler.ts, correctif "déconnexion = perte
   * d'XP/de vie immédiate"). Absent pour un tout premier join, ou un jeton expiré/inconnu (délai
   * de grâce écoulé, voir server/net/ws/broadcast.ts `GRACE_PERIOD_MS`) : le serveur retombe alors
   * silencieusement sur un join normal. */
  resumeToken?: string;
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
  /** Horodatage (`Date.now()`) du prochain reset automatique planifié de ce salon (voir
   * engine/resetSchedule.ts) — `undefined` si le salon n'a aucun reset automatique programmé.
   * Sert au décompte affiché en HUD (GameView.tsx) ; calculé une fois par `welcome` plutôt que
   * répété à chaque tick (contrairement à `entities`), un reset se recalcule rarement (voir
   * roomManager.ts `nextResetAtMsOf`). */
  nextResetAtMs?: number;
  /** Identifiant de build du process serveur (fixé au démarrage, voir server/src/index.ts) —
   * permet au client de détecter qu'il a reconnecté vers un nouveau déploiement (un redémarrage
   * du process change forcément cette valeur) et de se recharger automatiquement plutôt que de
   * continuer à exécuter un bundle périmé (voir GameView.tsx, comparaison au `welcome` précédent). */
  buildVersion?: string;
  /** Jeton à renvoyer dans un futur `ClientJoinMessage.resumeToken` si cette connexion venait à
   * se couper (voir connectionHandler.ts) — permet de reprendre la vie en cours (même masse,
   * mêmes morceaux) plutôt que de la perdre immédiatement sur une simple coupure transitoire.
   * Absent pour un spectateur/viewer admin (rien à reprendre, pas de vie de joueur). */
  resumeToken?: string;
}

export interface LeaderboardEntry {
  rank: number;
  nickname: string;
  score: number;
  /** Identifiant du joueur de cette entrée — le client compare à son propre `playerId` pour
   * savoir s'il doit se surligner ("c'est moi"), voir GameView.tsx. Volontairement PAS un
   * booléen `isSelf` calculé côté serveur (ancien design) : `entities`/`leaderboard` sont
   * construits UNE SEULE FOIS par tick puis réutilisés tels quels pour tous les joueurs du salon
   * (voir net/ws/broadcast.ts `sharedStatePrefix`) — un `isSelf` par destinataire y était
   * incompatible (chaque joueur recevait alors le `isSelf` calculé pour le PREMIER joueur traité
   * ce tick, surlignant le mauvais joueur dans le classement). `playerId` est identique pour
   * tout le monde, donc partageable sans ce bug. */
  playerId: string;
}

export interface WorldStateMessage {
  type: 'state';
  tick: number;
  entities: EntitySnapshot[];
  /** `true` si `entities` représente l'ensemble COMPLET et autoritaire des entités actuellement
   * pertinentes pour ce destinataire (salon entier pour un spectateur/vue admin, ou
   * resynchronisation périodique de la nourriture pour un joueur filtré par intérêt — voir
   * server/src/engine/worker/interestFilter.ts) ; `false` signifie que `entities` ne contient
   * QUE ce qui a changé depuis le dernier message envoyé à CE destinataire (delta nourriture,
   * filtrage par intérêt réseau, cahier_des_charges_perf_reseau_grande_carte.md §3.5) — toute
   * entité déjà connue et non re-listée ici reste valable telle quelle côté client. Absent =
   * traité comme `true` (comportement historique : `entities` a toujours été la liste complète
   * avant l'introduction du filtrage par intérêt), voir client/src/renderEngine.ts
   * `RenderEngine.pushSnapshot`. La nourriture ('f') est la seule kind concernée par le delta —
   * les morceaux ('c', kind 'piece') sont toujours réenvoyés en entier tant qu'ils restent dans
   * l'intérêt du destinataire (ils bougent, un delta n'aurait pas de sens pour eux). */
  entitiesFull?: boolean;
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
      rechargeTimeSec?: number;
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
  /** XP gagnée pendant cette vie (voir engine/xp.ts) — TOUJOURS le montant brut, y compris pour un
   * invité (qui n'a simplement personne à qui le créditer tant qu'il n'a pas de compte, voir
   * `claimId` ci-dessous). */
  xpEarned: number;
  customCard: DeathCustomCard;
  /** Identifiant OPAQUE (voir `AccountsService.createScoreClaim`) permettant de réclamer le
   * score/XP de CETTE vie via `POST /api/account/claim-score` si le joueur crée un compte ou se
   * connecte juste après — présent UNIQUEMENT pour un invité (`accountId` inconnu du serveur au
   * moment de la mort) ayant un score/XP non nul à sauvegarder ; absent pour un joueur déjà
   * connecté (déjà crédité directement, voir broadcast.ts) ou un invité sans rien à sauvegarder.
   * Ne PORTE JAMAIS le montant lui-même (voir le commentaire de `createScoreClaim` : le client ne
   * doit jamais pouvoir dicter au serveur combien créditer). */
  claimId?: string;
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
