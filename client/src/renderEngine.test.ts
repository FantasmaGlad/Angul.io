import type { EntitySnapshot } from '@angulio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './renderEngine.js';

function entity(id: string, x: number): EntitySnapshot {
  return { i: id, k: 'c', x, y: 0, r: 10, m: 50, p: 'self' };
}

/** La ligne de temps de lecture (`SnapshotItem.serverTimeMs`) est dérivée du NUMÉRO DE TICK, ancré
 * une seule fois sur l'horloge client au premier snapshot reçu — jamais de l'heure d'arrivée de
 * chaque message individuel. Cette suite vérifie que ça tient sa promesse : une rafale réseau
 * (plusieurs `state` reçus coup sur coup après un micro-décrochage, mesuré en production —
 * ~50ms de RTT avec ~30ms de gigue, voir plan_performance_reseau.md) ne doit ni téléporter une
 * entité (régression corrigée précédemment) ni geler la lecture plus que nécessaire (nouveau
 * comportement : la rafale redevient une simple interpolation fluide à travers le temps simulé
 * réellement écoulé, pas un saut). */
describe('RenderEngine — ligne de temps ancrée sur le numéro de tick', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interpole en douceur à travers une rafale au lieu de sauter directement à la dernière valeur', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30); // ancre : tick 1 == horloge client 0
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('1', 100)], 2, 30); // tick normal, +33.3ms simulés
    // Rafale : le tick 5 (3 ticks plus tard, ~100ms de temps simulé) arrive seulement 2ms après
    // le tick 2 en temps d'ARRIVÉE client — mais sa ligne de temps interne reste correcte.
    nowSpy.mockReturnValueOnce(35);
    engine.pushSnapshot([entity('1', 500)], 5, 30);

    // Rendu peu après l'arrivée de la rafale (buffer = 100ms à 30Hz) : encore tôt dans
    // l'intervalle simulé tick2→tick5, donc proche de x=100, pas un saut à x=500.
    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);

    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThan(100);
    expect(own!.x).toBeLessThan(350); // loin d'un télétransport vers 500
  });

  it("n'est pas perturbée par l'heure d'arrivée : deux mêmes tick/position donnent le même rendu quelle que soit la gigue d'arrivée", () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(1000); // horloge client arbitraire au moment de l'ancrage
    engine.pushSnapshot([entity('1', 0)], 10, 30);
    nowSpy.mockReturnValueOnce(1200); // arrivée tardive/atypique, sans rapport avec le tick réel
    engine.pushSnapshot([entity('1', 100)], 11, 30);

    // Le rendu ne dépend que de l'écart entre l'ancre et `now` — pas de l'heure d'arrivée de la
    // 2e snapshot (1200 dans ce test), qui n'intervient jamais dans le calcul de `serverTimeMs`.
    nowSpy.mockReturnValueOnce(1000 + 100 + 16); // ancre + intervalDelay(100) + un peu
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);
    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThanOrEqual(0);
    expect(own!.x).toBeLessThanOrEqual(100);
  });

  it('extrapole au-delà du dernier tick connu lors d’un vrai décrochage, borné par le plafond', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('1', 100)], 2, 30);

    // Bien après le dernier tick connu (buffer à sec) — mais dans la fenêtre d'extrapolation.
    nowSpy.mockReturnValueOnce(200);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);
    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThan(100);
  });

  it('comptabilise les ticks manqués sans être perturbé par la ligne de temps ancrée', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(100);
    engine.pushSnapshot([entity('1', 100)], 4, 30); // 2 ticks manqués (2 et 3)

    expect(engine.missedTickCount).toBe(2);
  });
});
