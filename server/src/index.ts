import { fileURLToPath } from 'node:url';
import { Room } from './engine/room.js';
import { vanillaMod } from './mods/vanilla/index.js';
import { startGameServer } from './net/server.js';

const TICK_RATE_HZ = 20;
const MAP_SIZE = 4000;
const PORT = Number(process.env.PORT ?? 8080);

const room = new Room(vanillaMod, { mapSize: MAP_SIZE, tickRateHz: TICK_RATE_HZ });
room.start();

startGameServer(room, {
  port: PORT,
  staticDir: fileURLToPath(new URL('../../client/public', import.meta.url)),
});

console.log(
  `Angul.io — serveur (mode ${vanillaMod.id}) sur le port ${PORT}, tick ${TICK_RATE_HZ}Hz, carte ${MAP_SIZE}x${MAP_SIZE}.`,
);
