import { randomInt } from 'node:crypto';
import type { MovementConfig } from '@angulio/shared';
import { logEvent } from '../log.js';
import type { GameMod } from './mod.js';
import type { Room } from './room.js';
import { DEFAULT_RESET_SCHEDULE, type RoomResetSchedule } from './resetSchedule.js';
import type { RoomHandle, RoomHost } from './worker/roomHost.js';
import type { RoomSpec, RoomStats } from './worker/protocol.js';

import type { BotConfig } from '../mods/parametric/config.js';

export type RoomVisibility = 'public' | 'private';

/**
 * Résout un identifiant de mode de jeu (ex. "vanilla") en un mod prêt à l'emploi ainsi que la
 * configuration de carte qui va meubler les bots et les options (mapSize/kArea/bots).
 */
export type ModResolver = (modId: string) => {
  mod: GameMod;
  mapSize: number;
  kArea?: number;
  bots?: BotConfig;
  /** Sous-ensemble minimal du modèle de mouvement du mod (voir shared/src/movement.ts) — transmis
   * au client dans `welcome.movement` pour la prédiction locale (client/src/prediction.ts).
   * Optionnel ici (contrairement à `RoomHandle.movement`, toujours renseigné) pour ne pas casser
   * les résolveurs factices des tests existants (roomManager.test.ts/server.test.ts) qui ne s'en
   * servent pas — `DEFAULT_MOVEMENT_CONFIG` comble l'absence, voir roomHost.ts/workerRoomHost.ts. */
  movement?: MovementConfig;
  /** Réglages de salon par défaut de ce mode (voir `ParametricModConfig['room']`,
   * mods/parametric/config.ts) — utilisés par `server/src/index.ts` pour les salons de base,
   * jamais imposés à un salon créé depuis le lobby (qui passe toujours ses propres
   * `CreateRoomOptions`). Optionnel : un résolveur factice de test peut ne rien renseigner ici. */
  room?: { maxPlayers?: number; resetSchedule?: RoomResetSchedule | null };
};

export interface CreateRoomOptions {
  name: string;
  modId: string;
  visibility: RoomVisibility;
  permanent?: boolean;
  resetSchedule?: RoomResetSchedule | null;
  maxPlayers?: number;
  durationMs?: number;
  /** Activation/Désactivation des bots (IA) pour ce salon (si false, aucun bot n'apparaît). */
  botsEnabled?: boolean;
  /** Code d'invitation à 6 chiffres pré-généré par le client (ou généré automatiquement si omis/pris). */
  inviteCode?: string;
}

/** Vue publique d'un salon, sans exposer la `Room` ni ses internes (utilisée par le lobby, Lot 2.2). */
export interface RoomSummary {
  id: string;
  name: string;
  modId: string;
  visibility: RoomVisibility;
  playerCount: number;
  maxPlayers: number;
  permanent: boolean;
}

export interface CreatedRoomSummary extends RoomSummary {
  inviteCode?: string;
}

export interface ManagedRoom {
  readonly id: string;
  readonly name: string;
  readonly modId: string;
  readonly visibility: RoomVisibility;
  readonly inviteCode?: string;
  /** Point d'entrée réseau normal (join/respawn/leave/input, écoute tick/mort/reset) — voir
   * broadcast.ts/connectionHandler.ts, qui ne connaissent plus `Room` directement (voir
   * plan_implementation, "worker_threads"). */
  readonly handle: RoomHandle;
  /** Alias vers `handle.localRoom` — non-`undefined` uniquement avec `LocalRoomHost` (défaut,
   * voir index.ts `ROOM_WORKERS`). Conservé pour ne pas casser les tests existants qui
   * manipulent `Room` directement (tick manuel, lecture de `.world`) ; jamais utilisé par le code
   * de production, qui passe toujours par `handle` pour rester valable avec `WorkerRoomHost`. */
  readonly room: Room | undefined;
  readonly maxPlayers: number;
}

interface RoomEntry extends ManagedRoom {
  readonly permanent: boolean;
  lastNonEmptyAt: number;
  expireTimer?: ReturnType<typeof setTimeout>;
}

export interface RoomManagerOptions {
  maxRooms?: number;
  emptyRoomGraceMs?: number;
  pruneIntervalMs?: number;
}

const DEFAULT_MAX_ROOMS = 100;
const DEFAULT_EMPTY_ROOM_GRACE_MS = 10 * 60_000; // 10 minutes
const DEFAULT_PRUNE_INTERVAL_MS = 30_000;
const INVITE_CODE_DIGITS = 6;
const INVITE_CODE_UPPER_BOUND = 10 ** INVITE_CODE_DIGITS;
const DEFAULT_MAX_PLAYERS_PER_ROOM = 100;

