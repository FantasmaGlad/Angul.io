import { monitorEventLoopDelay, type IntervalHistogram } from 'node:perf_hooks';
import { checkDbHealth } from '../db/pool.js';
import type { RoomManager } from '../engine/roomManager.js';
import { logEvent } from '../log.js';

const NS_PER_MS = 1e6;
const EVENT_LOOP_DELAY_P99_WARN_MS = 50;
const ROOM_TICK_P95_WARN_MS = 25;
/** Un même problème (event loop saturé, salon lent) ne doit pas produire une ligne de log par
 * requête `/api/admin/health` tant qu'il persiste — throttlé à une alerte par fenêtre plutôt que
 * loggé en continu (voir plan_implementation, "éradication du lag" : de la télémétrie, pas du
 * bruit). */
const WARN_THROTTLE_MS = 30_000;

let eventLoopMonitor: IntervalHistogram | undefined;
const lastWarnAtByEvent = new Map<string, number>();

function warnThrottled(event: string, fields: Record<string, unknown>): void {
  const now = Date.now();
  const lastWarnAt = lastWarnAtByEvent.get(event) ?? 0;
  if (now - lastWarnAt < WARN_THROTTLE_MS) return;
  lastWarnAtByEvent.set(event, now);
  logEvent(event, fields);
}

/** À appeler une seule fois au démarrage du process (voir net/server.ts) — le délai de l'event
 * loop est une mesure globale au process, pas par salon ni par requête HTTP. Idempotent : les
 * appels suivants (ex. plusieurs `startGameServer` dans les tests) sont des no-op, un histogramme
 * unique suffit pour la durée de vie du process. */
export function startMetrics(): void {
  if (eventLoopMonitor) return;
  eventLoopMonitor = monitorEventLoopDelay({ resolution: 10 });
  eventLoopMonitor.enable();
}

export interface RoomHealthSnapshot {
  roomId: string;
  name: string;
  playerCount: number;
  tickAvgMs: number;
  tickP95Ms: number;
  tickOverruns: number;
}

export interface HealthSnapshot {
  uptimeSec: number;
  eventLoopDelay: { meanMs: number; p95Ms: number; p99Ms: number; maxMs: number } | undefined;
  cpu: { userMs: number; systemMs: number; elapsedMs: number; busyRatio: number };
  memory: { rssMb: number; heapUsedMb: number };
  rooms: RoomHealthSnapshot[];
  /** P5 (§5.2 cahier_des_charges_admin.md) — voir `checkDbHealth` (db/pool.ts). */
  dbOk: boolean;
}

/**
 * Photo instantanée de la santé du process — un seul thread/process héberge tous les salons
 * aujourd'hui (voir Room.ts, "plusieurs rooms peuvent tourner en parallèle dans le même process
 * pour le MVP"), donc `cpu`/`eventLoopDelay` sont des mesures process-wide, tandis que `rooms`
 * détaille la charge par salon (utile pour repérer LEQUEL sature le process). Sert de baseline
 * avant toute migration vers des workers dédiés (voir plan_implementation).
 */
export async function buildHealthSnapshot(roomManager: RoomManager): Promise<HealthSnapshot> {
  const eventLoopDelay = eventLoopMonitor
    ? {
        meanMs: eventLoopMonitor.mean / NS_PER_MS,
        p95Ms: eventLoopMonitor.percentile(95) / NS_PER_MS,
        p99Ms: eventLoopMonitor.percentile(99) / NS_PER_MS,
        maxMs: eventLoopMonitor.max / NS_PER_MS,
      }
    : undefined;

  if (eventLoopDelay && eventLoopDelay.p99Ms > EVENT_LOOP_DELAY_P99_WARN_MS) {
    warnThrottled('event_loop_delay_high', { p99Ms: Math.round(eventLoopDelay.p99Ms) });
  }

  const cpuUsage = process.cpuUsage();
  const elapsedMs = process.uptime() * 1000;
  const userMs = cpuUsage.user / 1000;
  const systemMs = cpuUsage.system / 1000;

  const memoryUsage = process.memoryUsage();

  const rooms: RoomHealthSnapshot[] = roomManager.allManagedRooms().map((managed) => {
    const stats = roomManager.roomStatsOf(managed);
    if (stats.tickP95Ms > ROOM_TICK_P95_WARN_MS) {
      warnThrottled('room_tick_slow', { roomId: managed.id, p95Ms: Math.round(stats.tickP95Ms) });
    }
    return {
      roomId: managed.id,
      name: managed.name,
      playerCount: stats.playerCount,
      tickAvgMs: Math.round(stats.tickAvgMs * 100) / 100,
      tickP95Ms: Math.round(stats.tickP95Ms * 100) / 100,
      tickOverruns: stats.tickOverruns,
    };
  });

  const dbOk = await checkDbHealth();

  return {
    uptimeSec: Math.round(process.uptime()),
    eventLoopDelay: eventLoopDelay
      ? {
          meanMs: Math.round(eventLoopDelay.meanMs * 100) / 100,
          p95Ms: Math.round(eventLoopDelay.p95Ms * 100) / 100,
          p99Ms: Math.round(eventLoopDelay.p99Ms * 100) / 100,
          maxMs: Math.round(eventLoopDelay.maxMs * 100) / 100,
        }
      : undefined,
    cpu: {
      userMs: Math.round(userMs),
      systemMs: Math.round(systemMs),
      elapsedMs: Math.round(elapsedMs),
      busyRatio: elapsedMs > 0 ? Math.round(((userMs + systemMs) / elapsedMs) * 1000) / 1000 : 0,
    },
    memory: {
      rssMb: Math.round((memoryUsage.rss / 1024 / 1024) * 10) / 10,
      heapUsedMb: Math.round((memoryUsage.heapUsed / 1024 / 1024) * 10) / 10,
    },
    rooms,
    dbOk,
  };
}
