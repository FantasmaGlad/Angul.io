import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import {
  distance,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_EXPIRED,
  WS_CLOSE_ROOM_FULL,
  WS_CLOSE_ROOM_NOT_FOUND,
  type ClientMessage,
  type EntitySnapshot,
  type ServerMessage,
} from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { SpatialHash } from '../engine/spatialHash.js';
import { AccountError, type AccountsService } from '../accounts/service.js';
import type { AdminAuth } from '../admin/adminAuth.js';
import type { ManagedRoom, RoomManager, RoomVisibility } from '../engine/roomManager.js';
import type { Entity, PlayerId } from '../engine/types.js';
import { activeComboLevel } from '../engine/xp.js';
import { logEvent } from '../log.js';

export interface GameServerOptions {
  port: number;
  /** Répertoire de fichiers statiques du client à servir (Lot 1.7), optionnel. */
  staticDir?: string;
  /** Rayon (px, unité de simulation) autour de la caméra de chaque joueur au-delà duquel les
   * entités ne sont plus diffusées à ce client — voir "interest management" ci-dessous.
   * Volontairement généreux et fixe plutôt que calé sur le zoom réel du client (qui varie avec
   * sa taille d'écran, inconnue du serveur) : suffisant pour la plupart des cas, à affiner plus
   * tard si le client transmet un jour ses dimensions de viewport. */
  interestRadiusPx?: number;
  /** Modes de jeu proposables à la création d'un salon depuis le lobby (`GET /api/modes`, Lot
   * 2.2) — fourni par l'appelant (index.ts) plutôt que déduit ici, pour ne pas coupler ce
   * module réseau au mécanisme de chargement concret des mods (mods paramétriques aujourd'hui). */
  availableModIds?: string[];
  /** Comptes joueurs (Lot 3.2-3.6) — optionnel : absent, le serveur fonctionne exactement comme
   * avant (parties anonymes uniquement, aucune route `/api/auth/*`/`/api/account/*` ni écriture
   * de stats), pour ne pas forcer `DATABASE_URL` sur un environnement de test/dev qui n'en a pas
   * besoin (voir server/src/db/pool.ts). */
  accounts?: AccountsService;
  /** Authentification admin (Lot 5.1) — optionnelle comme `accounts`, mêmes raisons (pas de
   * plantage sans `ADMIN_PASSWORD_HASH` configuré, voir AdminAuth.isConfigured). */
  admin?: AdminAuth;
  /** Répertoire de fichiers statiques de l'interface d'administration (Lot 5), servis sous
   * `/admin/*` — distincte du client joueur (`staticDir`), cahier des charges §5.4 ("séparée
   * du client joueur"). */
  adminStaticDir?: string;
}

const MAX_NICKNAME_LENGTH = 20;
const MAX_ROOM_NAME_LENGTH = 40;
const MAX_REQUEST_BODY_BYTES = 10_000;
const INTEREST_RADIUS_PX_DEFAULT = 3000;
/** Bornes de validation "clémente" (mêmes principes que `parseAdminPatch`) pour les nouveaux
 * champs du formulaire "Créer un salon privé" (refonte UI/UX : Nombre de Joueurs, Durée) — une
 * valeur hors bornes ou du mauvais type est simplement ignorée (repli sur le défaut de
 * `RoomManager`), pas un 400 qui ferait échouer toute la création pour un souci mineur de forme. */
const MIN_ROOM_MAX_PLAYERS = 2;
const MAX_ROOM_MAX_PLAYERS = 200;
const MIN_ROOM_DURATION_MS = 60_000; // 1 minute
const MAX_ROOM_DURATION_MS = 24 * 60 * 60_000; // 24h

export interface GameServerHandle {
  /** Résout avec le port réellement utilisé (utile en test avec `port: 0`). */
  whenReady: Promise<number>;
  close(): void;
}

/** État réseau propre à un salon : sockets connectées et index spatial d'intérêt. Un salon =
 * une `Room` (simulation) + ce runtime (diffusion réseau) — les deux sont indépendants d'un
 * salon à l'autre (Lot 2.1/2.5). */
interface RoomRuntime {
  sockets: Map<PlayerId, WebSocket>;
  interestHash: SpatialHash;
  nextPlayerId: number;
  /** Id de compte (Lot 3.2) associé à une connexion, uniquement pour les joueurs authentifiés
   * (`?token=` valide à la connexion WS) — absent pour une partie en invité, qui reste possible
   * (voir `GameServerOptions.accounts`). */
  accountIdByPlayer: Map<PlayerId, number>;
  /** Masse totale maximale observée depuis le dernier spawn, pour les joueurs authentifiés
   * uniquement — c'est le "score" écrit en base à la mort (Lot 3.5), en l'absence de tout autre
   * système de score. Remise à 0 à chaque respawn, pas seulement à la connexion. */
  maxMassByPlayer: Map<PlayerId, number>;
  /** Ids de `sockets` correspondant à un spectateur (fond animé de l'accueil, refonte UI/UX) —
   * jamais ajoutés à `world` (aucun morceau, jamais compté dans `playerCount`/`maxPlayers`), donc
   * exclus de `recordAccountStats`/`room.removePlayer` à la fermeture de leur socket : il n'y a
   * ni compte ni joueur du monde à nettoyer pour eux. */
  spectatorIds: Set<PlayerId>;
}

