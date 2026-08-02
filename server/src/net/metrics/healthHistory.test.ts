import { afterEach, describe, expect, it } from 'vitest';
import type { GameMod } from '../../engine/mod.js';
import { RoomManager, type ModResolver } from '../../engine/roomManager.js';
import { createLocalRoomHost } from '../../engine/worker/roomHost.js';
import { getHealthHistory, startHealthHistory, stopHealthHistory } from './healthHistory.js';

const testMod: GameMod = { id: 'test' };
const resolver: ModResolver = () => ({ mod: testMod, mapSize: 1000 });

function makeManager(): RoomManager {
  const host = createLocalRoomHost(resolver);
  return new RoomManager(host, 20, { emptyRoomGraceMs: 10_000_000 });
}

/** `buildHealthSnapshot` attend une vraie requête DB (`checkDbHealth`) — sa latence dépend de
 * l'environnement (variable en CI/sandbox), donc on SONDE jusqu'à apparition du point plutôt que
 * de parier sur un délai fixe. */
async function waitForHistoryLength(length: number, timeoutMs = 5000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (getHealthHistory().length < length) {
    if (Date.now() > deadline) {
      throw new Error(`Timeout: historique toujours à ${getHealthHistory().length} point(s) après ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('healthHistory (P5, §7.1 plan-implementation-admin.md)', () => {
  afterEach(() => {
    stopHealthHistory();
  });

  it('échantillonne immédiatement au démarrage, sans attendre le premier intervalle', async () => {
    const manager = makeManager();
    startHealthHistory(manager);
    await waitForHistoryLength(1);
    const history = getHealthHistory();
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ playersOnline: 0, tickAvgMs: 0 });
    expect(typeof history[0]!.dbOk).toBe('boolean');
  });

  it('est idempotent : un second appel ne relance pas un second intervalle', async () => {
    const manager = makeManager();
    startHealthHistory(manager);
    await waitForHistoryLength(1);
    startHealthHistory(manager); // no-op attendu
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(getHealthHistory()).toHaveLength(1);
  });

  it('getHealthHistory(sinceMs) filtre les points antérieurs', async () => {
    const manager = makeManager();
    startHealthHistory(manager);
    await waitForHistoryLength(1);
    const future = Date.now() + 60_000;
    expect(getHealthHistory(future)).toHaveLength(0);
    expect(getHealthHistory(0)).toHaveLength(1);
  });

  it('stopHealthHistory vide le buffer et empêche un échantillon en vol de le repeupler', async () => {
    const manager = makeManager();
    startHealthHistory(manager);
    stopHealthHistory();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(getHealthHistory()).toHaveLength(0);
  });
});
