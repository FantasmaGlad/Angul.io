import { randomInt } from 'node:crypto';
import { logEvent } from '../log.js';
import type { GameMod } from './mod.js';
import { Room } from './room.js';
import type { RoomResetSchedule } from './resetSchedule.js';

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
  readonly room: Room;
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
  private nextRoomId = 1;

  constructor(
    private readonly resolveMod: ModResolver,
    private readonly tickRateHz: number,
    options: RoomManagerOptions = {},
  ) {
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

    const { mod, mapSize, kArea, bots } = this.resolveMod(options.modId);
    const botConfig = bots
      ? { ...bots, enabled: options.botsEnabled ?? bots.enabled }
      : undefined;

    const room = new Room(mod, {
      mapSize,
      tickRateHz: this.tickRateHz,
      kArea,
      maxPlayers: options.maxPlayers ?? DEFAULT_MAX_PLAYERS_PER_ROOM,
      bots: botConfig,
      resetSchedule: options.resetSchedule,
    });
    room.start();



    // Id court incrémental plutôt qu'un UUID, pour rester cohérent avec les identifiants
    // d'entités/joueurs (Lot 1.8, économie de bande passante) — même si l'id de salon ne
    // transite pas à chaque tick, mieux vaut une seule convention dans tout le projet. En
    // revanche, cet id est prévisible et énumérable (1, 2, 3…) : un salon privé ne doit
    // jamais être rejoignable par son seul id (voir `inviteCode`, Lot 2.3).
    const id = String(this.nextRoomId++);
    const inviteCode =
      options.visibility === 'private'
        ? (options.inviteCode && /^\d{6}$/.test(options.inviteCode) && !this.isInviteCodeTaken(options.inviteCode)
            ? options.inviteCode
            : this.generateInviteCode())
        : undefined;
    const entry: RoomEntry = {
      id,
      name: options.name,
      modId: options.modId,
      visibility: options.visibility,
      inviteCode,
      room,
      maxPlayers: options.maxPlayers ?? DEFAULT_MAX_PLAYERS_PER_ROOM,
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

      if (entry.room.world.allPlayers().length > 0) {
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
    entry.room.stop();
    if (entry.expireTimer) clearTimeout(entry.expireTimer);
    this.rooms.delete(entry.id);
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
      playerCount: entry.room.world.allPlayers().length,
      maxPlayers: entry.maxPlayers,
      permanent: entry.permanent,
    };
  }
}
