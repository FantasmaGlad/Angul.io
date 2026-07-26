#!/usr/bin/env node
/**
 * Validation empirique de charge (plan Lot 1.8). Démarre le serveur compilé (dist/index.js)
 * dans un process enfant, connecte N bots WebSocket qui bougent et splittent, puis rapporte :
 *   - la stabilité du tick perçue côté client (intervalle entre deux messages `state`),
 *   - la bande passante montante que ça représente pour le serveur (bytes envoyés / seconde),
 *   - la taille des snapshots (nombre d'entités, taille en octets).
 *
 * Script volontairement en JS simple (pas de build requis) : ce Node n'a pas le support
 * --experimental-strip-types compilé (voir plan_implementation.md Lot 1.3).
 *
 * Usage : node scripts/loadtest.mjs [nombreDeBots] [dureeSecondes]
 * Prérequis : `npm run build --workspace=server` (dist/index.js à jour).
 */
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';

const NUM_BOTS = Number(process.argv[2] ?? 50);
const DURATION_S = Number(process.argv[3] ?? 20);
const PORT = 8199;

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

/** Le process serveur peut avoir écrit sur stdout avant que `httpServer.listen` ait terminé
 * (aucune synchronisation explicite entre les deux dans index.ts) — quelques tentatives
 * espacées absorbent cette course sans complexifier le serveur lui-même pour un script de test. */
async function fetchRoomsWithRetry(url, attempts = 20) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      return await (await fetch(url)).json();
    } catch {
      await delay(50);
    }
  }
  throw new Error(`Impossible de contacter ${url} après ${attempts} tentatives.`);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor(p * sorted.length));
  return sorted[idx];
}

async function main() {
  console.log(`Démarrage du serveur (port ${PORT})...`);
  const server = await startServer();

  // Depuis le Lot 2.1/2.2, le serveur n'a plus de salon unique implicite : on rejoint le salon
  // par défaut créé au démarrage via son id, obtenu par l'API du lobby.
  const rooms = await fetchRoomsWithRetry(`http://localhost:${PORT}/api/rooms`);
  const roomId = rooms[0].id;

  console.log(`Connexion de ${NUM_BOTS} bots pendant ${DURATION_S}s (salon ${roomId})...`);
  const stats = { messageCount: 0, totalBytes: 0, interArrivalMs: [], lastEntityCount: 0 };
  const sockets = [];
  const closedPromises = [];

  for (let i = 0; i < NUM_BOTS; i++) {
    const socketRef = {};
    const p = new Promise((resolve) => {
      const socket = new WebSocket(`ws://localhost:${PORT}/?roomId=${roomId}`);
      socketRef.socket = socket;
      let lastStateAt = null;
      let inputTimer;
      let splitTimer;

      socket.on('open', () => {
        socket.send(JSON.stringify({ type: 'join', nickname: `Bot${i}` }));
        const phase = Math.random() * Math.PI * 2;
        inputTimer = setInterval(() => {
          const angle = phase + performance.now() / 2000;
          socket.send(
            JSON.stringify({
              type: 'input',
              dir: { x: Math.cos(angle), y: Math.sin(angle) },
              split: false,
            }),
          );
        }, 50);
        splitTimer = setInterval(() => {
          socket.send(JSON.stringify({ type: 'input', dir: { x: 1, y: 0 }, split: true }));
        }, 4000);
      });

      socket.on('message', (raw) => {
        stats.messageCount += 1;
        stats.totalBytes += raw.length;
        try {
          const parsed = JSON.parse(raw.toString());
          // Seuls les messages `state` sont réguliers (un par tick) : les mélanger avec les
          // messages ponctuels (welcome/player, en rafale au moment du join) fausserait la
          // mesure de stabilité du tick.
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

      socket.on('close', () => {
        clearInterval(inputTimer);
        clearInterval(splitTimer);
        resolve();
      });
      socket.on('error', () => resolve());
    });
    sockets.push(socketRef);
    closedPromises.push(p);
    await delay(10); // étale les connexions plutôt qu'un pic simultané irréaliste
  }

  await delay(DURATION_S * 1000);

  for (const { socket } of sockets) socket?.close();
  await Promise.race([Promise.all(closedPromises), delay(2000)]);

  server.kill();

  const sortedInterArrival = [...stats.interArrivalMs].sort((a, b) => a - b);
  const avgInterArrival =
    sortedInterArrival.reduce((a, b) => a + b, 0) / (sortedInterArrival.length || 1);
  const bytesPerSecond = stats.totalBytes / DURATION_S;

  console.log('\n--- Résultats (Lot 1.8) ---');
  console.log(`Bots simulés            : ${NUM_BOTS}`);
  console.log(`Durée                   : ${DURATION_S}s`);
  console.log(`Entités dans le dernier snapshot reçu : ${stats.lastEntityCount}`);
  console.log(`Messages "state" reçus (tous bots)     : ${stats.messageCount}`);
  console.log(
    `Intervalle entre 2 states — moy        : ${avgInterArrival.toFixed(1)} ms (cible : 50ms à 20Hz)`,
  );
  console.log(
    `Intervalle entre 2 states — p50/p95/p99: ${percentile(sortedInterArrival, 0.5).toFixed(1)} / ${percentile(sortedInterArrival, 0.95).toFixed(1)} / ${percentile(sortedInterArrival, 0.99).toFixed(1)} ms`,
  );
  console.log(
    `Bande passante montante serveur (estimée) : ${(bytesPerSecond / 1024).toFixed(1)} Ko/s pour ${NUM_BOTS} joueurs`,
  );
  console.log(
    `                                              soit ~${((bytesPerSecond * 8) / 1_000_000).toFixed(2)} Mbit/s`,
  );
}

main().catch((error) => {
  console.error('Échec du test de charge :', error);
  process.exit(1);
});
