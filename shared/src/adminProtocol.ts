/** Alias local (pas d'export `PlayerId` dans `protocol.ts` — les autres messages y utilisent
 * `string` directement) : uniquement pour la lisibilité de ce fichier. */
type PlayerId = string;

/** Copie STRUCTURELLE de `RoomResetSchedule` (server/src/engine/resetSchedule.ts) — `shared/` ne
 * peut pas importer de code serveur (frontière de workspace) ; les deux types doivent rester
 * synchronisés à la main. Cette forme ne change quasiment jamais (3 variantes stables depuis Lot
 * 2.4) — le risque de dérive est faible face à la complexité d'un partage cross-workspace pour un
 * seul type. Compatible structurellement avec `RoomResetSchedule` (mêmes champs/littéraux), donc
 * assignable sans cast explicite côté `RoomInstance.adminAction` (voir P6, §8.3
 * plan-implementation-admin.md). */
export type AdminResetSchedule =
  | { type: 'dailyAt'; hour: number; minute: number; timeZone: string }
  | { type: 'interval'; intervalMs: number }
  | { type: 'everyNMinutes'; minutes: number; timeZone: string };

/**
 * Protocole de l'Espace Créatif / "Salons & Écrans" (cahier_des_charges_admin.md §4, §5.2) —
 * partagé entre le serveur (`server/src/engine/worker/protocol.ts`, qui réutilise ces mêmes types
 * pour traverser la frontière worker_thread) et l'interface admin (`admin/src/`), qui envoie ces
 * actions sur la connexion WebSocket dédiée (`?admin=1`, voir connectionHandler.ts).
 */
export type AdminRoomAction =
  | { kind: 'kill'; playerId: PlayerId }
  | { kind: 'freeze'; playerId: PlayerId }
  | { kind: 'unfreeze'; playerId: PlayerId }
  | { kind: 'setMass'; playerId: PlayerId; mass: number }
  | { kind: 'split'; playerId: PlayerId }
  | { kind: 'remerge'; playerId: PlayerId }
  | { kind: 'spawnFood'; x: number; y: number; mass: number }
  | {
      kind: 'spawnBot';
      /** Tous optionnels — omis (ou tous `undefined`), c'est le spawn "naturel" existant (profil
       * aléatoire, position sûre aléatoire, masse de départ du mod). Fournis, c'est un "Bot
       * personnalisé" (cahier_des_charges_admin.md §9.3/§17) : pseudo/masse/position imposés, le
       * bot reste sinon piloté par l'IA normalement (voir `BotManager.forceSpawnOne`, server). `x`
       * et `y` doivent être fournis TOUS LES DEUX pour être pris en compte (sinon ignorés). */
      nickname?: string;
      mass?: number;
      x?: number;
      y?: number;
    }
  | { kind: 'clearFood' }
  | { kind: 'clearBots' }
  | { kind: 'reset' }
  | { kind: 'switchMod'; modId: string }
  | { kind: 'enableGodmode'; playerId: PlayerId; nickname: string }
  | { kind: 'disableGodmode'; playerId: PlayerId }
  | {
      kind: 'godInput';
      playerId: PlayerId;
      x: number;
      y: number;
      intensity: number;
      split: boolean;
      /** Ajoutés en P4 (§9.4/§10.4 cahier_des_charges_admin.md, plan-implementation-admin.md §6.1)
       * — le Blob Dieu gagne les mêmes contrôles qu'un vrai joueur. Optionnels : un client encore
       * sur l'ancien comportement (suivi souris seul) reste valide. */
      dash?: boolean;
      eject?: boolean;
    }
  /** Déplacement physique du barycentre (§9.1) — translate TOUS les morceaux du joueur par le même
   * delta, offsets relatifs préservés. Remplace l'ex-détournement de `godInput` pour "Téléporter à
   * l'emplacement" (qui ATTIRAIT vers un point, jamais un vrai déplacement instantané). */
  | { kind: 'dragMove'; playerId: PlayerId; x: number; y: number }
  /** Marionnette (§9.3) — un seul blob possédé à la fois par session admin (appliqué côté serveur,
   * voir connectionHandler.ts). `possess` suspend l'input normal (vrai client OU IA bot, voir
   * `Room.handleInput`) ; `unpossess` le restaure. */
  | { kind: 'possess'; playerId: PlayerId }
  | { kind: 'unpossess'; playerId: PlayerId }
  | {
      kind: 'possessInput';
      playerId: PlayerId;
      x: number;
      y: number;
      intensity: number;
      split: boolean;
      dash?: boolean;
      eject?: boolean;
    }
  /** Apparence à la volée (§9.4) — met à jour l'état de SESSION (pas le compte persistant) et
   * rediffuse le message `player` à tous les viewers. `color`, pas `skin` : cohérence avec le reste
   * du protocole réseau (voir §1 plan-implementation-admin.md — le champ réel du message `player`
   * s'appelle `color`), même si l'engin interne (`PlayerState.skin`) garde son nom historique. */
  | { kind: 'setAppearance'; playerId: PlayerId; nickname?: string; color?: string }
  /** Spawn de virus manuel (§10.2) — les 3 types du jeu restent tous sélectionnables ici quel que
   * soit le type "organique" déclaré par le mod (`ParametricModConfig.virus.type`, un seul à la
   * fois) : un outil de debug admin bénéficie de pouvoir tester n'importe quel type sur n'importe
   * quelle carte, le moteur de collision les gère déjà tous les 3 génériquement. */
  | { kind: 'spawnVirus'; x: number; y: number; virusType: 1 | 2 | 3 }
  /** Vague de bots (§10.3) — pluriel, distinct de `spawnBot` (bot personnalisé unitaire, existant,
   * inchangé). `count` borné [1,50] côté serveur. `behaviorProfile` = id de profil de comportement
   * (`server/configs/bots/*.json`, voir `listAvailableBotBehaviorIds()`), PAS la "personnalité"
   * (fuis/neutre/agressif) qui reste tirée aléatoirement pour chaque bot de la vague. */
  | { kind: 'spawnBots'; count: number; mass?: number; behaviorProfile?: string }
  /** Reprogramme le reset automatique d'un salon VIVANT sans reset immédiat (P6, §8.3
   * plan-implementation-admin.md) — usage interne serveur uniquement (jamais envoyé par le client
   * admin via le canal WS, voir `RoomManager.setRoomResetSchedule`, appelé depuis les routes
   * diff/apply), au même titre que `switchMod` déjà appelé directement depuis une route HTTP
   * (voir l'ex-`handleAdminServerReload`). `null` désactive tout reset automatique. */
  | { kind: 'setResetSchedule'; schedule: AdminResetSchedule | null };

