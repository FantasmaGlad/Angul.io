import type { EntitySnapshot } from '@angulio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './renderEngine.js';

function entity(id: string, x: number): EntitySnapshot {
  return { i: id, k: 'c', x, y: 0, r: 10, m: 50, p: 'self' };
}

/** Régression : un bug de production (« toutes les entités se téléportent frénétiquement ») venait
 * de l'extrapolation ajoutée pour combler un décrochage réseau (voir le commentaire de
 * `getInterpolatedEntities`) — sur Internet, deux `state` consécutifs arrivent souvent en rafale
 * après un micro-décrochage (Nagle, compression WS, throttle serveur sous backpressure) avec un
 * intervalle d'ARRIVÉE client de seulement 1-2ms alors qu'ils représentent plusieurs ticks de
 * déplacement serveur réel. `maxT` étant alors inversement proportionnel à cet intervalle, une
 * rafale suffisait à projeter l'entité à des dizaines de fois sa distance réelle. */
describe('RenderEngine.getInterpolatedEntities — extrapolation après rafale réseau', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('ne téléporte pas une entité quand les deux derniers snapshots arrivent en rafale', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(33); // intervalle normal (~1000/30 Hz)
    engine.pushSnapshot([entity('1', 100)], 2, 30);
    // Rafale : n'arrive que 2ms après le précédent, mais représente un grand déplacement (stall
    // puis rattrapage groupé côté réseau, ticks 3-4 jamais reçus séparément).
    nowSpy.mockReturnValueOnce(35);
    engine.pushSnapshot([entity('1', 500)], 5, 30);

    // Rendu bien après le dernier snapshot connu (buffer à sec).
    nowSpy.mockReturnValueOnce(500);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);

    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    // Gelé à la dernière position connue (intervalle de rafale trop petit pour être une vélocité
    // fiable) — jamais un multiple délirant de la distance entre les deux derniers snapshots (le
    // bug produisait des positions dépassant 50 000 dans ce scénario).
    expect(own!.x).toBe(500);
  });

  it('extrapole légèrement au-delà du dernier snapshot pour un vrai décrochage d’un seul tick', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(33); // intervalle normal (~1000/30 Hz)
    engine.pushSnapshot([entity('1', 100)], 2, 30);

    // `now` après la fenêtre d'interpolation habituelle mais dans la limite d'extrapolation
    // (250ms) : le mouvement doit continuer légèrement au-delà du dernier point connu.
    nowSpy.mockReturnValueOnce(120);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);

    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThan(100);
  });
});