/**
 * Branche un `RoomManager` sur un serveur HTTP + WebSocket : expose l'API du lobby (Lot 2.2,
 * `GET /api/rooms`, `POST /api/rooms`, `GET /api/modes`) et route chaque connexion WebSocket
 * vers le salon demandé (`?roomId=`) plutôt que vers un salon unique codé en dur (Lot 1). Gère
 * join → welcome, input, close → `removePlayer`, ignore silencieusement un message malformé
 * (pas de crash serveur). Optimisations réseau (Lot 1.8), inchangées mais désormais par salon :
 *   - compression WebSocket (`perMessageDeflate`) ;
 *   - nombres arrondis avant sérialisation (la précision flottante complète est inutile) ;
 *   - *interest management* : chaque client ne reçoit que les entités proches de sa propre
 *     caméra (+ toujours ses propres morceaux), pas le salon entier.
 */
export function startGameServer(
  roomManager: RoomManager,
  options: GameServerOptions,
): GameServerHandle {
  const interestRadiusPx = options.interestRadiusPx ?? INTEREST_RADIUS_PX_DEFAULT;
  const runtimes = new Map<string, RoomRuntime>();

  function wireRoom(managed: ManagedRoom): void {
    const runtime: RoomRuntime = {
      sockets: new Map(),
      // Grille dédiée à l'interest management, distincte de celle des collisions (World) :
      // maille large (= interestRadiusPx) pour qu'une requête sur les 9 cellules voisines
      // couvre bien tout le rayon d'intérêt, quel que soit l'endroit de sa cellule où se
      // trouve le point interrogé.
      interestHash: new SpatialHash(interestRadiusPx),
      nextPlayerId: 1,
      accountIdByPlayer: new Map(),
      maxMassByPlayer: new Map(),
      spectatorIds: new Set(),
    };
    runtimes.set(managed.id, runtime);

    managed.room.onState((tick) => {
      if (runtime.sockets.size === 0) return; // rien à diffuser si personne n'est connecté

      runtime.interestHash.clear();
      for (const entity of managed.room.world.allEntities()) runtime.interestHash.insert(entity);

      for (const [playerId, socket] of runtime.sockets) {
        const ownPieces = managed.room.world.getPiecesByOwner(playerId);
        const center = centroidOf(ownPieces) ?? {
          x: managed.room.world.mapSize / 2,
          y: managed.room.world.mapSize / 2,
        };

        // Toujours voir ses propres morceaux, même hors du rayon d'intérêt (ne devrait pas
        // arriver en pratique puisque le rayon est centré dessus, mais reste correct si jamais).
        const visible = new Map<string, Entity>();
        for (const piece of ownPieces) visible.set(piece.id, piece);

        for (const id of runtime.interestHash.queryNearby(center)) {
          const entity = managed.room.world.getEntity(id);
          if (entity && distance(entity.position, center) <= interestRadiusPx) {
            visible.set(entity.id, entity);
          }
        }

        const entities: EntitySnapshot[] = [...visible.values()].map(toSnapshot);

        const totalMass = ownPieces.reduce((sum, piece) => sum + piece.mass, 0);
        const accelerationPerSec2 =
          totalMass > 0 ? managed.room.getAccelerationForMass(totalMass) : undefined;

        // Combo de joueurs mangés (demande utilisateur, engine/xp.ts) : absent pour un
        // spectateur (jamais ajouté à `world`, voir le mode spectateur ci-dessous) ou tant
        // qu'aucun combo n'est actif pour ce joueur.
        const player = managed.room.world.getPlayer(playerId);
        const comboLevel = player
          ? activeComboLevel(player.lifeStats.combo, performance.now())
          : undefined;

        const selfFields: { accelerationPerSec2?: number; combo?: { level: number } } = {};
        if (accelerationPerSec2 !== undefined) selfFields.accelerationPerSec2 = accelerationPerSec2;
        if (comboLevel !== undefined) selfFields.combo = { level: comboLevel };
        const self = Object.keys(selfFields).length > 0 ? selfFields : undefined;

        send(socket, { type: 'state', tick, entities, self });

        // Lot 3.5 : uniquement pour les joueurs authentifiés (voir `accountIdByPlayer`) — un
        // invité n'a pas de compte où écrire un score.
        if (runtime.accountIdByPlayer.has(playerId)) {
          const previousMax = runtime.maxMassByPlayer.get(playerId) ?? 0;
          if (totalMass > previousMax) runtime.maxMassByPlayer.set(playerId, totalMass);
        }
      }
    });

    managed.room.onPlayerDeath((playerId) => {
      logEvent('player_died', { roomId: managed.id, playerId });
      recordAccountStats(options.accounts, managed, runtime, playerId);
      // Remise à 0 (pas suppression) : le respawn immédiat du MVP (voir mods/parametric) fait
      // que la connexion continue, seule la vie précédente est terminée.
      if (runtime.accountIdByPlayer.has(playerId)) runtime.maxMassByPlayer.set(playerId, 0);
      const socket = runtime.sockets.get(playerId);
      if (socket) send(socket, { type: 'died' });
    });

    // Reset automatique (Lot 2.4) : chaque joueur connecté vient de recevoir un morceau tout
    // neuf (Room.reset()) — on réutilise le message `died` existant plutôt qu'un nouveau type
    // de message : du point de vue du client, "je respawn" est exactement ce qui se passe.
    managed.room.onReset(() => {
      logEvent('room_reset', { roomId: managed.id });
      for (const socket of runtime.sockets.values()) send(socket, { type: 'died' });
    });
  }

  // Brancher les salons déjà créés avant le démarrage du serveur réseau, et tout salon créé
  // après coup (lobby, Lot 2.2) — RoomManager ne sait rien du réseau, c'est ici qu'on l'y relie.
  for (const managed of roomManager.allManagedRooms()) wireRoom(managed);
  roomManager.onRoomCreated(wireRoom);
  // Un salon supprimé pour cause de vacance prolongée (durcissement avant exposition publique)
  // n'a par construction plus aucune socket active dans son runtime. Ce n'est en revanche plus
  // vrai depuis l'ajout de la durée de vie de salon (refonte UI/UX, `RoomManager.expireRoom`) :
  // un salon peut expirer avec des joueurs encore connectés — fermer explicitement leurs sockets
  // ici évite de les laisser "orphelines" (plus aucun tick/diffusion d'état ne viendra jamais,
  // sans cette fermeture le client resterait bloqué sur un écran de jeu figé).
  roomManager.onRoomRemoved((roomId) => {
    const runtime = runtimes.get(roomId);
    if (runtime) {
      for (const socket of runtime.sockets.values()) {
        socket.close(WS_CLOSE_ROOM_EXPIRED, 'Salon fermé (durée écoulée).');
      }
    }
    runtimes.delete(roomId);
  });

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(
      roomManager,
      options.staticDir,
      options.availableModIds ?? [],
      options.accounts,
      options.admin,
      options.adminStaticDir,
      req,
      res,
    );
  });

  const wss = new WebSocketServer({ server: httpServer, perMessageDeflate: true });

  wss.on('connection', (socket: WebSocket, request: IncomingMessage) => {
    const requestUrl = new URL(request.url ?? '/', 'http://localhost');
    const roomId = requestUrl.searchParams.get('roomId');
    const managed = roomId ? roomManager.getManagedRoom(roomId) : undefined;
    if (!managed) {
      // Pas de salon par défaut implicite : depuis le lobby (Lot 2.2), le client choisit
      // toujours un salon avant d'ouvrir la connexion WebSocket.
      logEvent('join_rejected', { requestedRoomId: roomId });
      socket.close(WS_CLOSE_ROOM_NOT_FOUND, 'Salon introuvable');
      return;
    }
    const runtime = runtimes.get(managed.id)!;

    // Mode spectateur (`?spectate=1`, refonte UI/UX — fond animé de l'accueil) : une lecture
    // seule du salon, jamais un joueur. Aucun message `join` n'est attendu ni nécessaire : le
    // `welcome` part immédiatement, et comme ce socket n'est jamais ajouté à `world`
    // (`spectatorIds` sert uniquement à l'exclure du nettoyage de compte à la fermeture), la
    // boucle de diffusion existante (`managed.room.onState`, plus haut) n'a besoin d'aucune
    // adaptation : `getPiecesByOwner` renvoie déjà `[]` pour un id absent de `world`, et
    // `centroidOf([])` retombe déjà sur le centre de la carte (voir plus bas) — exactement le
    // cadrage voulu pour un fond décoratif.
    if (requestUrl.searchParams.get('spectate') === '1') {
      const spectatorId = `spec-${runtime.nextPlayerId++}`;
      runtime.sockets.set(spectatorId, socket);
      runtime.spectatorIds.add(spectatorId);
      logEvent('spectator_join', { roomId: managed.id, spectatorId });
      send(socket, {
        type: 'welcome',
        playerId: spectatorId,
        mapSize: managed.room.world.mapSize,
      });
      socket.on('close', () => {
        runtime.sockets.delete(spectatorId);
        runtime.spectatorIds.delete(spectatorId);
      });
      return;
    }

    // `?token=` (Lot 3.3) : un jeton absent/inconnu laisse simplement la partie continuer en
    // invité (pas d'erreur) — l'authentification est un ajout au-dessus du flux existant, pas
    // un prérequis pour jouer (voir GameServerOptions.accounts).
    const accountId = options.accounts?.resolveToken(
      requestUrl.searchParams.get('token') ?? undefined,
    );

    let playerId: PlayerId | undefined;

    socket.on('message', (raw: Buffer) => {
      const message = parseClientMessage(raw);
      if (!message) {
        logEvent('malformed_message', { roomId: managed.id, playerId });
        return;
      }

      if (message.type === 'join' && !playerId) {
        const nickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || 'Joueur';

        // Capacité de salon (refonte UI/UX, champ "Nombre de Joueurs") : vérifiée avant toute
        // création de joueur/socket enregistrée — un salon plein refuse la connexion plutôt que
        // de la laisser ouverte sans jamais recevoir de `welcome`.
        if (managed.room.world.allPlayers().length >= managed.maxPlayers) {
          logEvent('join_rejected', { roomId: managed.id, reason: 'room_full' });
          socket.close(WS_CLOSE_ROOM_FULL, 'Salon complet.');
          return;
        }

        // Unicité de pseudo par salon (refonte UI/UX) : comparée aux joueurs déjà EN JEU dans CE
        // salon (pas au pseudo de compte, ni aux autres salons) — insensible à la casse. Deux
        // blobs au même nom dans le même salon prêteraient à confusion (le pseudo s'affiche
        // au-dessus du morceau, voir render.ts), donc refusé plutôt que dédupliqué en silence.
        const nicknameTaken = managed.room.world
          .allPlayers()
          .some((player) => player.nickname.toLowerCase() === nickname.toLowerCase());
        if (nicknameTaken) {
          logEvent('join_rejected', { roomId: managed.id, reason: 'nickname_taken', nickname });
          socket.close(WS_CLOSE_NICKNAME_TAKEN, 'Pseudo déjà utilisé sur ce salon.');
          return;
        }

        playerId = String(runtime.nextPlayerId++);
        runtime.sockets.set(playerId, socket);
        if (accountId !== undefined) {
          runtime.accountIdByPlayer.set(playerId, accountId);
          runtime.maxMassByPlayer.set(playerId, 0);
        }
        managed.room.addPlayer(playerId, nickname);
        logEvent('player_join', { roomId: managed.id, playerId, nickname });
        send(socket, { type: 'welcome', playerId, mapSize: managed.room.world.mapSize });

        // Le nouvel arrivant apprend les pseudos déjà connus (les autres, pas lui — couvert
        // par la diffusion ci-dessous, qui l'inclut).
        for (const existingPlayer of managed.room.world.allPlayers()) {
          if (existingPlayer.id === playerId) continue;
          send(socket, {
            type: 'player',
            playerId: existingPlayer.id,
            nickname: existingPlayer.nickname,
          });
        }
        // Tout le monde (dans ce salon) apprend le nouveau pseudo — message rare, pas répété
        // à chaque tick (Lot 1.8).
        const playerInfo: ServerMessage = { type: 'player', playerId, nickname };
        for (const otherSocket of runtime.sockets.values()) send(otherSocket, playerInfo);
        return;
      }

      if (message.type === 'input' && playerId) {
        // `split` n'est vrai que sur le tick où le joueur appuie sur espace (déclenchement, pas
        // un état maintenu — voir protocol.ts) : une entrée de log par pression, pas un flot
        // continu comme le serait journaliser chaque message `input` (20/s/joueur).
        if (message.split) logEvent('player_split_requested', { roomId: managed.id, playerId });
        managed.room.handleInput(playerId, {
          target: message.target,
          intensity: message.intensity,
          split: message.split,
        });
        return;
      }

      if (message.type === 'ping') {
        // Renvoyé tel quel dès réception : mesure de latence réelle pour l'écran de debug F3
        // (le client calcule le round-trip lui-même à partir de `t`).
        send(socket, { type: 'pong', t: message.t });
      }
    });

    socket.on('close', () => {
      if (!playerId) return;
      logEvent('player_leave', { roomId: managed.id, playerId });
      // Une déconnexion est aussi une "fin de partie" pour ce joueur (Lot 3.5) — écrite avant
      // le nettoyage des maps ci-dessous, qui efface justement la donnée à écrire.
      recordAccountStats(options.accounts, managed, runtime, playerId);
      managed.room.removePlayer(playerId);
      runtime.sockets.delete(playerId);
      runtime.accountIdByPlayer.delete(playerId);
      runtime.maxMassByPlayer.delete(playerId);
    });
  });

  const whenReady = new Promise<number>((resolvePort) => {
    httpServer.listen(options.port, () => {
      const address = httpServer.address();
      resolvePort(typeof address === 'object' && address ? address.port : options.port);
    });
  });

  return {
    whenReady,
    close: () => {
      wss.close();
      httpServer.close();
    },
  };
}