export class RoomManager {
  private readonly rooms = new Map<string, RoomEntry>();
  private readonly createListeners: Array<(managed: ManagedRoom) => void> = [];
  private readonly removeListeners: Array<(roomId: string) => void> = [];
  private readonly maxRooms: number;
  private readonly emptyRoomGraceMs: number;
  private readonly pruneTimer: ReturnType<typeof setInterval>;
  /** Dernier `RoomStats` connu par salon (voir `RoomHandle.onTick`, `worker/protocol.ts`) — seule
   * source d'information sur le nombre de joueurs/la charge d'un salon hébergé par
   * `WorkerRoomHost` (pas d'accès synchrone à `Room`/`World` depuis ce thread dans ce cas). Pour
   * un salon `LocalRoomHost` (défaut), `playerCountOf` préfère la lecture synchrone directe
   * (`entry.room.world.allPlayers()`), strictement équivalente mais sans dépendre du délai d'un
   * premier tick — voir son commentaire. */
  private readonly roomStats = new Map<string, RoomStats>();
  private nextRoomId = 1;

  /** Cadence de tick, identique pour tous les salons de ce déploiement — exposée (pas seulement
   * passée une fois au constructeur) pour que le réseau (connectionHandler.ts, message
   * `welcome`) puisse l'annoncer au client sans dépendre de `Room` directement (qui peut vivre
   * dans un autre thread, voir `WorkerRoomHost`). */
  readonly tickRateHz: number;

  constructor(
    private readonly host: RoomHost,
    tickRateHz: number,
    options: RoomManagerOptions = {},
  ) {
    this.tickRateHz = tickRateHz;
    this.maxRooms = options.maxRooms ?? DEFAULT_MAX_ROOMS;
    this.emptyRoomGraceMs = options.emptyRoomGraceMs ?? DEFAULT_EMPTY_ROOM_GRACE_MS;
    this.pruneTimer = setInterval(
      () => this.pruneEmptyRooms(),
      options.pruneIntervalMs ?? DEFAULT_PRUNE_INTERVAL_MS,
    );
  }

  createRoom(options: CreateRoomOptions): CreatedRoomSummary {
    if (this.rooms.size >= this.maxRooms) {
      throw new Error(`Nombre maximal de salons atteint (${this.maxRooms}).`);
    }

    // Id court incrémental plutôt qu'un UUID, pour rester cohérent avec les identifiants
    // d'entités/joueurs (Lot 1.8, économie de bande passante) — même si l'id de salon ne
    // transite pas à chaque tick, mieux vaut une seule convention dans tout le projet. En
    // revanche, cet id est prévisible et énumérable (1, 2, 3…) : un salon privé ne doit
    // jamais être rejoignable par son seul id (voir `inviteCode`, Lot 2.3).
    const id = String(this.nextRoomId++);
    const maxPlayers = options.maxPlayers ?? DEFAULT_MAX_PLAYERS_PER_ROOM;
    // Résolu ici plutôt que passé tel quel (`undefined` possible) : le spec envoyé au host
    // (potentiellement un worker, voir WorkerRoomHost) ne doit jamais transporter qu'une valeur
    // sans ambiguïté, `null` signifiant explicitement "pas de reset auto" (voir RoomSpec).
    const resetSchedule =
      options.resetSchedule === undefined ? DEFAULT_RESET_SCHEDULE : options.resetSchedule;

    const spec: RoomSpec = {
      id,
      modId: options.modId,
      tickRateHz: this.tickRateHz,
      maxPlayers,
      botsEnabled: options.botsEnabled,
      resetSchedule,
    };
    const handle = this.host.createRoom(spec);
    handle.onTick((_tick, _payloads, stats) => this.roomStats.set(id, stats));

    const inviteCode =
      options.visibility === 'private'
        ? options.inviteCode &&
          /^\d{6}$/.test(options.inviteCode) &&
          !this.isInviteCodeTaken(options.inviteCode)
          ? options.inviteCode
          : this.generateInviteCode()
        : undefined;
    const entry: RoomEntry = {
      id,
      name: options.name,
      modId: options.modId,
      visibility: options.visibility,
      inviteCode,
      handle,
      room: handle.localRoom,
      maxPlayers,
      permanent: options.permanent ?? false,
      lastNonEmptyAt: Date.now(),
    };
    if (options.durationMs !== undefined) {
      entry.expireTimer = setTimeout(() => this.expireRoom(id), options.durationMs);
    }
    this.rooms.set(id, entry);
    for (const listener of this.createListeners) listener(entry);
    logEvent('room_created', {
      roomId: id,
      name: options.name,
      modId: options.modId,
      visibility: options.visibility,
      permanent: entry.permanent,
      maxPlayers: entry.maxPlayers,
      durationMs: options.durationMs,
    });

    const summary = this.toSummary(entry);
    return inviteCode ? { ...summary, inviteCode } : summary;
  }

