import { describe, expect, it } from 'vitest';
import { circleOverlapArea, massToRadius, PI } from './geometry.js';

describe('massToRadius', () => {
  it('calculates particle radius for mass <= 24 and player blob radius for mass > 24', () => {
    expect(massToRadius(2)).toBeCloseTo(Math.sqrt(2), 10);
    expect(massToRadius(50)).toBeCloseTo(84, 10);
    expect(massToRadius(100)).toBeCloseTo(48 + 36 * Math.pow(2, 0.38), 10);
  });
});

describe('circleOverlapArea', () => {
  it('returns 0 when the circles do not touch', () => {
    expect(circleOverlapArea(5, 5, 20)).toBe(0);
    expect(circleOverlapArea(5, 5, 10)).toBe(0); // tangent externe
  });

  it('returns the smaller disc area when one circle fully contains the other', () => {
    const r1 = 10;
    const r2 = 3;
    expect(circleOverlapArea(r1, r2, 0)).toBeCloseTo(PI * r2 * r2, 10);
    expect(circleOverlapArea(r1, r2, r1 - r2)).toBeCloseTo(PI * r2 * r2, 10);
  });

  it('returns half the area of two equal circles overlapping through their centers', () => {
    const r = 10;
    // d = 0 -> cas "un cercle contient l'autre" (rayons egaux, meme centre)
    expect(circleOverlapArea(r, r, 0)).toBeCloseTo(PI * r * r, 10);
  });

  it('matches the known analytic value for two equal circles at d = r (classic lens case)', () => {
    const r = 1;
    const d = 1;
    // Formule fermee connue pour deux cercles de meme rayon r separes de d :
    // 2r^2 * acos(d/2r) - (d/2) * sqrt(4r^2 - d^2)
    const expected = 2 * r * r * Math.acos(d / (2 * r)) - (d / 2) * Math.sqrt(4 * r * r - d * d);
    expect(circleOverlapArea(r, r, d)).toBeCloseTo(expected, 10);
  });
});