/** Lot 3.5 : n'écrit rien pour un invité (pas de compte, voir `accountIdByPlayer`) ni pour un
 * joueur authentifié qui n'a jamais eu de masse (ex. déconnexion avant tout spawn). Écriture
 * en base best-effort (asynchrone, erreur seulement loggée) — ne doit jamais bloquer ni faire
 * planter la diffusion réseau, qui a déjà eu lieu quand cette fonction est appelée. */
function recordAccountStats(
  accounts: AccountsService | undefined,
  managed: ManagedRoom,
  runtime: RoomRuntime,
  playerId: PlayerId,
): void {
  if (!accounts) return;
  const accountId = runtime.accountIdByPlayer.get(playerId);
  if (accountId === undefined) return;

  const rawScore = runtime.maxMassByPlayer.get(playerId) ?? 0;
  const player = managed.room.world.getPlayer(playerId);
  const rawXp = player?.lifeStats.xpEarned ?? 0;
  // Remise à zéro immédiatement après lecture (pas par le mod lui-même, voir engine/xp.ts) : le
  // respawn immédiat du MVP recrée un morceau avant que ce point du réseau ait pu lire le cumul
  // de la vie qui vient de se terminer, donc c'est ici — juste après l'avoir lu — qu'il faut
  // repartir de zéro pour la vie suivante.
  if (player) managed.room.world.resetLifeStats(playerId);

  // Lot 4 (Hardcore) : un mod peut annuler tout crédit (score ET xp) pour cette vie (voir
  // `GameMod.transformScoreForAccount`) — identité pour les mods qui ne l'implémentent pas.
  const { score, xp } = managed.room.transformScoreForAccount(rawScore, rawXp);
  if (score <= 0 && xp <= 0) return;

  accounts.recordGameResult(accountId, managed.modId, score, xp).catch((error: unknown) => {
    logEvent('account_stats_write_failed', {
      roomId: managed.id,
      playerId,
      reason: (error as Error).message,
    });
  });
}

