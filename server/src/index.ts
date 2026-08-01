import { fileURLToPath } from 'node:url';
// Charge server/.env (DATABASE_URL) en développement/production via install.sh (cwd =
// server/, voir plan_implementation.md Lot 3.1) — absent en environnement de test (vitest ne
// charge pas index.ts), qui configure DATABASE_URL autrement (variable d'environnement CI).
import 'dotenv/config';
import { AccountsService } from './accounts/service.js';
import { AdminAuth } from './admin/adminAuth.js';
import { AdminUsersRepository } from './admin/adminUsersRepository.js';
import { getPool } from './db/pool.js';
import { listAvailableModIds, resolveMod } from './engine/modRegistry.js';
import { TWO_HOUR_RESET_SCHEDULE } from './engine/resetSchedule.js';
import { RoomManager } from './engine/roomManager.js';
import { createLocalRoomHost } from './engine/worker/roomHost.js';
import { createWorkerRoomHost } from './engine/worker/workerRoomHost.js';
import { startGameServer } from './net/server.js';
import { loadBaseRoomsConfig } from './roomsConfig.js';
import { logEvent } from './log.js';

import os from 'node:os';

// Filet de sécurité de dernier recours (correctif "écran de mort qui ne s'affiche jamais",
// voir net/ws/broadcast.ts `onPlayerDeath`) : Node ≥15 termine le process par défaut sur une
// promesse rejetée non catchée nulle part — un seul appel DB raté au mauvais tick pouvait ainsi
// faire tomber TOUT le serveur (tous les salons). On logge et on continue plutôt que de crasher ;
// les points d'appel connus restent malgré tout catchés localement (voir broadcast.ts), ceci ne
// sert qu'à couvrir un futur code async qui oublierait de le faire.
process.on('unhandledRejection', (reason) => {
  logEvent('unhandled_rejection', { reason: reason instanceof Error ? reason.message : String(reason) });
});

// 20Hz (était 30) — la physique tourne à pas de temps FIXE dérivé de ce taux (`dt =
// tickIntervalMs/1000`, jamais le temps réel écoulé, voir Room.tick()) : baisser ce taux ne
// change RIEN à la simulation elle-même, seulement sa granularité temporelle. Réduit d'1/3 le
// coût CPU (physique + collision + sérialisation réseau, tout tourne moins souvent) sans
// dégrader la fluidité perçue : le rendu client interpole déjà entre deux `state` consécutifs à
// la cadence de l'écran (60-240 FPS, voir renderEngine.ts `getInterpolatedEntities`), et le
// tunneling à haute vitesse (Dash, ~200px/tick à 20Hz au lieu de ~135px à 30Hz) reste couvert par
// la passe dédiée `World.findTunnelingPairs`/`queryNearbySwept` (déjà générique, pas bornée à un
// taux de tick particulier). Seul coût réel : ~17ms de latence d'input supplémentaire au pire cas
// (imperceptible) — voir cahier_des_charges_admin.md §2.3 pour le lien avec le lag du canva admin
// (le "digest" ne doit PAS dépendre de ce taux, cf. son propre correctif, hors périmètre ici).
const TICK_RATE_HZ = process.env.TICK_RATE_HZ ? Number(process.env.TICK_RATE_HZ) : 20;
const PORT = Number(process.env.PORT ?? 8080);
const BASE_ROOM_MAX_PLAYERS = 30;

/** Nombre de threads de simulation dédiés — répartit les salons sur des threads séparés
 * (un par cœur dédié) afin d'isoler l'exécution des salons (un lag sur le salon 1 n'impacte pas le salon 2). */
const defaultWorkers = Math.max(
  2,
  typeof os.availableParallelism === 'function' ? os.availableParallelism() : (os.cpus()?.length ?? 4),
);
const ROOM_WORKERS = process.env.ROOM_WORKERS !== undefined ? Number(process.env.ROOM_WORKERS) : defaultWorkers;

const roomHost = ROOM_WORKERS > 0 ? createWorkerRoomHost(ROOM_WORKERS) : createLocalRoomHost();
const roomManager = new RoomManager(roomHost, TICK_RATE_HZ);

