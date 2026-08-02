import type { RoomManager } from '../../engine/roomManager.js';
import { buildHealthSnapshot } from '../metrics.js';

/** 1 point/minute, fenêtre 24h glissante (§7.1 plan-implementation-admin.md) — assez pour les 2
 * graphes du Dashboard (P5) sans faire grossir la mémoire indéfiniment sur un process longue
 * durée. */
const SAMPLE_INTERVAL_MS = 60_000;
const WINDOW_SIZE = 24 * 60;

export interface HealthHistoryPoint {
  atMs: number;
  /** Somme sur tous les salons (voir `HealthSnapshot.rooms`) — pas de détail par salon ici, les
   * 2 graphes du Dashboard (§7.3) restent globaux ; le détail par salon reste disponible en
   * direct via `GET /api/admin/rooms`. */
  playersOnline: number;
  /** Pire salon du snapshot (max, pas moyenne) — un seul salon en difficulté doit rester visible
   * sur le graphe, une moyenne le noierait dans les salons sains. */
  tickAvgMs: number;
  eventLoopP99Ms: number | undefined;
  dbOk: boolean;
}

const buffer: HealthHistoryPoint[] = [];
let timer: ReturnType<typeof setInterval> | undefined;
/** Incrémenté à chaque `stopHealthHistory()` — un `sample()` encore en vol (attend
 * `buildHealthSnapshot`, qui fait une vraie requête DB via `checkDbHealth`) au moment d'un stop
 * ne doit jamais pousser son résultat une fois résolu : sans ce garde-fou, un test qui démarre
 * puis arrête l'historique voyait parfois un point résiduel apparaître APRÈS `stopHealthHistory()`
 * (la requête DB, plus lente que le reste du test, se résolvait après coup). */
let generation = 0;

async function sample(roomManager: RoomManager): Promise<void> {
  const sampledGeneration = generation;
  const snapshot = await buildHealthSnapshot(roomManager);
  if (sampledGeneration !== generation) return; // arrêté entre-temps, résultat périmé
  const playersOnline = snapshot.rooms.reduce((sum, room) => sum + room.playerCount, 0);
  const tickAvgMs = snapshot.rooms.reduce((max, room) => Math.max(max, room.tickAvgMs), 0);
  buffer.push({
    atMs: Date.now(),
    playersOnline,
    tickAvgMs,
    eventLoopP99Ms: snapshot.eventLoopDelay?.p99Ms,
    dbOk: snapshot.dbOk,
  });
  if (buffer.length > WINDOW_SIZE) buffer.shift();
}

/** À appeler une seule fois au démarrage du process (voir server/src/index.ts) — idempotent,
 * comme `startMetrics()` (metrics.ts). Échantillonne immédiatement (pas d'attente du premier
 * intervalle) pour qu'un Dashboard ouvert juste après le démarrage ait déjà un point à afficher. */
export function startHealthHistory(roomManager: RoomManager): void {
  if (timer) return;
  void sample(roomManager);
  timer = setInterval(() => void sample(roomManager), SAMPLE_INTERVAL_MS);
}

/** Réservé aux tests : arrête l'échantillonnage et vide le buffer, pour ne pas laisser un timer
 * actif ni un état résiduel fuiter d'un test à l'autre. */
export function stopHealthHistory(): void {
  if (timer) clearInterval(timer);
  timer = undefined;
  generation++;
  buffer.length = 0;
}

/** `sinceMs` filtre les points antérieurs (période 1h/6h/24h côté client, voir
 * `GET /api/admin/health/history`) — copie défensive, jamais le tableau interne directement. */
export function getHealthHistory(sinceMs?: number): HealthHistoryPoint[] {
  if (sinceMs === undefined) return [...buffer];
  return buffer.filter((point) => point.atMs >= sinceMs);
}
