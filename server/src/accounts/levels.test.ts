import { describe, expect, it } from 'vitest';
import { levelForXp, xpForScore } from './levels.js';

describe('levelForXp', () => {
  it('commence au niveau 1 à 0 XP', () => {
    expect(levelForXp(0)).toBe(1);
  });

  it('passe au niveau 2 à 100 XP (courbe en racine carrée)', () => {
    expect(levelForXp(99)).toBe(1);
    expect(levelForXp(100)).toBe(2);
  });

  it('passe au niveau 3 à 400 XP', () => {
    expect(levelForXp(399)).toBe(2);
    expect(levelForXp(400)).toBe(3);
  });

  it('ne descend jamais sous le niveau 1 (XP négatif défensif)', () => {
    expect(levelForXp(-50)).toBe(1);
  });
});

describe('xpForScore', () => {
  it('vaut le score arrondi (masse max atteinte, seule mesure de performance à ce jour)', () => {
    expect(xpForScore(123.6)).toBe(124);
  });

  it('ne descend jamais sous 0', () => {
    expect(xpForScore(-10)).toBe(0);
  });
});
