import { describe, expect, it } from 'vitest';
import type { GameMod } from './mod.js';
import { Room } from './room.js';

/**
 * Validation empirique du Lot 2.5 ("un bug ou une charge élevée dans un salon n'affecte pas les
 * autres"). Ne suppose rien : mesure réellement si une charge CPU synchrone dans un salon
 * retarde le tick d'un autre salon tournant dans le même process.
 *
 * Résultat mesuré (voir plan_implementation.md pour la conclusion actée) : l'isolation d'état
 * (chaque `Room` a son propre `World`, aucune donnée partagée) est totale — confirmé par
 * `roomManager.test.ts`/`server.test.ts`. L'isolation CPU/timing, elle, **n'est pas garantie** :
 * Node est mono-thread pour le JS, donc toutes les `Room` d'un même process se partagent le même
 * thread. Un mod synchrone lent (bug ou boucle trop coûteuse) dans un salon retarde nécessairement
 * les ticks des autres salons qui tombent pendant son exécution. Ce test le démontre plutôt que
 * de le supposer.
 */
describe('Isolation multi-salons sous charge (Lot 2.5)', () => {
  it('un tick synchrone coûteux dans un salon retarde mesurablement le tick d’un autre salon (mono-thread Node)', async () => {
    const BUSY_MS = 80;
    const TICK_RATE_HZ = 20;
    const NOMINAL_INTERVAL_MS = 1000 / TICK_RATE_HZ;

    const heavyMod: GameMod = {
      id: 'heavy',
      onTick: () => {
        // Charge CPU synchrone volontaire (simule un mod lent ou buggé) — bornée en temps réel
        // plutôt qu'en nombre d'itérations, pour un comportement reproductible indépendamment
        // de la vitesse de la machine qui exécute le test.
        const until = performance.now() + BUSY_MS;
        while (performance.now() < until) {
          /* occupe volontairement le thread */
        }
      },
    };
    const lightMod: GameMod = { id: 'light' };

    const heavyRoom = new Room(heavyMod, {
      mapSize: 1000,
      tickRateHz: TICK_RATE_HZ,
      resetSchedule: null,
    });
    const lightRoom = new Room(lightMod, {
      mapSize: 1000,
      tickRateHz: TICK_RATE_HZ,
      resetSchedule: null,
    });

    const lightTickTimestamps: number[] = [];
    lightRoom.onState(() => lightTickTimestamps.push(performance.now()));

    try {
      heavyRoom.start();
      lightRoom.start();

      await new Promise((resolve) => setTimeout(resolve, 600));
    } finally {
      heavyRoom.stop();
      lightRoom.stop();
    }

    const intervals = lightTickTimestamps
      .slice(1)
      .map((timestamp, index) => timestamp - lightTickTimestamps[index]);
    const maxInterval = Math.max(...intervals);

    // Mesuré avant d'écrire ce seuil (voir le journal des décisions) : tant que BUSY_MS reste
    // sous l'intervalle nominal (50ms), aucun retard mesurable (les deux salons tiennent dans la
    // même fenêtre de tick). Dès que BUSY_MS atteint/dépasse le nominal, le tick de lightRoom se
    // cale sur le rythme de heavyRoom (~BUSY_MS par cycle) au lieu de son propre rythme nominal —
    // ici largement au-delà du nominal, sans ambiguïté possible avec du simple bruit
    // d'ordonnancement. Si ce test se met à échouer après un changement d'architecture (ex. un
    // `Room` par `worker_thread`, Lot 11.1), c'est une bonne nouvelle : l'isolation CPU serait
    // devenue réelle — mettre à jour ce test (et le plan) en conséquence plutôt que le supprimer.
    expect(maxInterval).toBeGreaterThan(NOMINAL_INTERVAL_MS * 1.3);
  });
});