export interface AdminActionResult {
  ok: boolean;
  count?: number;
}

export interface AdminPlayerInfo {
  playerId: PlayerId;
  nickname: string;
  mass: number;
  isBot: boolean;
  isFrozen: boolean;
  /** Blob Dieu (§4.2/§10.4) — déduit de l'id (`admin-god-*`, voir `engine/godmode.ts`
   * `isGodPlayerId`), jamais un champ stocké séparément. */
  isGod: boolean;
  /** Marionnette (§9.3, P4) — `true` tant qu'un admin possède ce joueur/bot (voir
   * `Room.isPossessed`). Le champ existait déjà dans ce type depuis P1 (toujours `false`
   * jusqu'ici) pour éviter une 2ᵉ migration de protocole ; P4 le rend enfin réellement dynamique. */
  possessedByAdmin: boolean;
}

/** Message entrant admin (Admin -> Server) sur la connexion `?admin=1` — enveloppe unique pour
 * toutes les actions (voir `AdminRoomAction`), cohérent avec `ClientMessage` (protocol.ts) mais
 * délibérément séparé : ce canal n'est jamais accessible à un client joueur normal. */
export interface AdminClientActionMessage {
  type: 'admin_action';
  /** Choisi par l'admin (ex. `crypto.randomUUID()`), simplement renvoyé tel quel dans la réponse
   * (voir `AdminActionResponseMessage`) — permet à l'UI de faire correspondre une réponse à
   * l'action qui l'a déclenchée sans dépendre de l'ordre d'arrivée. */
  actionId: string;
  action: AdminRoomAction;
}

/** Message sortant admin (Server -> Admin) réponse à une action — corrélé par `actionId` (choisi
 * par l'admin, écho simple, pas un compteur serveur comme les `reqId` internes worker_threads). */
export interface AdminActionResponseMessage {
  type: 'admin_action_result';
  actionId: string;
  result: AdminActionResult;
}

/** Message sortant admin (Server -> Admin) périodique (~1Hz, A3, plan-implementation-admin.md
 * §3.9) — état fiable des joueurs (dont `isFrozen`), construit depuis le même
 * `RoomHandle.adminListPlayers()` que `GET /api/admin/rooms`, plutôt que dérivé des snapshots
 * `state` (qui ne portent aucun état "gelé" : le badge GELÉ du Studio restait figé à `false`
 * avant ce message). */
export interface AdminPlayersMessage {
  type: 'adminPlayers';
  players: AdminPlayerInfo[];
}

export type AdminServerMessage = AdminActionResponseMessage | AdminPlayersMessage;
