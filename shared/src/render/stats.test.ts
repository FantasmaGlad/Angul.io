import { describe, expect, it } from 'vitest';
import type { EntitySnapshot } from '../protocol.js';
import { ownAggregate } from './stats.js';

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
