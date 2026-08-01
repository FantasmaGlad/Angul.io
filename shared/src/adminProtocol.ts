/** Alias local (pas d'export `PlayerId` dans `protocol.ts` — les autres messages y utilisent
 * `string` directement) : uniquement pour la lisibilité de ce fichier. */
type PlayerId = string;

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
    };

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

export type AdminServerMessage = AdminActionResponseMessage;