function centroidOf(pieces: Entity[]): { x: number; y: number } | undefined {
  if (pieces.length === 0) return undefined;

  let totalMass = 0;
  let x = 0;
  let y = 0;
  for (const piece of pieces) {
    totalMass += piece.mass;
    x += piece.position.x * piece.mass;
    y += piece.position.y * piece.mass;
  }
  return { x: x / totalMass, y: y / totalMass };
}

/** Arrondi à 1 décimale : la précision flottante complète (ex. `1579.9018746980125`) n'apporte
 * rien visuellement mais alourdit sensiblement chaque message (Lot 1.8). Utilisé pour
 * position/rayon, qui affectent directement le rendu — le dixième de pixel évite un
 * "escalier" perceptible au zoom maximal du client (×2, render.ts). */
function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** La masse n'est jamais utilisée pixel par pixel côté client (seul `r`, déjà arrondi, sert au
 * rendu ; `m` n'influence que le calcul de zoom de la caméra, insensible à ±0.5) — un entier
 * suffit et coûte un caractère de moins par entité que `round1`. */
function roundMass(value: number): number {
  return Math.round(value);
}

function toSnapshot(entity: Entity): EntitySnapshot {
  return {
    i: entity.id,
    k: entity.kind === 'particle' ? 'f' : 'c',
    x: round1(entity.position.x),
    y: round1(entity.position.y),
    r: round1(entity.radius),
    m: roundMass(entity.mass),
    p: entity.ownerId,
  };
}

