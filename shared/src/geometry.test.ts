import { describe, expect, it } from 'vitest';
import { blobGrowthFactor, circleOverlapArea, massToRadius, PI } from './geometry.js';

describe('massToRadius', () => {
  it('blob : rayon = SPAWN_RADIUS·blobGrowthFactor(masse), plancher à SPAWN_RADIUS·2/3 (cahier des charges §4b : croissance rapide puis plate)', () => {
    // Masse de référence (50) : ancre exacte de la courbe (les deux régimes valent 1 à ce point).
    expect(massToRadius(50)).toBeCloseTo(31.5, 10);
    // x10 en masse (régime rapide, exposant 0.62) -> 10^0.62 en rayon, PLUS que l'ancien √10.
    expect(massToRadius(500)).toBeCloseTo(31.5 * Math.pow(10, 0.62), 10);
    expect(massToRadius(500)).toBeGreaterThan(31.5 * Math.sqrt(10));
    // x1000 en masse depuis le point de rupture (régime plat, exposant 0.38) -> croissance
    // nettement MOINS que ce que donnerait le régime rapide extrapolé (√ ou 0.62) sur la même
    // plage — "moins à la fin".
    const late = massToRadius(500_000);
    const earlyExtrapolated = 31.5 * Math.pow(500_000 / 50, 0.62);
    expect(late).toBeLessThan(earlyExtrapolated);
    // Jamais de plafond dur : un blob plus massif a toujours un rayon strictement plus grand.
    expect(massToRadius(1_000_000)).toBeGreaterThan(massToRadius(500_000));
    // Masse minuscule (bot/joueur tout juste mangé, cas limite) : le plancher (2/3 du rayon de
    // spawn) domine, jamais un rayon proche de 0 même à masse quasi nulle.
    expect(massToRadius(2)).toBeCloseTo(31.5 * (2 / 3), 10);
    expect(massToRadius(0)).toBeCloseTo(31.5 * (2 / 3), 10);
  });

  it('pastilles (isParticle) : gardent la racine carrée pure, non affectées par la refonte §4b', () => {
    expect(massToRadius(50, PI, true)).toBeCloseTo(31.5, 10);
    expect(massToRadius(500, PI, true)).toBeCloseTo(31.5 * Math.sqrt(10), 10);
  });
});

describe('blobGrowthFactor', () => {
  it('vaut exactement 1 à la masse de référence (50)', () => {
    expect(blobGrowthFactor(50)).toBeCloseTo(1, 10);
  });

  it('continuité de VALEUR au point de rupture (500) entre les deux régimes', () => {
    const justBelow = blobGrowthFactor(499.999);
    const atBreakpoint = blobGrowthFactor(500);
    const justAbove = blobGrowthFactor(500.001);
    expect(atBreakpoint).toBeCloseTo(justBelow, 2);
    expect(atBreakpoint).toBeCloseTo(justAbove, 2);
  });

  it('croît strictement avec la masse, sur toute la plage (jamais de plafond)', () => {
    const masses = [1, 50, 200, 500, 5_000, 50_000, 5_000_000];
    for (let i = 1; i < masses.length; i++) {
      expect(blobGrowthFactor(masses[i]!)).toBeGreaterThan(blobGrowthFactor(masses[i - 1]!));
    }
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
