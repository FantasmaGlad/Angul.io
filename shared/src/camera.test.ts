import { describe, expect, it } from 'vitest';
import {
  BASE_SCALE,
  MAX_SCALE,
  MIN_SCALE,
  REFERENCE_MASS,
  computeScaleForMass,
  interestRadiusForMass,
} from './camera.js';

describe('computeScaleForMass', () => {
  it('returns BASE_SCALE exactly at the reference mass', () => {
    expect(computeScaleForMass(REFERENCE_MASS)).toBeCloseTo(BASE_SCALE, 10);
  });

  it('decreases (zooms out) as mass grows', () => {
    const scaleAtRef = computeScaleForMass(REFERENCE_MASS);
    const scaleAtHigherMass = computeScaleForMass(REFERENCE_MASS * 4);
    expect(scaleAtHigherMass).toBeLessThan(scaleAtRef);
  });

  it('increases (zooms in) as mass shrinks', () => {
    const scaleAtRef = computeScaleForMass(REFERENCE_MASS);
    const scaleAtLowerMass = computeScaleForMass(REFERENCE_MASS / 4);
    expect(scaleAtLowerMass).toBeGreaterThan(scaleAtRef);
  });

  it('never exceeds MAX_SCALE for a very small mass', () => {
    expect(computeScaleForMass(0.001)).toBeLessThanOrEqual(MAX_SCALE);
  });

  it('never drops below MIN_SCALE for a very large mass', () => {
    expect(computeScaleForMass(1_000_000)).toBeGreaterThanOrEqual(MIN_SCALE);
  });
});

describe('interestRadiusForMass', () => {
  it('grows monotonically with mass (a bigger/more zoomed-out player needs a bigger radius)', () => {
    const small = interestRadiusForMass(REFERENCE_MASS);
    const big = interestRadiusForMass(REFERENCE_MASS * 100);
    expect(big).toBeGreaterThan(small);
  });

  it('is always at least the safety margin, even at the smallest possible mass', () => {
    const radius = interestRadiusForMass(0.001);
    expect(radius).toBeGreaterThan(0);
  });

  it('saturates once MIN_SCALE is reached (very large players share the same radius)', () => {
    const radiusAtHugeMass = interestRadiusForMass(1_000_000);
    const radiusAtEvenHugerMass = interestRadiusForMass(10_000_000);
    expect(radiusAtHugeMass).toBeCloseTo(radiusAtEvenHugerMass, 6);
  });
});