  /** Résout un salon par son id pour un salon **public**, ou par son code d'invitation pour un
   * salon **privé** (Lot 2.3) — jamais par l'id brut dans ce second cas : l'id est court et
   * séquentiel (voir `createRoom`), donc trivialement énumérable (`1`, `2`, `3`…). Sans cette
   * distinction, un salon "privé" resterait rejoignable par n'importe qui en devinant son id,
   * ce que "privé" est censé exclure. Le point d'entrée réseau (net/server.ts, `?roomId=`)
   * accepte transparemment les deux formes : un lien d'invitation transporte le code, pas
   * l'id interne. */
  getManagedRoom(idOrInviteCode: string): ManagedRoom | undefined {
    const direct = this.rooms.get(idOrInviteCode);
    if (direct) return direct.visibility === 'private' ? undefined : direct;
    return [...this.rooms.values()].find(
      (entry) => entry.visibility === 'private' && entry.inviteCode === idOrInviteCode,
    );
  }

  listPublicRooms(): RoomSummary[] {
    return [...this.rooms.values()]
      .filter((entry) => entry.visibility === 'public')
      .map((entry) => this.toSummary(entry));
  }

  allManagedRooms(): ManagedRoom[] {
    return [...this.rooms.values()];
  }

  /** Notifié à chaque création de salon, y compris après le démarrage du serveur réseau (lobby,
   * Lot 2.2) — permet à net/server.ts de brancher sa diffusion d'état sur chaque nouvelle room
   * sans que `RoomManager` ait besoin de connaître quoi que ce soit du réseau. */
  onRoomCreated(listener: (managed: ManagedRoom) => void): void {
    this.createListeners.push(listener);
  }

  /** Notifié à chaque suppression automatique d'un salon vide (voir `pruneEmptyRooms`) —
   * permet à net/server.ts de nettoyer son propre état réseau (sockets, index d'intérêt) pour
   * ce salon. */
  onRoomRemoved(listener: (roomId: string) => void): void {
    this.removeListeners.push(listener);
  }

  /** Supprime tout salon non permanent resté vide (0 joueur) plus longtemps que
   * `emptyRoomGraceMs`. Tournée automatiquement en tâche de fond, mais aussi exposée
   * publiquement pour être invoquée à la demande dans les tests, sans attendre un vrai délai
   * d'horloge (même principe que `Room.tick()`, invocable manuellement). */
  pruneEmptyRooms(): void {
    const now = Date.now();
    for (const entry of [...this.rooms.values()]) {
      if (entry.permanent) continue;

      if (this.humanCountOf(entry) > 0) {
        entry.lastNonEmptyAt = now;
        continue;
      }

      if (now - entry.lastNonEmptyAt >= this.emptyRoomGraceMs) {
        this.removeEntry(entry, 'empty_timeout');
      }
    }
  }

  /** Ferme un salon à l'échéance de sa durée de vie (`CreateRoomOptions.durationMs`) —
   * contrairement à `pruneEmptyRooms`, s'applique **inconditionnellement** : des joueurs peuvent
   * très bien être encore connectés au moment de l'expiration. Le réseau (net/server.ts,
   * `onRoomRemoved`) est responsable de fermer leurs sockets — `RoomManager` ne sait rien du
   * réseau, il ne fait que notifier la suppression comme pour n'importe quel autre salon retiré. */
  expireRoom(id: string): void {
    const entry = this.rooms.get(id);
    if (!entry) return; // déjà supprimé par un autre chemin (ex. vidé puis élagué avant l'échéance)
    this.removeEntry(entry, 'duration_expired');
  }

  /** Point de suppression unique d'un salon, quelle que soit la raison (`pruneEmptyRooms` ou
   * `expireRoom`) : arrête la `Room`, annule une éventuelle minuterie d'expiration encore en
   * attente (évite un `expireRoom` orphelin si le salon a déjà été supprimé autrement), retire
   * l'entrée et notifie les auditeurs (voir `onRoomRemoved`, utilisé par net/server.ts pour
   * nettoyer/fermer les sockets de ce salon). */
  private removeEntry(entry: RoomEntry, reason: string): void {
    entry.handle.destroy();
    if (entry.expireTimer) clearTimeout(entry.expireTimer);
    this.rooms.delete(entry.id);
    this.roomStats.delete(entry.id);
    for (const listener of this.removeListeners) listener(entry.id);
    logEvent('room_removed', { roomId: entry.id, reason });
  }

