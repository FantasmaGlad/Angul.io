import {
  DEFAULT_MOVEMENT_CONFIG,
  interestRadiusForMass,
  type MovementConfig,
  type ServerMessage,
} from '@angulio/shared';
import { DEFAULT_CHALLENGER_CONFIG } from '../bots/botTypes.js';
import type { BotConfig } from '../../mods/parametric/config.js';
import { Room } from '../room.js';
import type { ModResolver } from '../roomManager.js';
import type { Entity, EntityId, PlayerId, PlayerInput } from '../types.js';
import {
  buildCoarseFoodIndex,
  isResyncTick,
  queryCoarseFoodIndex,
  RESYNC_INTERVAL_SEC,
  type CoarseFoodIndex,
} from './interestFilter.js';
import {
  ADMIN_TICK_DIVISOR,
  buildStateMessage,
  buildVisibleEntitySnapshots,
  centroidOf,
  computeTopScores,
  SPECTATOR_TICK_DIVISOR,
  toSnapshot,
} from './snapshotBuilder.js';
import type {
  AdminActionResult,
  AdminPlayerInfo,
  AdminRoomAction,
  DeathInfo,
  JoinResult,
  LeaveResult,
  PlayerJoinEvent,
  RespawnResult,
  RoomSpec,
  RoomStats,
  TickPayload,
} from './protocol.js';

/**
 * Toute la logique d'un salon indépendante de son hébergement (même process pour
 * `LocalRoomHost`, thread séparé pour `WorkerRoomHost` via `roomWorker.ts`) — reprend telle
 * quelle la logique aujourd'hui éparpillée entre `connectionHandler.ts` (décisions de
 * join/respawn/leave) et `broadcast.ts` (construction des messages `state`), regroupée ici pour
 * n'exister qu'à un seul endroit quel que soit l'hébergement (voir plan_implementation,
 * "worker_threads"). Ne connaît rien du réseau (pas de WebSocket, pas de compte joueur/DB) :
 * seulement le salon (`Room`/`World`) et les ids des joueurs/spectateurs à qui envoyer un état à
 * chaque tick (`viewerIds`) — les sockets elles-mêmes, la couleur d'avatar et l'écriture en base
 * restent uniquement du ressort du thread principal (voir broadcast.ts/connectionHandler.ts).
 */
export class RoomInstance {
  readonly id: string;
  readonly room: Room;
  /** Voir `RoomHandle.movement` (roomHost.ts) — repli sur `DEFAULT_MOVEMENT_CONFIG` uniquement
   * pour un `ModResolver` de test qui ne renseigne pas ce champ (jamais en production, voir
   * `engine/modRegistry.ts`). */
  readonly movement: MovementConfig;
  private readonly maxPlayers: number;
  private nextPlayerId = 1;
  private readonly viewerIds = new Set<PlayerId>();
  private readonly spectatorIds = new Set<PlayerId>();
  /** Sous-ensemble de `spectatorIds` correspondant au canal admin (`?admin=1`,
   * cahier_des_charges_admin.md §10.1) — distinct du fond spectateur joueur (`?spectate=1`) :
   * cadence (`ADMIN_TICK_DIVISOR`) et fidélité (jamais de sous-échantillonnage nourriture, voir
   * `handleTick`) propres, un admin observant activement un salon a besoin de bien plus de
   * précision qu'un simple décor d'accueil dézoomé — et le coût, contrairement au spectateur
   * joueur, reste borné par construction (un admin authentifié à la fois, jamais N visiteurs). */
  private readonly adminViewerIds = new Set<PlayerId>();
  private readonly maxMassByPlayer = new Map<PlayerId, number>();
  /** Ids de nourriture déjà envoyés à CE joueur depuis sa dernière resynchronisation complète —
   * filtrage par intérêt + delta nourriture (cahier_des_charges_perf_reseau_grande_carte.md §3.5,
   * voir `handleTick`). `undefined`/absent = jamais encore envoyé à ce joueur, traité comme un
   * besoin de resynchronisation complète immédiate. */
  private readonly lastSentFoodIdsByPlayer = new Map<PlayerId, Set<EntityId>>();

  private readonly tickListeners: Array<
    (tick: number, payloads: TickPayload[], stats: RoomStats) => void
  > = [];
  private readonly playerJoinListeners: Array<(event: PlayerJoinEvent) => void> = [];
  private readonly deathListeners: Array<(playerId: PlayerId, info: DeathInfo) => void> = [];
  private readonly resetListeners: Array<() => void> = [];

