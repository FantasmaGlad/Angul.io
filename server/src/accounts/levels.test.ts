import { describe, expect, it } from 'vitest';
import { levelForXp } from './levels.js';

describe('levelForXp', () => {
  it('commence au niveau 1 à 0 XP', () => {
    expect(levelForXp(0)).toBe(1);
  });

  it('reste au niveau 1 juste avant le coût du niveau 1 (1000xp, valeur fournie)', () => {
    expect(levelForXp(999)).toBe(1);
    expect(levelForXp(1000)).toBe(2);
  });

  it('passe au niveau 3 après avoir aussi consommé le coût du niveau 2 (1050xp, valeur fournie)', () => {
    // Cumul pour atteindre le niveau 3 : 1000 (niveau 1) + 1050 (niveau 2) = 2050.
    expect(levelForXp(2049)).toBe(2);
    expect(levelForXp(2050)).toBe(3);
  });

  it('passe au niveau 4 après le coût du niveau 3 (1110xp, N+1 = N*1,2-150)', () => {
    // 1050*1,2-150 = 1110 ; cumul pour le niveau 4 : 2050 + 1110 = 3160.
    expect(levelForXp(3159)).toBe(3);
    expect(levelForXp(3160)).toBe(4);
  });

  it('ne descend jamais sous le niveau 1 (XP négatif défensif)', () => {
    expect(levelForXp(-50)).toBe(1);
  });
});