function parseClientMessage(raw: Buffer): ClientMessage | undefined {
  try {
    const parsed: unknown = JSON.parse(raw.toString());
    if (parsed && typeof parsed === 'object' && 'type' in parsed) {
      return parsed as ClientMessage;
    }
  } catch {
    // message malformé : ignoré silencieusement, pas de crash serveur pour un client qui envoie n'importe quoi
  }
  return undefined;
}

function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(message));
}

// --- API HTTP du lobby (Lot 2.2) ----------------------------------------

async function handleHttpRequest(
  roomManager: RoomManager,
  staticDir: string | undefined,
  availableModIds: string[],
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  adminStaticDir: string | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    respondJson(res, 200, roomManager.listPublicRooms());
    return;
  }

  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    await handleCreateRoom(roomManager, accounts, req, res);
    return;
  }

  if (url.pathname === '/api/modes' && req.method === 'GET') {
    respondJson(res, 200, availableModIds);
    return;
  }

  if (url.pathname === '/api/stats' && req.method === 'GET') {
    // "N Joueurs Connectés" (refonte UI/UX, accueil) : compte réel tous salons confondus, y
    // compris privés — un simple total n'expose rien de leur contenu (nom, mode…), contrairement
    // à `GET /api/rooms` qui ignore volontairement les salons privés. Exclut nativement les
    // spectateurs (jamais ajoutés à `world`, voir le mode spectateur plus haut).
    const playersOnline = roomManager
      .allManagedRooms()
      .reduce((sum, managed) => sum + managed.room.world.allPlayers().length, 0);
    respondJson(res, 200, { playersOnline });
    return;
  }

  if (url.pathname === '/api/auth/register' && req.method === 'POST') {
    await handleRegisterOrLogin(accounts, 'register', req, res);
    return;
  }

  if (url.pathname === '/api/auth/login' && req.method === 'POST') {
    await handleRegisterOrLogin(accounts, 'login', req, res);
    return;
  }

  if (url.pathname === '/api/account/me' && req.method === 'GET') {
    await handleGetProfile(accounts, req, res);
    return;
  }

  // --- Interface admin (Lot 5) -------------------------------------------------------------

  if (url.pathname === '/api/admin/login' && req.method === 'POST') {
    await handleAdminLogin(admin, req, res);
    return;
  }

  if (url.pathname === '/api/admin/players' && req.method === 'GET') {
    await handleAdminSearchPlayers(accounts, admin, url, req, res);
    return;
  }

  const adminPlayerMatch = /^\/api\/admin\/players\/(\d+)$/.exec(url.pathname);
  if (adminPlayerMatch && req.method === 'GET') {
    await handleAdminGetPlayer(accounts, admin, Number(adminPlayerMatch[1]), req, res);
    return;
  }
  if (adminPlayerMatch && req.method === 'PATCH') {
    await handleAdminUpdatePlayer(accounts, admin, Number(adminPlayerMatch[1]), req, res);
    return;
  }

  // Interface admin servie sous /admin/* (Lot 5.4, "séparée du client joueur") — même serveur,
  // répertoire statique distinct de `staticDir`, comme les routes /api/admin/* ci-dessus.
  if (adminStaticDir && (url.pathname === '/admin' || url.pathname.startsWith('/admin/'))) {
    const stripped = url.pathname.slice('/admin'.length);
    await serveStatic(
      adminStaticDir,
      stripped === '' || stripped === '/' ? '/index.html' : stripped,
      res,
    );
    return;
  }

  await serveStatic(
    staticDir,
    req.url && req.url !== '/' ? req.url.split('?')[0]! : '/index.html',
    res,
  );
}