  constructor(
    spec: RoomSpec,
    private readonly resolveMod: ModResolver,
  ) {
    this.id = spec.id;
    this.maxPlayers = spec.maxPlayers;

    const { mod, mapSize, kArea, bots, movement } = resolveMod(spec.modId);
    this.movement = movement ?? DEFAULT_MOVEMENT_CONFIG;
    let botConfig = bots ? { ...bots, enabled: spec.botsEnabled ?? bots.enabled } : undefined;
    if (botConfig && spec.botCount) botConfig = applyRoomBotCountOverride(botConfig, spec.botCount);
    this.room = new Room(mod, {
      // Taille de carte personnalisée pour un salon créé depuis le lobby (demande utilisateur,
      // "Salon Privé") — remplace la taille par défaut du mod ; absente = comportement d'origine.
      mapSize: spec.mapSize ?? mapSize,
      tickRateHz: spec.tickRateHz,
      kArea,
      maxPlayers: spec.maxPlayers,
      bots: botConfig,
      resetSchedule: spec.resetSchedule,
    });

    this.room.onState((tick) => this.handleTick(tick));
    this.room.onPlayerJoin((id, nickname, skin) => {
      for (const listener of this.playerJoinListeners) listener({ playerId: id, nickname, skin });
    });
    this.room.onPlayerDeath((playerId, info) => this.handleDeath(playerId, info));
    this.room.onReset(() => {
      this.maxMassByPlayer.clear();
      this.lastSentFoodIdsByPlayer.clear();
      for (const listener of this.resetListeners) listener();
    });

    this.room.start();
  }

  onTick(listener: (tick: number, payloads: TickPayload[], stats: RoomStats) => void): void {
    this.tickListeners.push(listener);
  }

  onPlayerJoin(listener: (event: PlayerJoinEvent) => void): void {
    this.playerJoinListeners.push(listener);
  }

  onPlayerDeath(listener: (playerId: PlayerId, info: DeathInfo) => void): void {
    this.deathListeners.push(listener);
  }

  onReset(listener: () => void): void {
    this.resetListeners.push(listener);
  }

  /** Décisions identiques à l'ancien `connectionHandler.ts` (join initial) : plafond de joueurs
   * humains, éviction du plus petit bot pour libérer une place, pseudo déjà pris — reprises ici
   * telles quelles, juste relocalisées. */
  join(nickname: string, skin?: string): JoinResult {
    const world = this.room.world;
    const botManager = this.room.botManager;

    const humanCount = world.allPlayers().filter((p) => !botManager?.isBot(p.id)).length;
    if (humanCount >= this.maxPlayers) return { ok: false, reason: 'room_full' };

    while (world.allPlayers().length >= this.maxPlayers) {
      if (botManager && botManager.activeBotCount > 0) botManager.removeSmallestBot();
      else break;
    }

    const nicknameTaken = world
      .allPlayers()
      .some((p) => p.nickname.toLowerCase() === nickname.toLowerCase());
    if (nicknameTaken) return { ok: false, reason: 'nickname_taken' };

    const existingPlayers = world
      .allPlayers()
      .map((p) => ({ id: p.id, nickname: p.nickname, skin: p.skin }));
    const playerId = String(this.nextPlayerId++);
    this.maxMassByPlayer.set(playerId, 0);
    this.room.addPlayer(playerId, nickname, skin);

    return { ok: true, playerId, existingPlayers };
  }

  respawn(playerId: PlayerId, nickname: string): RespawnResult {
    const existingPlayer = this.room.world.getPlayer(playerId);
    if (!existingPlayer || existingPlayer.pieceIds.length === 0) {
      // Réutilise le skin déjà assigné à ce joueur (compte, ou choix invité résolu au premier join)
      // plutôt que de laisser `Room.addPlayer` le redériver silencieusement (voir broadcast.ts
      // `onPlayerJoin`) — sans ça, chaque respawn changeait le skin affiché à tous les viewers
      // (retour utilisateur : skin incohérent d'un point de vue à l'autre).
      this.room.addPlayer(playerId, nickname, existingPlayer?.skin);
      return { respawned: true };
    }
    return { respawned: false };
  }

  getPlayerMaxMass(playerId: PlayerId): number {
    return Math.round(this.maxMassByPlayer.get(playerId) ?? 0);
  }

