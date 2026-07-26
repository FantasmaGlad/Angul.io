import { describe, expect, it } from 'vitest';
import { distance, normalize } from './vector.js';

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
