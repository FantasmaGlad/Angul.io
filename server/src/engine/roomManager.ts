import { randomInt } from 'node:crypto';
import { logEvent } from '../log.js';
import type { GameMod } from './mod.js';
import { Room } from './room.js';
import type { RoomResetSchedule } from './resetSchedule.js';

export type RoomVisibility = 'public' | 'private';

/**
 * Résout un identifiant de mode de jeu (ex. "vanilla") en un mod prêt à l'emploi ainsi que la
 * configuration de carte qui va avec (mapSize/kArea). Permet à `RoomManager` de rester
 * indépendant du mécanisme de chargement concret des mods — aujourd'hui uniquement des mods
 * paramétriques (`mods/parametric/`), potentiellement autre chose plus tard (Lot 4).
 */
export type ModResolver = (modId: string) => { mod: GameMod; mapSize: number; kArea?: number };

export interface CreateRoomOptions {
  name: string;
  modId: string;
  visibility: RoomVisibility;
  /** Un salon permanent n'est jamais supprimé automatiquement même vide (voir
   * `emptyRoomGraceMs`) — réservé au salon par défaut créé par index.ts au démarrage. Un
   * salon créé depuis le lobby (Lot 2.2) est toujours non permanent. */
  permanent?: boolean;
  /** Planification du reset automatique (Lot 2.4) — simple relais vers `Room`, qui applique
   * son propre défaut (1x/24h à 10h heure de Paris) si omis. "Configurable par salon" au sens
   * du cahier des charges (§2.1) se limite à ce niveau (modèle de données) pour l'instant :
   * aucun contrôle dans le lobby (client) pour le personnaliser à la création. */
  resetSchedule?: RoomResetSchedule | null;
  /** Capacité maximale de joueurs (refonte UI/UX, formulaire "Créer un salon privé" —
   * "Nombre de Joueurs") — défaut `DEFAULT_MAX_PLAYERS_PER_ROOM` si omis (couvre le salon
   * permanent et tout salon créé sans le préciser). Appliquée au moment du `join` réseau (voir
   * net/server.ts), pas ici : `RoomManager` ne connaît rien des sockets. */
  maxPlayers?: number;
  /** Durée de vie du salon (ms) avant fermeture automatique (refonte UI/UX, champ "Durée" du
   * formulaire de création) — `undefined`/omis = salon sans expiration (comportement d'avant
   * ce champ). À l'expiration, `expireRoom` est invoqué automatiquement (voir `createRoom`),
   * distinct de `pruneEmptyRooms` qui ne supprime que des salons déjà vides : ici le salon peut
   * très bien avoir des joueurs encore connectés au moment de l'expiration. */
  durationMs?: number;
}

/** Vue publique d'un salon, sans exposer la `Room` ni ses internes (utilisée par le lobby, Lot 2.2). */
export interface RoomSummary {
  id: string;
  name: string;
  modId: string;
  visibility: RoomVisibility;
  playerCount: number;
  /** Capacité maximale de joueurs (refonte UI/UX) — affichée côté client en "count/maxPlayers". */
  maxPlayers: number;
  /** `true` pour le salon par défaut créé au démarrage (voir index.ts, `CreateRoomOptions.permanent`)
   * — permet au client de cibler explicitement ce salon (bouton "Rejoindre", fond spectateur)
   * plutôt que de compter sur l'ordre de la liste renvoyée par `listPublicRooms`. */
  permanent: boolean;
}

/** Réponse de `createRoom` pour un salon privé : inclut le code d'invitation, à communiquer au
 * créateur uniquement (jamais renvoyé par `listPublicRooms`, qui ignore de toute façon les
 * salons privés — voir Lot 2.3). */
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
  /** Capacité maximale de joueurs — voir `CreateRoomOptions.maxPlayers`. Appliquée par
   * net/server.ts au moment du `join` réseau. */
  readonly maxPlayers: number;
}