  /** Arrête la tâche de nettoyage automatique et toute minuterie d'expiration de salon encore en
   * attente (`CreateRoomOptions.durationMs`) — à appeler à l'extinction du serveur (ou entre deux
   * tests, pour ne pas laisser de timer actif appeler `expireRoom` après coup). Ne touche pas aux
   * `Room` individuelles : chacune doit être arrêtée séparément (`managed.room.stop()`) si
   * nécessaire. */
  stopPruning(): void {
    clearInterval(this.pruneTimer);
    for (const entry of this.rooms.values()) {
      if (entry.expireTimer) clearTimeout(entry.expireTimer);
    }
  }

  /** Code à 6 chiffres (ex. "042817"), plus court et plus facile à partager à l'oral/par
   * message qu'un UUID complet — au prix d'un espace de valeurs bien plus restreint (1
   * million de combinaisons) : suffisant pour un salon entre amis, mais devinable par force
   * brute bien plus vite qu'un UUID si jamais un attaquant s'y met sérieusement. Ré-essaie en
   * cas de collision avec un salon privé déjà actif (improbable vu `maxRooms`, mais un code
   * dupliqué rendrait deux salons indiscernables au moment de rejoindre). */
  private isInviteCodeTaken(code: string): boolean {
    return [...this.rooms.values()].some((entry) => entry.inviteCode === code);
  }

  private generateInviteCode(): string {
    let code: string;
    do {
      code = String(randomInt(0, INVITE_CODE_UPPER_BOUND)).padStart(INVITE_CODE_DIGITS, '0');
    } while (this.isInviteCodeTaken(code));
    return code;
  }

  private toSummary(entry: RoomEntry): RoomSummary {
    return {
      id: entry.id,
      name: entry.name,
      modId: entry.modId,
      visibility: entry.visibility,
      playerCount: this.playerCountOf(entry),
      maxPlayers: entry.maxPlayers,
      permanent: entry.permanent,
    };
  }

  /** Lecture synchrone directe pour un salon `LocalRoomHost` (défaut, voir index.ts
   * `ROOM_WORKERS`) — strictement équivalente au comportement d'avant ce refactor, y compris sa
   * fraîcheur immédiate (un test peut ajouter un joueur puis vérifier `playerCount` sans attendre
   * qu'un tick ait eu lieu). Pour un salon hébergé par `WorkerRoomHost`, aucune `Room` n'existe
   * dans ce thread : on retombe sur le dernier `RoomStats` reçu (voir `roomStats`, mis à jour à
   * chaque tick par `RoomHandle.onTick` dans `createRoom` ci-dessus), à `0` avant le tout premier
   * tick d'un salon fraîchement créé. Public : réutilisé par `/api/stats` (lobby.ts), qui n'a pas
   * de raison d'accéder à `Room` directement. */
  playerCountOf(entry: ManagedRoom): number {
    if (entry.room) return entry.room.world.allPlayers().length;
    return this.roomStats.get(entry.id)?.playerCount ?? 0;
  }

  humanCountOf(entry: ManagedRoom): number {
    if (entry.room) {
      const botManager = entry.room.botManager;
      return entry.room.world.allPlayers().filter((p) => !botManager?.isBot(p.id)).length;
    }
    return this.roomStats.get(entry.id)?.humanCount ?? 0;
  }

  /** Version complète de `playerCountOf`, pour `/api/admin/health` (server/src/net/metrics.ts) —
   * même préférence "lecture directe si disponible" (voir `playerCountOf`), mais avec la charge
   * de tick en plus. */
  roomStatsOf(entry: ManagedRoom): RoomStats {
    if (entry.room) {
      const metrics = entry.room.tickMetrics();
      const allPlayers = entry.room.world.allPlayers();
      const botManager = entry.room.botManager;
      const humanCount = allPlayers.filter((p) => !botManager?.isBot(p.id)).length;
      return {
        playerCount: allPlayers.length,
        humanCount,
        tickAvgMs: metrics.avgMs,
        tickP95Ms: metrics.p95Ms,
        tickOverruns: metrics.overruns,
      };
    }
    return (
      this.roomStats.get(entry.id) ?? {
        playerCount: 0,
        humanCount: 0,
        tickAvgMs: 0,
        tickP95Ms: 0,
        tickOverruns: 0,
      }
    );
  }
}