  /** `undefined` si `playerId` est inconnu (déjà retiré, ou jamais un vrai joueur — un spectateur
   * n'appelle jamais `leave`, voir `disconnectViewer`). */
  leave(playerId: PlayerId): LeaveResult | undefined {
    const player = this.room.world.getPlayer(playerId);
    if (!player) return undefined;

    const rawScore = this.maxMassByPlayer.get(playerId) ?? 0;
    const rawXp = player.lifeStats.xpEarned ?? 0;
    const { score: transformedScore, xp: transformedXp } = this.room.transformScoreForAccount(
      rawScore,
      rawXp,
    );

    this.room.removePlayer(playerId);
    this.maxMassByPlayer.delete(playerId);
    this.lastSentFoodIdsByPlayer.delete(playerId);
    this.viewerIds.delete(playerId);
    this.spectatorIds.delete(playerId);

    return { rawScore, transformedScore, transformedXp };
  }

  input(playerId: PlayerId, input: PlayerInput): void {
    this.room.handleInput(playerId, input);
  }

  /** Dispatch générique des actions admin (§4.3-4.4 cahier_des_charges_admin.md) — un seul point
   * d'entrée traversant la frontière worker (voir `RoomHandle.adminAction`, `roomWorker.ts`)
   * plutôt qu'une méthode par action : ajouter une action ne demande de toucher que ce switch et
   * `Room`/`BotManager`, jamais le protocole de transport lui-même. */
  adminAction(action: AdminRoomAction): AdminActionResult {
    switch (action.kind) {
      case 'kill':
        return { ok: this.room.killPlayer(action.playerId) };
      case 'freeze':
        this.room.setFrozen(action.playerId, true);
        return { ok: true };
      case 'unfreeze':
        this.room.setFrozen(action.playerId, false);
        return { ok: true };
      case 'setMass':
        return { ok: this.room.setPlayerMass(action.playerId, action.mass) };
      case 'split':
        return { ok: this.room.forceSplit(action.playerId) };
      case 'remerge':
        return { ok: this.room.forceRemerge(action.playerId) };
      case 'spawnFood':
        this.room.spawnFood({ x: action.x, y: action.y }, action.mass);
        return { ok: true };
      case 'spawnBot':
        return {
          ok: this.room.forceSpawnBot({
            nickname: action.nickname,
            mass: action.mass,
            x: action.x,
            y: action.y,
          }),
        };
      case 'clearFood':
        return { ok: true, count: this.room.clearFood() };
      case 'clearBots':
        return { ok: true, count: this.room.clearBots() };
      case 'reset':
        this.room.reset();
        return { ok: true };
      case 'switchMod': {
        const { mod, mapSize, kArea, bots } = this.resolveMod(action.modId);
        this.room.switchMod(mod, { mapSize, kArea, maxPlayers: this.maxPlayers, bots });
        return { ok: true };
      }
      case 'enableGodmode':
        this.room.addPlayer(action.playerId, action.nickname);
        return { ok: true };
      case 'disableGodmode':
        this.room.removePlayer(action.playerId);
        return { ok: true };
      case 'godInput':
        this.room.handleInput(action.playerId, {
          target: { x: action.x, y: action.y },
          intensity: action.intensity,
          split: action.split,
        });
        return { ok: true };
      default:
        return { ok: false };
    }
  }

  /** Liste des joueurs du salon pour "Salons & Écrans" (§3.3) — masse totale calculée à la
   * demande (pas maintenue en continu, cette liste n'est consultée qu'au rythme des requêtes
   * admin, comme `Room.tickMetrics`). */
  adminListPlayers(): AdminPlayerInfo[] {
    return this.room.world.allPlayers().map((player) => ({
      playerId: player.id,
      nickname: player.nickname,
      mass: this.room.world
        .getPiecesByOwner(player.id)
        .reduce((sum, piece) => sum + piece.mass, 0),
      isBot: this.room.botManager?.isBot(player.id) ?? false,
      isFrozen: this.room.isFrozen(player.id),
    }));
  }

