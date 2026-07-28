#!/usr/bin/env node
/**
 * Validation de la charge spectateur et régulation réseau. Connecte N onglets/spectateurs
 * WebSocket (`?spectate=1`) sans aucun joueur réel, puis rapporte :
 *   - la cadence de réception perçue (intervalle entre deux messages `state`),
 *   - la bande passante consommée par spectateur,
 *   - le nombre d'entités reçues par snapshot spectateur.
 *
 * Usage : node scripts/loadtest_spectators.mjs [nombreDeSpectateurs] [dureeSecondes]
 * Prérequis : `npm run build --workspace=server`
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const NUM_SPECTATORS = Number(process.argv[2] ?? 30);
const DURATION_S = Number(process.argv[3] ?? 15);
const PORT = 8299;

function startServer() {
  const child = spawn(process.execPath, ['dist/index.js'], {
    env: { ...process.env, PORT: String(PORT) },
    cwd: new URL('..', import.meta.url).pathname,
    stdio: ['ignore', 'pipe', 'inherit'],
  });

  return new Promise((resolve, reject) => {
    child.stdout.on('data', (chunk) => {
      process.stdout.write(`[serveur] ${chunk}`);
      resolve(child);
    });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code !== null && code !== 0) reject(new Error(`serveur terminé avec le code ${code}`));
    });
  });
}

async function fetchWithRetry(url, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await (await fetch(url)).json();
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Impossible de contacter ${url}`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`Démarrage du serveur pour le test spectateurs (port ${PORT})...`);
  const server = await startServer();

  const rooms = await fetchWithRetry(`http://localhost:${PORT}/api/rooms`);
  const roomId = rooms[0].id;

  console.log(`Connexion de ${NUM_SPECTATORS} spectateurs sur l'accueil (?spectate=1) pendant ${DURATION_S}s...`);
  const stats = { messageCount: 0, totalBytes: 0, interArrivalMs: [], lastEntityCount: 0 };
  const sockets = [];
  const closedPromises = [];

  for (let i = 0; i < NUM_SPECTATORS; i++) {
    const socketRef = {};
    const p = new Promise((resolve) => {
      const socket = new WebSocket(`ws://localhost:${PORT}/?roomId=${roomId}&spectate=1`);
      socketRef.socket = socket;
      let lastStateAt = null;

      socket.on('message', (raw) => {
        stats.messageCount += 1;
        stats.totalBytes += raw.length;
        try {
          const parsed = JSON.parse(raw.toString());
          if (parsed.type === 'state') {
            const now = performance.now();
            if (lastStateAt !== null) stats.interArrivalMs.push(now - lastStateAt);
            lastStateAt = now;
            stats.lastEntityCount = parsed.entities.length;
          }
        } catch {
          /* ignoré */
        }
      });

      socket.on('close', () => resolve());
      socket.on('error', () => resolve());
    });
    sockets.push(socketRef);
    closedPromises.push(p);
    await delay(10);
  }

  await delay(DURATION_S * 1000);

  for (const { socket } of sockets) socket?.close();
  await Promise.race([Promise.all(closedPromises), delay(2000)]);

  server.kill();

  const sortedInterArrival = [...stats.interArrivalMs].sort((a, b) => a - b);
  const avgInterArrival =
    sortedInterArrival.reduce((a, b) => a + b, 0) / (sortedInterArrival.length || 1);
  const bytesPerSecond = stats.totalBytes / DURATION_S;
  const fps = avgInterArrival > 0 ? (1000 / avgInterArrival).toFixed(1) : '0';

  console.log('\n--- Résultats du Test de Charge Spectateurs ---');
  console.log(`Spectateurs simulés                   : ${NUM_SPECTATORS}`);
  console.log(`Durée du test                         : ${DURATION_S}s`);
  console.log(`Entités dans le snapshot spectateur   : ${stats.lastEntityCount}`);
  console.log(`Messages "state" spectateurs reçus    : ${stats.messageCount}`);
  console.log(`Fréquence réseau spectateur perçue    : ~${fps} Hz (cible : ~7.5 Hz avec DIVISOR=4)`);
  console.log(`Intervalle moyen entre 2 states       : ${avgInterArrival.toFixed(1)} ms`);
  console.log(
    `Intervalle p50/p95/p99                : ${percentile(sortedInterArrival, 0.5).toFixed(1)} / ${percentile(sortedInterArrival, 0.95).toFixed(1)} / ${percentile(sortedInterArrival, 0.99).toFixed(1)} ms`,
  );
  console.log(
    `Bande passante totale spectateurs     : ${(bytesPerSecond / 1024).toFixed(1)} Ko/s pour ${NUM_SPECTATORS} spectateurs`,
  );
  console.log(
    `Bande passante moyenne par spectateur : ${(bytesPerSecond / 1024 / NUM_SPECTATORS).toFixed(2)} Ko/s`,
  );
}

main().catch((error) => {
  console.error('Échec du test de charge spectateurs :', error);
  process.exit(1);
});
