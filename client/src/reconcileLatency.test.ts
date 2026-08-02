import { describe, expect, it } from 'vitest';
import { estimatedLatencyMsFromAnchor } from './reconcileLatency.js';

describe('estimatedLatencyMsFromAnchor', () => {
  it('dérive la latence de l’ancrage de RenderEngine quand il est disponible, jamais du ping', () => {
    expect(estimatedLatencyMsFromAnchor(950, 999999, 1000)).toBe(50);
  });

  it('ne renvoie jamais une latence négative (ancrage légèrement dans le futur, gigue de calcul)', () => {
    expect(estimatedLatencyMsFromAnchor(1010, 0, 1000)).toBe(0);
  });

  it('retombe sur le ping lissé si l’ancrage n’est pas encore disponible (avant le tout premier pushSnapshot)', () => {
    expect(estimatedLatencyMsFromAnchor(undefined, 42, 1000)).toBe(42);
  });

  it('renvoie undefined si ni l’ancrage ni le ping ne sont disponibles (reconcile() retombe alors sur son propre DEFAULT_LATENCY_MS)', () => {
    expect(estimatedLatencyMsFromAnchor(undefined, undefined, 1000)).toBeUndefined();
  });
});
