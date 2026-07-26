import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { join, normalize, resolve } from 'node:path';
import {
  distance,
  type ClientMessage,
  type EntitySnapshot,
  type ServerMessage,
} from '@angulio/shared';
import { WebSocketServer, type WebSocket } from 'ws';
import { SpatialHash } from '../engine/spatialHash.js';
import { AccountError, type AccountsService } from '../accounts/service.js';
import type { ManagedRoom, RoomManager, RoomVisibility } from '../engine/roomManager.js';
import type { Entity, PlayerId } from '../engine/types.js';
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
}

const MAX_NICKNAME_LENGTH = 20;
const MAX_ROOM_NAME_LENGTH = 40;
const MAX_REQUEST_BODY_BYTES = 10_000;
const INTEREST_RADIUS_PX_DEFAULT = 3000;

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
        const self = accelerationPerSec2 !== undefined ? { accelerationPerSec2 } : undefined;

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
  // Un salon supprimé automatiquement (vide depuis trop longtemps, durcissement avant
  // exposition publique) n'a par construction plus aucun joueur donc plus aucune socket
  // active dans son runtime — on libère simplement l'entrée pour ne pas la garder en mémoire.
  roomManager.onRoomRemoved((roomId) => runtimes.delete(roomId));

  const httpServer = createServer((req, res) => {
    void handleHttpRequest(
      roomManager,
      options.staticDir,
      options.availableModIds ?? [],
      options.accounts,
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
      socket.close(4004, 'Salon introuvable');
      return;
    }
    const runtime = runtimes.get(managed.id)!;
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
        playerId = String(runtime.nextPlayerId++);
        runtime.sockets.set(playerId, socket);
        if (accountId !== undefined) {
          runtime.accountIdByPlayer.set(playerId, accountId);
          runtime.maxMassByPlayer.set(playerId, 0);
        }
        const nickname = message.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) || 'Joueur';
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
        managed.room.handleInput(playerId, { dir: message.dir, split: message.split });
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
  const score = runtime.maxMassByPlayer.get(playerId) ?? 0;
  if (score <= 0) return;

  accounts.recordGameResult(accountId, managed.modId, score).catch((error: unknown) => {
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
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost');

  if (url.pathname === '/api/rooms' && req.method === 'GET') {
    respondJson(res, 200, roomManager.listPublicRooms());
    return;
  }

  if (url.pathname === '/api/rooms' && req.method === 'POST') {
    await handleCreateRoom(roomManager, req, res);
    return;
  }

  if (url.pathname === '/api/modes' && req.method === 'GET') {
    respondJson(res, 200, availableModIds);
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

  await serveStatic(staticDir, req, res);
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

async function handleCreateRoom(
  roomManager: RoomManager,
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
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
    const summary = roomManager.createRoom({ name, modId, visibility });
    respondJson(res, 201, summary);
  } catch (error) {
    logEvent('room_create_rejected', { reason: (error as Error).message });
    respondJson(res, 400, { error: (error as Error).message });
  }
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
  req: IncomingMessage,
  res: ServerResponse,
): Promise<void> {
  if (!dir) {
    res.writeHead(404);
    res.end();
    return;
  }

  const rootDir = resolve(dir);
  const requestedPath = req.url && req.url !== '/' ? req.url.split('?')[0] : '/index.html';
  const filePath = join(rootDir, normalize(String(requestedPath)));

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
  return 'application/octet-stream';
}
