import { fileURLToPath } from 'node:url';
import { Room } from './engine/room.js';
import { createParametricMod } from './mods/parametric/index.js';
import { loadModConfig } from './mods/parametric/loadConfig.js';
import { startGameServer } from './net/server.js';

const TICK_RATE_HZ = 20;
const MOD_ID = process.env.MOD_ID ?? 'vanilla';
const PORT = Number(process.env.PORT ?? 8080);

const config = loadModConfig(MOD_ID);
const mod = createParametricMod(config);

const room = new Room(mod, {
  // Suppose une carte carrée (largeur = hauteur), vrai pour vanilla/folie à ce jour — le
  // rendu des bords lui-même (border.ts) gère largeur et hauteur indépendamment.
  mapSize: config.arena.width,
  tickRateHz: TICK_RATE_HZ,
  kArea: config.areaConstant,
});
room.start();

startGameServer(room, {
  port: PORT,
  staticDir: fileURLToPath(new URL('../../client/public', import.meta.url)),
});

console.log(
  `Angul.io — serveur (mode ${mod.id}) sur le port ${PORT}, tick ${TICK_RATE_HZ}Hz, carte ${config.arena.width}x${config.arena.height}.`,
);
