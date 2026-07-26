import { describe, expect, it } from 'vitest';
import { distance, moveToward, normalize } from './vector.js';

describe('normalize', () => {
  it('returns a unit vector', () => {
    const n = normalize({ x: 3, y: 4 });
    expect(n.x).toBeCloseTo(0.6, 10);
    expect(n.y).toBeCloseTo(0.8, 10);
  });

  it('returns the zero vector for a zero-length input instead of dividing by zero', () => {
    expect(normalize({ x: 0, y: 0 })).toEqual({ x: 0, y: 0 });
  });
});

describe('distance', () => {
  it('computes the euclidean distance between two points', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
  });
});

describe('moveToward', () => {
  it('reaches the target directly when within maxDelta', () => {
    const result = moveToward({ x: 0, y: 0 }, { x: 3, y: 0 }, 5);
    expect(result).toEqual({ x: 3, y: 0 });
  });

  it('moves at most maxDelta toward the target otherwise', () => {
    const result = moveToward({ x: 0, y: 0 }, { x: 10, y: 0 }, 4);
    expect(result.x).toBeCloseTo(4, 10);
    expect(result.y).toBeCloseTo(0, 10);
  });

  it('handles diagonal movement correctly (not per-axis clamping)', () => {
    const result = moveToward({ x: 0, y: 0 }, { x: 3, y: 4 }, 5);
    // distance = 5 exactement -> atteint la cible en une fois
    expect(result).toEqual({ x: 3, y: 4 });
  });
});
