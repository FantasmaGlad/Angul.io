import { fileURLToPath } from 'node:url';
// Charge server/.env (DATABASE_URL) en développement/production via install.sh (cwd =
// server/, voir plan_implementation.md Lot 3.1) — absent en environnement de test (vitest ne
// charge pas index.ts), qui configure DATABASE_URL autrement (variable d'environnement CI).
import 'dotenv/config';
import { AccountsService } from './accounts/service.js';
import { getPool } from './db/pool.js';
import { RoomManager, type ModResolver } from './engine/roomManager.js';
import { createParametricMod } from './mods/parametric/index.js';
import { listAvailableModIds, loadModConfig } from './mods/parametric/loadConfig.js';
import { startGameServer } from './net/server.js';

const TICK_RATE_HZ = 20;
const DEFAULT_MOD_ID = process.env.MOD_ID ?? 'vanilla';
const PORT = Number(process.env.PORT ?? 8080);

// Suppose une carte carrée (largeur = hauteur), vrai pour vanilla/folie à ce jour — le rendu
// des bords lui-même (border.ts) gère largeur et hauteur indépendamment.
const resolveMod: ModResolver = (modId) => {
  const config = loadModConfig(modId);
  return {
    mod: createParametricMod(config),
    mapSize: config.arena.width,
    kArea: config.areaConstant,
  };
};

const roomManager = new RoomManager(resolveMod, TICK_RATE_HZ);

// Salon par défaut créé au démarrage (compatibilité avec le comportement du Lot 1, avant le
// lobby : un salon jouable existe toujours, même sans passer par la création manuelle). Le
// lobby (Lot 2.2) permet d'en créer d'autres, dans n'importe quel mode disponible.
const defaultRoom = roomManager.createRoom({
  name: 'Salon principal',
  modId: DEFAULT_MOD_ID,
  visibility: 'public',
  // Jamais supprimé par le nettoyage automatique des salons vides (durcissement avant
  // exposition publique) : contrairement aux salons créés depuis le lobby, celui-ci doit
  // toujours exister, même si personne n'y joue jamais.
  permanent: true,
});

// Comptes joueurs (Lot 3.2-3.6) : optionnels — sans `DATABASE_URL`, le serveur tourne comme
// avant (parties anonymes uniquement), pas de plantage au démarrage pour un dev/CI qui n'a pas
// configuré de base de données (voir GameServerOptions.accounts, net/server.ts).
const accounts = process.env.DATABASE_URL ? new AccountsService(getPool()) : undefined;

startGameServer(roomManager, {
  port: PORT,
  staticDir: fileURLToPath(new URL('../../client/public', import.meta.url)),
  availableModIds: listAvailableModIds(),
  accounts,
});

console.log(
  `Angul.io — serveur démarré sur le port ${PORT}, tick ${TICK_RATE_HZ}Hz. ` +
    `Salon par défaut : "${defaultRoom.name}" (mode ${defaultRoom.modId}, id ${defaultRoom.id}). ` +
    `Comptes joueurs : ${accounts ? 'activés' : 'désactivés (DATABASE_URL absent)'}.`,
);