// Salons publics de base toujours présents à l'accueil — liste et mode attribué à chacun lus
// depuis `server/rooms.json` (§13 cahier_des_charges_admin.md : "ne pas hardcoder les salons
// principaux", éditable via l'interface admin, `GET/PUT /api/admin/base-rooms`, voir
// roomsConfig.ts) plutôt qu'un tableau codé en dur ici — un changement de ce fichier ne prend
// effet qu'au prochain redémarrage (les salons déjà démarrés ne sont pas recréés à la volée, voir
// le commentaire de `saveBaseRoomsConfig`). Remplis à 10-20% de bots (ratio fluctuant, voir
// BotManager.updateFluctuatingRatio — `targetRatio` volontairement absent des configs pour
// laisser ce ratio s'appliquer ; `BotManager.adjustPopulation` fait respawner les bots
// automatiquement dès que leur nombre baisse). Jamais supprimés par le nettoyage automatique des
// salons vides (durcissement avant exposition publique) : contrairement aux salons créés depuis
// le lobby, ils doivent toujours exister, même si personne n'y joue jamais.
//
// Capacité et cadence de reset lues depuis `ParametricModConfig['room']` (server/configs/*.json,
// voir mods/parametric/config.ts) — modifiables par un modder sans toucher ce fichier ; repli sur
// `BASE_ROOM_MAX_PLAYERS`/`TWO_HOUR_RESET_SCHEDULE` uniquement pour un mod dont la config JSON
// omet cette section.
const BASE_ROOMS = loadBaseRoomsConfig();
const baseRooms = BASE_ROOMS.map((base) => {
  const { room, mapSize: modMapSize } = resolveMod(base.modId);
  return roomManager.createRoom({
    name: base.name,
    modId: base.modId,
    visibility: 'public',
    permanent: true,
    maxPlayers: base.maxPlayers ?? room?.maxPlayers ?? BASE_ROOM_MAX_PLAYERS,
    mapSize: base.mapSize && base.mapSize !== 15000 ? base.mapSize : modMapSize,
    resetSchedule: base.resetDurationMin !== undefined
      ? (base.resetDurationMin > 0
          ? { type: 'everyNMinutes', minutes: base.resetDurationMin, timeZone: 'Europe/Paris' }
          : undefined)
      : (room?.resetSchedule ?? TWO_HOUR_RESET_SCHEDULE),
  });
});

// Comptes joueurs (Lot 3.2-3.6) : optionnels — sans `DATABASE_URL`, le serveur tourne comme
// avant (parties anonymes uniquement), pas de plantage au démarrage pour un dev/CI qui n'a pas
// configuré de base de données (voir GameServerOptions.accounts, net/server.ts).
const accounts = process.env.DATABASE_URL ? new AccountsService(getPool()) : undefined;

// Interface admin (cahier_des_charges_admin.md) : comptes nommés en base (`admin_users`) dès que
// `DATABASE_URL` est configuré, repli sur `ADMIN_PASSWORD_HASH` sinon (voir AdminAuth). Sans
// aucun des deux, `/api/admin/*` répond 503 plutôt que de planter au démarrage.
const admin = new AdminAuth(
  process.env.ADMIN_PASSWORD_HASH,
  process.env.DATABASE_URL ? new AdminUsersRepository(getPool()) : undefined,
);

// Identifiant de build (Lot "force-reload") : figé une fois au démarrage du process — un
// déploiement redémarre toujours ce process (seul moyen de déployer avec cette architecture, voir
// structure.md §1), donc cette valeur change nécessairement à chaque déploiement, jamais en cours
// de vie du process. Un client qui reconnecte (voir net.ts, GameConnection) et reçoit un
// `buildVersion` différent de celui de son `welcome` précédent sait qu'il a reconnecté vers un
// nouveau déploiement et se recharge (voir GameView.tsx).
const BUILD_VERSION = String(Date.now());

startGameServer(roomManager, {
  port: PORT,
  staticDir: fileURLToPath(new URL('../../client/public', import.meta.url)),
  adminStaticDir: fileURLToPath(new URL('../../admin/public', import.meta.url)),
  availableModIds: listAvailableModIds(),
  accounts,
  admin,
  buildVersion: BUILD_VERSION,
});

const baseRoomsDescription = baseRooms
  .map((room) => `"${room.name}" (mode ${room.modId}, id ${room.id})`)
  .join(', ');

console.log(
  `Angul.io — serveur démarré sur le port ${PORT}, tick ${TICK_RATE_HZ}Hz. ` +
    `Salons de base : ${baseRoomsDescription}. ` +
    `Comptes joueurs : ${accounts ? 'activés' : 'désactivés (DATABASE_URL absent)'}. ` +
    `Interface admin : ${admin.isConfigured ? 'activée' : 'désactivée (ADMIN_PASSWORD_HASH absent)'}.`,
);
