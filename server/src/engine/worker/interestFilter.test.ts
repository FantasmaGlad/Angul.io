import { describe, expect, it } from 'vitest';
import type { Entity } from '../types.js';
import {
  buildCoarseFoodIndex,
  isResyncTick,
  queryCoarseFoodIndex,
  resyncOffsetForPlayer,
  RESYNC_INTERVAL_SEC,
} from './interestFilter.js';

function particle(id: string, x: number, y: number): Entity {
  return { id, kind: 'particle', position: { x, y }, velocity: { x: 0, y: 0 }, mass: 1, radius: 2, data: {} };
}

describe('buildCoarseFoodIndex / queryCoarseFoodIndex', () => {
  it('finds a particle whose cell falls within the query radius', () => {
    const index = buildCoarseFoodIndex([particle('1', 100, 100)], 1000);
    const ids = queryCoarseFoodIndex(index, { x: 0, y: 0 }, 500);
    expect(ids).toContain('1');
  });

  it('does not find a particle far outside the query radius', () => {
    const index = buildCoarseFoodIndex([particle('1', 50000, 50000)], 1000);
    const ids = queryCoarseFoodIndex(index, { x: 0, y: 0 }, 500);
    expect(ids).not.toContain('1');
  });

  it('finds every particle within radius across multiple cells', () => {
    const particles = [particle('a', 0, 0), particle('b', 1500, 0), particle('c', -1500, 1500)];
    const index = buildCoarseFoodIndex(particles, 1000);
    const ids = queryCoarseFoodIndex(index, { x: 0, y: 0 }, 2000);
    expect(new Set(ids)).toEqual(new Set(['a', 'b', 'c']));
  });

  it('returns an empty result for an empty index', () => {
    const index = buildCoarseFoodIndex([], 1000);
    expect(queryCoarseFoodIndex(index, { x: 0, y: 0 }, 5000)).toEqual([]);
  });
});

describe('resyncOffsetForPlayer / isResyncTick', () => {
  it('is deterministic for the same playerId', () => {
    expect(resyncOffsetForPlayer('player-42', 150)).toBe(resyncOffsetForPlayer('player-42', 150));
  });

  it('spreads different players across the interval (not all on offset 0)', () => {
    const intervalTicks = 150; // 7.5s à 20Hz
    const offsets = new Set(
      Array.from({ length: 20 }, (_, i) => resyncOffsetForPlayer(`player-${i}`, intervalTicks)),
    );
    expect(offsets.size).toBeGreaterThan(1);
  });

  it('flags exactly one tick per interval as a resync tick for a given player', () => {
    const intervalTicks = 30 * RESYNC_INTERVAL_SEC;
    const offset = resyncOffsetForPlayer('player-x', intervalTicks);
    let resyncCount = 0;
    for (let tick = 0; tick < intervalTicks; tick++) {
      if (isResyncTick('player-x', tick, intervalTicks)) resyncCount++;
    }
    expect(resyncCount).toBe(1);
    expect(isResyncTick('player-x', offset, intervalTicks)).toBe(true);
  });
});
