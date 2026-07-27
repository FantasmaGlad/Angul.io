import { fileURLToPath } from 'node:url';
// Charge server/.env (DATABASE_URL) en développement/production via install.sh (cwd =
// server/, voir plan_implementation.md Lot 3.1) — absent en environnement de test (vitest ne
// charge pas index.ts), qui configure DATABASE_URL autrement (variable d'environnement CI).
import 'dotenv/config';
import { AccountsService } from './accounts/service.js';
import { AdminAuth } from './admin/adminAuth.js';
import { getPool } from './db/pool.js';
import type { GameMod } from './engine/mod.js';
import { RoomManager, type ModResolver } from './engine/roomManager.js';
import { createHardcoreMod } from './mods/hardcore/index.js';
import { createParametricMod } from './mods/parametric/index.js';
import type { ParametricModConfig } from './mods/parametric/config.js';
import { listAvailableModIds, loadModConfig } from './mods/parametric/loadConfig.js';
import { startGameServer } from './net/server.js';

const TICK_RATE_HZ = 20;
const DEFAULT_MOD_ID = process.env.MOD_ID ?? 'vanilla';
const PORT = Number(process.env.PORT ?? 8080);

/** Modes aux mécaniques structurellement nouvelles (Lot 4) — leur fichier de config reste au
 * format paramétrique standard (server/configs/*.json, réutilisé pour mouvement/split/fusion/
 * bords/nourriture), mais leur `GameMod` est écrit à la main plutôt que produit par
 * `createParametricMod` seul. Un mode absent d'ici est traité comme purement paramétrique
 * (Vanilla, Folie, et tout futur mode qui ne fait que régler des valeurs). */
const NON_PARAMETRIC_MOD_FACTORIES: Record<string, (config: ParametricModConfig) => GameMod> = {
  hardcore: createHardcoreMod,
};

// Suppose une carte carrée (largeur = hauteur), vrai pour vanilla/folie/hardcore à ce jour —
// le rendu des bords lui-même (border.ts) gère largeur et hauteur indépendamment.
const resolveMod: ModResolver = (modId) => {
  const config = loadModConfig(modId);
  const factory = NON_PARAMETRIC_MOD_FACTORIES[modId] ?? createParametricMod;
  return {
    mod: factory(config),
    mapSize: config.arena.width,
    kArea: config.areaConstant,
    bots: config.bots,
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

console.log(
  `Angul.io — serveur démarré sur le port ${PORT}, tick ${TICK_RATE_HZ}Hz. ` +
    `Salon par défaut : "${defaultRoom.name}" (mode ${defaultRoom.modId}, id ${defaultRoom.id}). ` +
    `Comptes joueurs : ${accounts ? 'activés' : 'désactivés (DATABASE_URL absent)'}. ` +
    `Interface admin : ${admin.isConfigured ? 'activée' : 'désactivée (ADMIN_PASSWORD_HASH absent)'}.`,
);
