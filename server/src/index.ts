import { fileURLToPath } from 'node:url';
// Charge server/.env (DATABASE_URL) en développement/production via install.sh (cwd =
// server/, voir plan_implementation.md Lot 3.1) — absent en environnement de test (vitest ne
// charge pas index.ts), qui configure DATABASE_URL autrement (variable d'environnement CI).
import 'dotenv/config';
import { AccountsService } from './accounts/service.js';
import { AdminAuth } from './admin/adminAuth.js';
import { getPool } from './db/pool.js';
import { listAvailableModIds } from './engine/modRegistry.js';
import { TWO_HOUR_RESET_SCHEDULE } from './engine/resetSchedule.js';
import { RoomManager } from './engine/roomManager.js';
import { createLocalRoomHost } from './engine/worker/roomHost.js';
import { createWorkerRoomHost } from './engine/worker/workerRoomHost.js';
import { startGameServer } from './net/server.js';

import os from 'node:os';

const TICK_RATE_HZ = 20;
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

// Deux salons publics de base toujours présents (demande utilisateur), un par mode disponible
// (Vanilla, Hardcore — Folie retiré) : 30 joueurs max, remplis à 10-20% de bots (ratio fluctuant,
// voir BotManager.updateFluctuatingRatio — `targetRatio` volontairement absent des configs pour
// laisser ce ratio s'appliquer ; `BotManager.adjustPopulation` fait respawner les bots
// automatiquement dès que leur nombre baisse), reset toutes les 2h heure de Paris. Jamais
// supprimés par le nettoyage automatique des salons vides (durcissement avant exposition
// publique) : contrairement aux salons créés depuis le lobby, ils doivent toujours exister, même
// si personne n'y joue jamais.
const BASE_ROOMS: Array<{ name: string; modId: string }> = [
  { name: 'Vanilla', modId: 'vanilla' },
  { name: 'Hardcore', modId: 'hardcore' },
];
const baseRooms = BASE_ROOMS.map((base) =>
  roomManager.createRoom({
    name: base.name,
    modId: base.modId,
    visibility: 'public',
    permanent: true,
    maxPlayers: BASE_ROOM_MAX_PLAYERS,
    resetSchedule: TWO_HOUR_RESET_SCHEDULE,
  }),
);

// Comptes joueurs (Lot 3.2-3.6) : optionnels — sans `DATABASE_URL`, le serveur tourne comme
// avant (parties anonymes uniquement), pas de plantage au démarrage pour un dev/CI qui n'a pas
// configuré de base de données (voir GameServerOptions.accounts, net/server.ts).
const accounts = process.env.DATABASE_URL ? new AccountsService(getPool()) : undefined;

// Interface admin (Lot 5.1) : optionnelle de la même façon — sans `ADMIN_PASSWORD_HASH`,
// `/api/admin/*` répond 503 plutôt que de planter au démarrage (voir AdminAuth.isConfigured,
// server/scripts/hashPassword.mjs pour générer le hash).
const admin = new AdminAuth(process.env.ADMIN_PASSWORD_HASH);

startGameServer(roomManager, {
  port: PORT,
  staticDir: fileURLToPath(new URL('../../client/public', import.meta.url)),
  adminStaticDir: fileURLToPath(new URL('../../admin/public', import.meta.url)),
  availableModIds: listAvailableModIds(),
  accounts,
  admin,
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