  /** Enregistre un destinataire d'état par tick — joueur réel (après un `join` accepté),
   * spectateur (`?spectate=1`, jamais ajouté à `world`, voir SpectatorBackground.tsx côté
   * client) ou vue admin (`?admin=1`, cahier_des_charges_admin.md §10.1) : les trois cas passent
   * par ici. `isSpectator` distingue le traitement (fréquence réduite + nourriture échantillonnée,
   * voir snapshotBuilder.ts) ; `isAdmin` (implique `isSpectator`) bascule sur la cadence/fidélité
   * dédiées au canal admin (`ADMIN_TICK_DIVISOR`, jamais de sous-échantillonnage). */
  connectViewer(playerId: PlayerId, isSpectator: boolean, isAdmin = false): void {
    this.viewerIds.add(playerId);
    if (isSpectator) this.spectatorIds.add(playerId);
    if (isAdmin) this.adminViewerIds.add(playerId);
  }

  disconnectViewer(playerId: PlayerId): void {
    this.viewerIds.delete(playerId);
    this.spectatorIds.delete(playerId);
    this.adminViewerIds.delete(playerId);
    // Force une resynchronisation complète de la nourriture à la reconnexion (voir `handleTick`,
    // `!lastSent` déclenche un envoi complet) plutôt que de reprendre un delta sur une position
    // potentiellement périmée après une coupure — sans risque, l'ancien Set n'était de toute
    // façon plus mis à jour pendant la déconnexion (ce joueur n'était plus dans `viewerIds`).
    this.lastSentFoodIdsByPlayer.delete(playerId);
  }

  destroy(): void {
    this.room.stop();
  }

