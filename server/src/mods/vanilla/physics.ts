import { clamp } from '@angulio/shared';
import { LAMBDA_ABOVE_M_START, LAMBDA_BELOW_M_START, VANILLA_CONSTANTS as C } from './constants.js';

/** v(m) = V_REF * √(M_START/m), clampée — metriques.md §3. */
export function velocityForMass(mass: number): number {
  const raw = C.V_REF * Math.sqrt(C.M_START / mass);
  return clamp(raw, C.V_MIN_FACTOR * C.V_REF, C.V_MAX_FACTOR * C.V_REF);
}

/** λ(m) — metriques.md §5. Nul en-dessous du plancher : plus aucune perte. */
export function decayLambda(mass: number): number {
  if (mass <= C.M_DECAY_FLOOR) return 0;
  return mass > C.M_START ? LAMBDA_ABOVE_M_START : LAMBDA_BELOW_M_START;
}

/** m ← m * exp(-λ(m) * Δt), plancher à M_DECAY_FLOOR — metriques.md §5. */
export function applyPassiveDecay(mass: number, dt: number): number {
  const lambda = decayLambda(mass);
  if (lambda === 0) return mass;
  return Math.max(mass * Math.exp(-lambda * dt), C.M_DECAY_FLOOR);
}

/** Facteur multiplicatif du boost de split, décroissance linéaire — metriques.md §4. */
export function boostFactor(boostRemainingS: number): number {
  return clamp(boostRemainingS / C.T_BOOST, 0, 1);
}