interface RoomEntry extends ManagedRoom {
  readonly permanent: boolean;
  /** Dernier instant (Date.now()) où le salon avait au moins un joueur — sert de base au délai
   * de grâce avant suppression automatique (voir `pruneEmptyRooms`). Initialisé à la création :
   * un salon tout juste créé n'est pas immédiatement éligible à la suppression. */
  lastNonEmptyAt: number;
  /** Minuterie d'expiration (voir `CreateRoomOptions.durationMs`/`expireRoom`) — absente si le
   * salon n'a pas de durée de vie fixée. Conservée pour pouvoir l'annuler si le salon est
   * supprimé d'une autre façon avant son échéance (évite un `expireRoom` orphelin sur un id déjà
   * réutilisé, même si l'id court n'est en pratique jamais réutilisé — voir `nextRoomId`). */
  expireTimer?: ReturnType<typeof setTimeout>;
}

export interface RoomManagerOptions {
  /** Nombre maximal de salons simultanés — protection basique contre un abus de
   * `POST /api/rooms` (Lot 2.2) une fois le lobby exposé publiquement. Au-delà, `createRoom`
   * lève une erreur (400 côté API HTTP, voir net/server.ts). */
  maxRooms?: number;
  /** Durée (ms) au-delà de laquelle un salon vide (0 joueur) et non permanent est supprimé
   * automatiquement — évite une croissance illimitée de la mémoire si le lobby est exposé
   * publiquement sans authentification ni limite de création. */
  emptyRoomGraceMs?: number;
  /** Intervalle (ms) entre deux passages de nettoyage automatique. */
  pruneIntervalMs?: number;
}

const DEFAULT_MAX_ROOMS = 100;
const DEFAULT_EMPTY_ROOM_GRACE_MS = 10 * 60_000; // 10 minutes
const DEFAULT_PRUNE_INTERVAL_MS = 30_000;
const INVITE_CODE_DIGITS = 6;
const INVITE_CODE_UPPER_BOUND = 10 ** INVITE_CODE_DIGITS;
/** Capacité par défaut d'un salon dont `maxPlayers` n'a pas été précisé (salon permanent créé
 * par index.ts, ou tout salon créé sans le champ "Nombre de Joueurs") — largement au-dessus de
 * la charge cible du MVP (10-50 joueurs simultanés, cahier des charges §2.1), simple garde-fou
 * plutôt qu'une vraie contrainte de capacité pour l'usage courant. */
const DEFAULT_MAX_PLAYERS_PER_ROOM = 100;

/**
 * Registre des salons actifs en mémoire (Lot 2.1). Un salon unique codé en dur (Lot 1) devient un
 * ensemble dynamique de salons, créés à la demande, chacun avec sa propre `Room` — donc sa propre
 * boucle de tick et sa propre simulation, totalement indépendante des autres (§4.3 du cahier des
 * charges). `RoomManager` ne fait qu'assembler/cataloguer des `Room` ; il ne sait rien du réseau
 * (net/server.ts) ni du contenu des mods.
 *
 * Durcissement (avant exposition publique via DuckDNS/install.sh) : un salon non permanent vide
 * depuis trop longtemps est supprimé automatiquement, et le nombre total de salons est plafonné —
 * sans ces deux garde-fous, `POST /api/rooms` (Lot 2.2) exposé sur Internet sans authentification
 * permettrait une croissance illimitée de la mémoire.
 */
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

    const { mod, mapSize, kArea } = this.resolveMod(options.modId);
    const room = new Room(mod, {
      mapSize,
      tickRateHz: this.tickRateHz,
      kArea,
      resetSchedule: options.resetSchedule,
    });
    room.start();

    // Id court incrémental plutôt qu'un UUID, pour rester cohérent avec les identifiants
    // d'entités/joueurs (Lot 1.8, économie de bande passante) — même si l'id de salon ne
    // transite pas à chaque tick, mieux vaut une seule convention dans tout le projet. En
    // revanche, cet id est prévisible et énumérable (1, 2, 3…) : un salon privé ne doit
    // jamais être rejoignable par son seul id (voir `inviteCode`, Lot 2.3).
    const id = String(this.nextRoomId++);
    const inviteCode = options.visibility === 'private' ? this.generateInviteCode() : undefined;
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
  private generateInviteCode(): string {
    let code: string;
    do {
      code = String(randomInt(0, INVITE_CODE_UPPER_BOUND)).padStart(INVITE_CODE_DIGITS, '0');
    } while ([...this.rooms.values()].some((entry) => entry.inviteCode === code));
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