  private handleTick(tick: number): void {
    const world = this.room.world;
    const metrics = this.room.tickMetrics();
    const allPlayers = Array.from(world.allPlayers());
    const botManager = this.room.botManager;
    const humanCount = allPlayers.filter((p) => !botManager?.isBot(p.id)).length;
    const stats: RoomStats = {
      playerCount: allPlayers.length,
      humanCount,
      tickAvgMs: metrics.avgMs,
      tickP95Ms: metrics.p95Ms,
      tickOverruns: metrics.overruns,
    };

    // Le calcul des payloads par spectateur/joueur ne sert à rien si personne n'observe ce
    // salon (voir l'ancien `if (runtime.sockets.size === 0) return;` de broadcast.ts) — mais
    // `stats` doit malgré tout être émis à chaque tick, y compris pour un salon sans aucun
    // spectateur/joueur humain connecté (ex. rempli de bots) : `RoomManager.pruneEmptyRooms()`
    // et `/api/admin/health` en dépendent pour un salon hébergé par un worker (pas d'accès
    // synchrone à `world` depuis le thread principal dans ce cas, voir `WorkerRoomHost`).
    if (this.viewerIds.size === 0) {
      for (const listener of this.tickListeners) listener(tick, [], stats);
      return;
    }

    const allEntities = world.allEntities();
    const topScores = computeTopScores(world, Array.from(world.allPlayers()));

    for (const player of allPlayers) {
      let currentMass = 0;
      for (const pieceId of player.pieceIds) {
        const piece = world.getEntity(pieceId);
        if (piece) currentMass += piece.mass;
      }
      const prevMax = this.maxMassByPlayer.get(player.id) ?? 0;
      if (currentMass > prevMax) {
        this.maxMassByPlayer.set(player.id, currentMass);
      }
    }

    const payloads: TickPayload[] = [];
    let sharedSpectatorMessage: ServerMessage | undefined;
    let sharedAdminMessage: ServerMessage | undefined;
    const shouldSendSpectatorTick = tick % SPECTATOR_TICK_DIVISOR === 0;
    const shouldSendAdminTick = tick % ADMIN_TICK_DIVISOR === 0;

    // Snapshot du salon entier construit UNE SEULE FOIS par tick pour les spectateurs/vue admin
    // (voir `buildVisibleEntitySnapshots`) — chemin INCHANGÉ, ils continuent de tout voir (§1.3
    // cahier_des_charges_perf_reseau_grande_carte.md, non-régression modération/fond d'accueil).
    let spectatorEntities: ReturnType<typeof buildVisibleEntitySnapshots> | undefined;
    // Salon entier SANS sous-échantillonnage nourriture (cahier_des_charges_admin.md §10.1) —
    // distinct de `spectatorEntities` : un admin qui observe activement un salon (modération,
    // Studio de contrôle) a besoin de la nourriture réelle, contrairement au fond décoratif
    // dézoomé de l'accueil (`isVisibleToSpectator`, pensé pour N visiteurs simultanés, jamais le
    // cas ici — voir `adminViewerIds`).
    let adminEntities: ReturnType<typeof buildVisibleEntitySnapshots> | undefined;

    // Filtrage par intérêt (joueurs réels uniquement, jamais les spectateurs/vue admin) : calculé
    // PAR JOUEUR désormais (plus de liste unique partagée, voir cahier des charges §3.4) —
    // `pieces`/`particles`/`coarseFoodIndex` restent en revanche calculés UNE SEULE FOIS par tick
    // et réutilisés pour tous les joueurs (seul le centre/rayon de la requête varie).
    let pieces: Entity[] | undefined;
    let particles: Entity[] | undefined;
    let coarseFoodIndex: CoarseFoodIndex | undefined;
    const resyncIntervalTicks = Math.round(this.room.tickRateHz * RESYNC_INTERVAL_SEC);

    for (const playerId of this.viewerIds) {
      const isAdminViewer = this.adminViewerIds.has(playerId);
      if (isAdminViewer) {
        if (!shouldSendAdminTick) continue;
        if (!sharedAdminMessage) {
          // `isSpectator: false` ici (2ᵉ argument) : PAS de sous-échantillonnage nourriture,
          // contrairement à `spectatorEntities` ci-dessus — voir le commentaire de `adminEntities`.
          adminEntities ??= buildVisibleEntitySnapshots(allEntities, false);
          sharedAdminMessage = buildStateMessage({
            room: this.room,
            playerId: 'admin',
            // `ADMIN_TICK_DIVISOR` vaut 1 par défaut (aucune réduction) : `Math.floor(tick / 1)`
            // reproduit le tick de simulation brut tel quel, jamais de renumérotation nécessaire
            // dans ce cas — mais reste correct si `ADMIN_TICK_DIVISOR` change un jour (même
            // raisonnement que `shouldSendSpectatorTick` ci-dessous pour la dérive de la ligne de
            // temps du client, voir son commentaire détaillé).
            tick: Math.floor(tick / ADMIN_TICK_DIVISOR),
            entities: adminEntities,
            topScores,
            entitiesFull: true,
          }).message;
        }
        payloads.push({ playerId, message: sharedAdminMessage });
        continue;
      }

      const isSpectator = this.spectatorIds.has(playerId);
      if (isSpectator) {
        if (!shouldSendSpectatorTick) continue;
        if (!sharedSpectatorMessage) {
          spectatorEntities ??= buildVisibleEntitySnapshots(allEntities, true);
          sharedSpectatorMessage = buildStateMessage({
            room: this.room,
            playerId: 'spectator',
            // Renumérote en tick SPECTATEUR séquentiel (divise le tick de simulation brut par
            // SPECTATOR_TICK_DIVISOR, toujours un entier exact ici — voir `shouldSendSpectatorTick`
            // ci-dessus) plutôt que de transmettre le tick de simulation brut tel quel. Sans ce
            // correctif : le `welcome.tickRateHz` annoncé à un spectateur est délibérément le taux
            // RÉDUIT (divisé par SPECTATOR_TICK_DIVISOR, voir connectionHandler.ts) pour
            // dimensionner correctement le buffer d'interpolation côté client — mais
            // `RenderEngine.pushSnapshot` (client) suppose que CHAQUE unité du champ `tick` dure
            // `1000/tickRateHz` (donc ~133ms au taux réduit), alors que le tick de simulation BRUT
            // avance toujours de `SPECTATOR_TICK_DIVISOR` (4) entre deux envois spectateur — un
            // delta de 4 interprété comme 4×133ms (~533ms) alors que seuls 4×33ms (~133ms) de temps
            // réel se sont réellement écoulés : la ligne de temps de lecture du spectateur (ancrée
            // une seule fois par connexion, jamais réinitialisée en cours de session) DÉRIVE alors
            // de façon NON BORNÉE au fil de la session — mesuré : plusieurs secondes de retard
            // croissant sur la partie réelle (retour utilisateur : "~3 secondes de retard" + rendu
            // au ralenti, le buffer d'interpolation restant anormalement plein). Diviser le tick ICI
            // fait en sorte qu'une unité de `tick` corresponde exactement à un envoi spectateur, en
            // cohérence avec le `tickRateHz` réduit annoncé — plus aucune divergence possible.
            tick: Math.floor(tick / SPECTATOR_TICK_DIVISOR),
            entities: spectatorEntities,
            topScores,
            // Toujours le salon entier pour un spectateur/vue admin (jamais de filtrage par
            // intérêt, voir §1.3 cahier des charges) — `entitiesFull: true` en cohérence.
            entitiesFull: true,
          }).message;
        }
        payloads.push({ playerId, message: sharedSpectatorMessage });
        continue;
      }

      const ownPieces = world.getPiecesByOwner(playerId);
      let entitiesForPlayer: ReturnType<typeof buildVisibleEntitySnapshots>;
      let entitiesFull: boolean;

      if (ownPieces.length === 0) {
        // Pas (encore/plus) de morceau — mort en attente de respawn, ou tout juste rejoint et pas
        // encore apparu : aucun centre/masse dont dériver un rayon d'intérêt sensé. Liste VIDE
        // pour ce tick, jamais le salon entier.
        //
        // L'ancien repli envoyait ici TOUTES les entités du salon (potentiellement des milliers de
        // pastilles, sérialisées en un seul `JSON.stringify` côté broadcast puis reparsées et
        // reconstruites en entier dans le `knownFood` du client) — à chaque tick, donc ~20 fois
        // par seconde et par joueur concerné, pour un destinataire qui n'a par définition rien à
        // cadrer : sans morceau, sa caméra retombe déjà sur le centre de la carte (voir
        // `computeCamera`, client/src/render.ts) et son écran est de toute façon recouvert par
        // l'écran de mort. Le coût, lui, est bien réel et arrive précisément au pire moment
        // (entrée en partie / respawn, quand le client a déjà tout à faire) — l'un des envois les
        // plus lourds de toute la session.
        //
        // Rien n'est perdu, seulement différé d'un tick : dès que le morceau existe, la branche
        // ci-dessous envoie un état complet filtré par intérêt (`!lastSent` ci-dessous ⇒ resync
        // forcée), soit ~50ms plus tard. La purge du Set de delta reste indispensable pour ça :
        // au prochain respawn (position potentiellement très différente), `!lastSent` doit forcer
        // cette resynchro complète plutôt que de comparer contre une position périmée.
        entitiesForPlayer = [];
        entitiesFull = true;
        this.lastSentFoodIdsByPlayer.delete(playerId);
      } else {
        const center = centroidOf(ownPieces)!;
        let totalOwnMass = 0;
        for (const piece of ownPieces) totalOwnMass += piece.mass;
        const radius = interestRadiusForMass(totalOwnMass);
        const radiusSq = radius * radius;

        // Morceaux (joueurs/bots/virus) : filtre brute-force par distance (nombre borné — voir
        // interestFilter.ts, pas besoin d'index spatial dédié) + les propres morceaux du joueur
        // TOUJOURS inclus, même hors rayon (le client en a besoin hors caméra pour la
        // prédiction/HUD, voir cahier des charges §3.4).
        pieces ??= allEntities.filter((e) => e.kind === 'piece' || e.kind === 'virus');
        const pieceSnapshots: ReturnType<typeof toSnapshot>[] = ownPieces.map(toSnapshot);
        const includedPieceIds = new Set<EntityId>(ownPieces.map((p) => p.id));
        for (const piece of pieces) {
          if (includedPieceIds.has(piece.id)) continue;
          const dx = piece.position.x - center.x;
          const dy = piece.position.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) {
            pieceSnapshots.push(toSnapshot(piece));
            includedPieceIds.add(piece.id);
          }
        }

        // Nourriture : delta — seuls les ids NOUVELLEMENT dans l'intérêt du joueur depuis son
        // dernier envoi sont inclus, sauf tick de resynchronisation complète (périodique, étalée
        // par joueur — voir `isResyncTick`) ou premier envoi jamais fait à ce joueur.
        particles ??= allEntities.filter((e) => e.kind === 'particle');
        coarseFoodIndex ??= buildCoarseFoodIndex(particles);
        const candidateFoodIds = queryCoarseFoodIndex(coarseFoodIndex, center, radius);
        const currentFoodIds = new Set<EntityId>();
        for (const id of candidateFoodIds) {
          const entity = world.getEntity(id);
          if (!entity) continue; // mangée entre la construction de l'index et cette requête
          const dx = entity.position.x - center.x;
          const dy = entity.position.y - center.y;
          if (dx * dx + dy * dy <= radiusSq) currentFoodIds.add(id);
        }

        const lastSent = this.lastSentFoodIdsByPlayer.get(playerId);
        const resync = !lastSent || isResyncTick(playerId, tick, resyncIntervalTicks);
        const foodSnapshots: ReturnType<typeof toSnapshot>[] = [];
        if (resync) {
          for (const id of currentFoodIds) {
            const entity = world.getEntity(id);
            if (entity) foodSnapshots.push(toSnapshot(entity));
          }
          this.lastSentFoodIdsByPlayer.set(playerId, currentFoodIds);
        } else {
          for (const id of currentFoodIds) {
            if (lastSent.has(id)) continue;
            const entity = world.getEntity(id);
            if (entity) foodSnapshots.push(toSnapshot(entity));
            lastSent.add(id);
          }
        }

        entitiesForPlayer = [...pieceSnapshots, ...foodSnapshots];
        entitiesFull = resync;
      }

      const { message, totalMass } = buildStateMessage({
        room: this.room,
        playerId,
        tick,
        entities: entitiesForPlayer,
        topScores,
        entitiesFull,
      });
      payloads.push({ playerId, message });

      const previousMax = this.maxMassByPlayer.get(playerId) ?? 0;
      if (totalMass > previousMax) this.maxMassByPlayer.set(playerId, totalMass);
    }

