import { describe, expect, it } from 'vitest';
import { applyPassiveDecay, boostFactor, velocityForMass } from './physics.js';

describe('velocityForMass — metriques.md §3', () => {
  it.each([
    [2, 18], // 30 brut, clampé à ×3 = 18
    [50, 6], // référence
    [100, 4.242640687],
    [500, 1.897366596],
    [5000, 1.5], // 0.6 brut, clampé à ×0.25 = 1.5
  ])('v(%i) ≈ %f', (mass, expected) => {
    expect(velocityForMass(mass)).toBeCloseTo(expected, 6);
  });

  it('v(10) est proche de 13.42 (non clampée)', () => {
    expect(velocityForMass(10)).toBeCloseTo(13.416407865, 6);
  });
});

describe('applyPassiveDecay — metriques.md §5', () => {
  it('perd environ 1% en 5s au-dessus de M_START (50)', () => {
    expect(applyPassiveDecay(100, 5)).toBeCloseTo(99, 1);
  });

  it('perd environ 1% en 10s en-dessous de M_START', () => {
    expect(applyPassiveDecay(40, 10)).toBeCloseTo(39.6, 1);
  });

  it('ne perd rien au plancher (2)', () => {
    expect(applyPassiveDecay(2, 1000)).toBe(2);
  });

  it('ne descend jamais sous le plancher même avec un dt énorme', () => {
    expect(applyPassiveDecay(10, 100000)).toBeCloseTo(2, 6);
  });
});

describe('boostFactor — metriques.md §4', () => {
  it('vaut 1 au début du boost (T_BOOST = 0.3s)', () => {
    expect(boostFactor(0.3)).toBeCloseTo(1, 10);
  });

  it('décroît linéairement à mi-parcours', () => {
    expect(boostFactor(0.15)).toBeCloseTo(0.5, 10);
  });

  it('vaut 0 une fois épuisé', () => {
    expect(boostFactor(0)).toBe(0);
  });
});