/**
 * Lot 3.2 — `register` et `login` répondent au même format (`{token, pseudo}`) : l'inscription
 * connecte immédiatement (pas d'étape de confirmation par email pour le MVP, cahier des
 * charges §5.1), donc le client n'a besoin de distinguer les deux que pour savoir quel
 * formulaire afficher, pas pour traiter la réponse.
 */
async function handleRegisterOrLogin(
  accounts: AccountsService | undefined,
  action: 'register' | 'login',
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const pseudo = isRecord(body) && typeof body.pseudo === 'string' ? body.pseudo.trim() : '';
  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';

  try {
    const result =
      action === 'register'
        ? await accounts.register(pseudo, password)
        : await accounts.login(pseudo, password);
    logEvent(action === 'register' ? 'account_registered' : 'account_login', { pseudo });
    respondJson(res, action === 'register' ? 201 : 200, result);
  } catch (error) {
    const statusCode = action === 'login' ? 401 : 400;
    if (error instanceof AccountError) {
      respondJson(res, statusCode, { error: error.message });
      return;
    }
    logEvent('account_error', { action, reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}

async function handleGetProfile(
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  const accountId = accounts.resolveToken(getBearerToken(req));
  if (accountId === undefined) {
    respondJson(res, 401, { error: 'Non authentifié.' });
    return;
  }

  const profile = await accounts.getProfile(accountId);
  if (!profile) {
    respondJson(res, 404, { error: 'Compte introuvable.' });
    return;
  }
  respondJson(res, 200, profile);
}

function getBearerToken(req: IncomingMessage): string | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  return header.slice('Bearer '.length).trim() || undefined;
}

/**
 * Lot 6.4 — cahier des charges §5.3 : la création de salon est un avantage réservé aux comptes
 * Premium (un compte standard, ou un invité sans compte du tout, rejoint les salons existants).
 * Sans `accounts` configuré (DB absente), le concept même de compte/Premium n'existe pas dans cet
 * environnement — la création reste ouverte à tous, comme avant ce Lot, plutôt que de bloquer un
 * dev/test local qui n'a pas de base de données (même philosophie de dégradation gracieuse que
 * le reste de `GameServerOptions.accounts`).
 */
async function handleCreateRoom(
  roomManager: RoomManager,
  accounts: AccountsService | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (accounts) {
    const accountId = accounts.resolveToken(getBearerToken(req));
    if (!(await accounts.isPremium(accountId))) {
      logEvent('room_create_rejected', { reason: 'not_premium' });
      respondJson(res, 403, {
        error: 'La création de salon est réservée aux comptes Premium (voir la page Soutien).',
      });
      return;
    }
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    logEvent('room_create_rejected', { reason: (error as Error).message });
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const nameRaw = isRecord(body) ? body.name : undefined;
  const modId = isRecord(body) ? body.modId : undefined;
  const visibilityRaw = isRecord(body) ? body.visibility : undefined;
  const name = typeof nameRaw === 'string' ? nameRaw.trim().slice(0, MAX_ROOM_NAME_LENGTH) : '';
  const visibility: RoomVisibility = visibilityRaw === 'private' ? 'private' : 'public';

  // Nombre de Joueurs / Durée (refonte UI/UX, formulaire "Créer un salon privé") : validation
  // clémente, une valeur absente/hors bornes est ignorée (repli sur le défaut de RoomManager)
  // plutôt que de faire échouer toute la création pour un souci mineur de forme.
  const maxPlayersRaw = isRecord(body) ? body.maxPlayers : undefined;
  const maxPlayers =
    typeof maxPlayersRaw === 'number' &&
    Number.isInteger(maxPlayersRaw) &&
    maxPlayersRaw >= MIN_ROOM_MAX_PLAYERS &&
    maxPlayersRaw <= MAX_ROOM_MAX_PLAYERS
      ? maxPlayersRaw
      : undefined;

  const durationMsRaw = isRecord(body) ? body.durationMs : undefined;
  const durationMs =
    typeof durationMsRaw === 'number' &&
    durationMsRaw >= MIN_ROOM_DURATION_MS &&
    durationMsRaw <= MAX_ROOM_DURATION_MS
      ? durationMsRaw
      : undefined;

  if (!name) {
    logEvent('room_create_rejected', { reason: 'missing_name' });
    respondJson(res, 400, { error: 'Le nom du salon est requis.' });
    return;
  }
  if (typeof modId !== 'string' || !modId) {
    logEvent('room_create_rejected', { reason: 'missing_modId' });
    respondJson(res, 400, { error: 'Le mode de jeu (modId) est requis.' });
    return;
  }

  try {
    const summary = roomManager.createRoom({ name, modId, visibility, maxPlayers, durationMs });
    respondJson(res, 201, summary);
  } catch (error) {
    logEvent('room_create_rejected', { reason: (error as Error).message });
    respondJson(res, 400, { error: (error as Error).message });
  }
}

// --- Interface admin (Lot 5) ---------------------------------------------------------------

async function handleAdminLogin(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!admin?.isConfigured) {
    respondJson(res, 503, {
      error: 'Interface admin indisponible (ADMIN_PASSWORD_HASH non configuré).',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  const password = isRecord(body) && typeof body.password === 'string' ? body.password : '';
  const token = await admin.login(password);
  if (!token) {
    logEvent('admin_login_failed', {});
    respondJson(res, 401, { error: 'Mot de passe incorrect.' });
    return;
  }
  logEvent('admin_login', {});
  respondJson(res, 200, { token });
}

/** `true` si authentifié (l'appelant peut continuer) ; répond déjà 401/503 et renvoie `false`
 * sinon — chaque route admin commence par `if (!(await requireAdmin(...))) return;`. */
function requireAdmin(
  admin: AdminAuth | undefined,
  req: IncomingMessage,
  res: ServerResponse,
): boolean {
  if (!admin?.isConfigured) {
    respondJson(res, 503, {
      error: 'Interface admin indisponible (ADMIN_PASSWORD_HASH non configuré).',
    });
    return false;
  }
  if (!admin.isAuthenticated(getBearerToken(req))) {
    respondJson(res, 401, { error: 'Non authentifié (admin).' });
    return false;
  }
  return true;
}

async function handleAdminSearchPlayers(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  url: URL,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }
  const query = url.searchParams.get('q')?.trim() ?? '';
  respondJson(res, 200, await accounts.searchAccountsForAdmin(query));
}

async function handleAdminGetPlayer(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  accountId: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }
  const account = await accounts.getAccountForAdmin(accountId);
  if (!account) {
    respondJson(res, 404, { error: 'Compte introuvable.' });
    return;
  }
  respondJson(res, 200, account);
}

async function handleAdminUpdatePlayer(
  accounts: AccountsService | undefined,
  admin: AdminAuth | undefined,
  accountId: number,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!requireAdmin(admin, req, res)) return;
  if (!accounts) {
    respondJson(res, 503, {
      error: 'Comptes joueurs indisponibles (base de données non configurée).',
    });
    return;
  }

  let body: unknown;
  try {
    body = await readJsonBody(req);
  } catch (error) {
    respondJson(res, 400, { error: (error as Error).message });
    return;
  }

  try {
    const updated = await accounts.updateAccountForAdmin(accountId, parseAdminPatch(body));
    if (!updated) {
      respondJson(res, 404, { error: 'Compte introuvable.' });
      return;
    }
    logEvent('admin_account_updated', { accountId });
    respondJson(res, 200, updated);
  } catch (error) {
    if (error instanceof AccountError) {
      respondJson(res, 400, { error: error.message });
      return;
    }
    logEvent('account_error', { action: 'admin_update', reason: (error as Error).message });
    respondJson(res, 500, { error: 'Erreur serveur.' });
  }
}

/** Extraction "leniente" des champs (typage, pas de règles métier — voir `validateAdminPatch`
 * côté service) : un champ absent ou d'un type inattendu est simplement ignoré plutôt que de
 * faire échouer toute la requête, même principe que `handleCreateRoom`. */
function parseAdminPatch(body: unknown): {
  level?: number;
  xp?: number;
  premium?: boolean;
  cosmetics?: string[];
  banned?: boolean;
} {
  if (!isRecord(body)) return {};
  const patch: {
    level?: number;
    xp?: number;
    premium?: boolean;
    cosmetics?: string[];
    banned?: boolean;
  } = {};
  if (typeof body.level === 'number') patch.level = body.level;
  if (typeof body.xp === 'number') patch.xp = body.xp;
  if (typeof body.premium === 'boolean') patch.premium = body.premium;
  if (typeof body.banned === 'boolean') patch.banned = body.banned;
  if (Array.isArray(body.cosmetics) && body.cosmetics.every((c) => typeof c === 'string')) {
    patch.cosmetics = body.cosmetics;
  }
  return patch;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolvePromise, rejectPromise) => {
    let data = '';
    req.on('data', (chunk: Buffer) => {
      data += chunk.toString();
      if (data.length > MAX_REQUEST_BODY_BYTES) {
        rejectPromise(new Error('Corps de requête trop volumineux.'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolvePromise(data ? JSON.parse(data) : {});
      } catch {
        rejectPromise(new Error('JSON invalide.'));
      }
    });
    req.on('error', rejectPromise);
  });
}

function respondJson(res: ServerResponse, statusCode: number, body: unknown): void {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(body));
}

async function serveStatic(
  dir: string | undefined,
  requestedPath: string,
  res: ServerResponse,
): Promise<void> {
  if (!dir) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rootDir = resolve(dir);
  const filePath = join(rootDir, normalize(requestedPath || '/index.html'));

  if (!filePath.startsWith(rootDir)) {
    res.writeHead(403);
    res.end();
    return;
  }

  try {
    await stat(filePath);
  } catch {
    res.writeHead(404);
    res.end();
    return;
  }

  // Sans ça, certains navigateurs réutilisent une version en cache de `bundle.js` après un
  // simple rechargement (pas un hard-refresh) — un correctif côté client peut alors sembler
  // ne "pas marcher" alors qu'il tourne, juste avec le code d'avant. Fichiers non versionnés
  // par nom (contrairement à un hash de contenu dans l'URL), donc `no-cache` plutôt qu'un
  // `max-age` : revalidation à chaque requête, pas de mise en cache aveugle.
  res.writeHead(200, { 'Content-Type': contentTypeFor(filePath), 'Cache-Control': 'no-cache' });
  createReadStream(filePath).pipe(res);
}

function contentTypeFor(filePath: string): string {
  if (filePath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (filePath.endsWith('.js')) return 'text/javascript; charset=utf-8';
  if (filePath.endsWith('.css')) return 'text/css; charset=utf-8';
  // .json (manifest.json) et .png (icônes) : ajoutés pour le Lot 7 (PWA) — Chrome accepte un
  // manifeste servi en `application/octet-stream` en pratique, mais un type MIME correct reste
  // ce que la spec attend et évite tout comportement de sniffing surprenant sur d'autres
  // navigateurs.
  if (filePath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (filePath.endsWith('.png')) return 'image/png';
  return 'application/octet-stream';
}