    for (const listener of this.tickListeners) listener(tick, payloads, stats);
  }

  private handleDeath(playerId: PlayerId, info: { killerNickname?: string; survivalTimeSec: number }): void {
    const player = this.room.world.getPlayer(playerId);
    const rawScore = this.maxMassByPlayer.get(playerId) ?? 0;
    const rawXp = player?.lifeStats.xpEarned ?? 0;
    const { score: transformedScore, xp: transformedXp } = this.room.transformScoreForAccount(
      rawScore,
      rawXp,
    );

    const finalScore = Math.round(rawScore);
    const xpEarned = Math.round(rawXp);

    if (player) this.room.world.resetLifeStats(playerId);
    this.maxMassByPlayer.set(playerId, 0);

    const death: DeathInfo = {
      killerNickname: info.killerNickname,
      survivalTimeSec: Math.round(info.survivalTimeSec),
      finalScore,
      xpEarned,
      transformedScore,
      transformedXp,
    };
    for (const listener of this.deathListeners) listener(playerId, death);
  }
}

/** Remplace la population de bots du mod résolu par les bornes personnalisées d'un salon créé
 * depuis le lobby (demande utilisateur : "customiser le nombre de robots au total, mini, max, ou
 * fixe, entre 0 et 50") — réutilise la pyramide Challenger existante (voir botTypes.ts) plutôt
 * qu'un mécanisme séparé : `min === max` revient à une population FIXE (le mécanisme de rampe
 * humains n'a alors plus rien à faire varier), `min < max` reproduit le même comportement que le
 * réglage par défaut du mod (décroissance de `max` à `min` bots à mesure que des humains
 * rejoignent), seulement borné différemment. `ambientTargetCount`/`maxTotal` sont alignés sur
 * `max` pour qu'aucun autre mécanisme (peuplement ambiant à 0 humain, plafond dur, voir
 * `BotManager.adjustPopulation`) ne vienne recouper cette borne en-dessous de ce qui est demandé. */
