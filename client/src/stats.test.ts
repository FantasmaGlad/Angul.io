import type { EntitySnapshot } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import { ownAggregate, speedBetween } from './stats.js';

function piece(overrides: Partial<EntitySnapshot>): EntitySnapshot {
  return { i: 'e1', k: 'c', x: 0, y: 0, r: 7, m: 50, p: 'p1', ...overrides };
}

describe('ownAggregate', () => {
  it('renvoie undefined si le joueur n’a aucun morceau', () => {
    expect(ownAggregate([], 'p1')).toBeUndefined();
  });

  it('additionne la masse et calcule le barycentre pondéré de plusieurs morceaux', () => {
    const entities = [
      piece({ i: 'a', x: 0, y: 0, m: 100 }),
      piece({ i: 'b', x: 300, y: 0, m: 100 }),
    ];
    const result = ownAggregate(entities, 'p1');
    expect(result?.mass).toBe(200);
    expect(result?.x).toBeCloseTo(150, 6);
  });

  it('ignore les morceaux des autres joueurs', () => {
    const entities = [piece({ i: 'mine', p: 'p1', m: 50 }), piece({ i: 'other', p: 'p2', m: 999 })];
    expect(ownAggregate(entities, 'p1')?.mass).toBe(50);
  });
});

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
