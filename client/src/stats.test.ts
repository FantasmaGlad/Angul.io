import { describe, expect, it } from 'vitest';
import { speedBetween } from './stats.js';

describe('speedBetween', () => {
  it('renvoie undefined sans position précédente', () => {
    expect(speedBetween(undefined, { x: 10, y: 0 }, 1)).toBeUndefined();
  });

  it('renvoie undefined pour un dt nul ou négatif', () => {
    expect(speedBetween({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeUndefined();
  });

  it('calcule la distance parcourue divisée par le temps écoulé', () => {
    const speed = speedBetween({ x: 0, y: 0 }, { x: 30, y: 40 }, 0.5); // distance 50
    expect(speed).toBeCloseTo(100, 6);
  });
});