export function applyRoomBotCountOverride(
  bots: BotConfig,
  override: { min: number; max: number },
): BotConfig {
  const base = bots.challengers ?? DEFAULT_CHALLENGER_CONFIG;
  const { min, max } = override;
  // `BotManager.adjustPopulation` borne aussi la population de Challengers par
  // `massMultipliers.length` (un rang sans palier de masse ne peut pas apparaître) — sans étendre
  // ce tableau ici, une borne `max` au-delà de sa longueur d'origine (15 par défaut) serait
  // silencieusement recoupée en-dessous de ce qui a été demandé. Le dernier palier existant est
  // répété pour les rangs supplémentaires plutôt que d'inventer une progression arbitraire.
  const lastMultiplier = base.massMultipliers[base.massMultipliers.length - 1] ?? 1;
  const massMultipliers =
    base.massMultipliers.length >= max
      ? base.massMultipliers
      : [
          ...base.massMultipliers,
          ...Array<number>(max - base.massMultipliers.length).fill(lastMultiplier),
        ];
  return {
    ...bots,
    ambientTargetCount: max,
    maxTotal: max,
    challengers: {
      ...base,
      enabled: true,
      baselineCount: min,
      maxWithHumans: max,
      minWithHumans: min,
      massMultipliers,
    },
  };
}
