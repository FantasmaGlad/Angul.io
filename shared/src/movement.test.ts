import { describe, expect, it } from 'vitest';
import {
  DASH_BASE_SPEED,
  accelerationForMass,
  dashSpeedForMass,
  decelerationForMass,
  velocityForMass,
  type MovementConfig,
} from './movement.js';

const config: MovementConfig = {
  v0: 300,
  speedMultiplier: 1.5,
  speedMassExponent: 0.0333,
  velocityFloor: 20,
  accelerationBase: 6750,
  accelerationMassExponent: 0.35,
  startMass: 50,
  mergeOverlapMinFraction: 0.3,
};

describe('decelerationForMass — cahier des charges §4a (freinage moins fort avec la masse)', () => {
  it('repli sur accelerationMassExponent quand decelerationMassExponent est absent (comportement historique)', () => {
    expect(decelerationForMass(5000, config)).toBeCloseTo(accelerationForMass(5000, config), 10);
  });

  it('avec un exposant dédié plus fort, décroît plus vite avec la masse que accelerationForMass', () => {
    const withDecel: MovementConfig = { ...config, decelerationMassExponent: 0.7 };
    const accel = accelerationForMass(5000, withDecel);
    const decel = decelerationForMass(5000, withDecel);
    expect(decel).toBeLessThan(accel);
  });

  it('égal à accelerationForMass à la masse de référence, quel que soit l’exposant de freinage', () => {
    const withDecel: MovementConfig = { ...config, decelerationMassExponent: 0.7 };
    expect(decelerationForMass(config.startMass, withDecel)).toBeCloseTo(
      accelerationForMass(config.startMass, withDecel),
      10,
    );
  });

  it('un gros blob garde son élan strictement plus longtemps qu’avant (exposant dédié > exposant partagé)', () => {
    const shared: MovementConfig = { ...config };
    const dedicated: MovementConfig = { ...config, decelerationMassExponent: 0.7 };
    const bigMass = 50_000;
    // Temps pour combler un même écart de vitesse ∝ 1/taux — un taux de freinage plus petit
    // (formule dédiée) signifie un freinage qui dure plus longtemps.
    expect(decelerationForMass(bigMass, dedicated)).toBeLessThan(decelerationForMass(bigMass, shared));
  });
});

describe('dashSpeedForMass — cahier des charges §4a (dash hardcore moins puissant si gros)', () => {
  it('pleine puissance à la masse de spawn (aucune régression pour un joueur qui vient de spawn)', () => {
    expect(dashSpeedForMass(50)).toBeCloseTo(DASH_BASE_SPEED, 10);
  });

  it('pleine puissance en-dessous de la masse de spawn aussi (jamais plus que 100%)', () => {
    expect(dashSpeedForMass(10)).toBeCloseTo(DASH_BASE_SPEED, 10);
  });

  it('décroît strictement avec la masse au-delà de la masse de spawn', () => {
    const a = dashSpeedForMass(500);
    const b = dashSpeedForMass(5_000);
    const c = dashSpeedForMass(50_000);
    expect(a).toBeLessThan(DASH_BASE_SPEED);
    expect(b).toBeLessThan(a);
    expect(c).toBeLessThan(b);
  });

  it('ne descend jamais sous le plancher de puissance, même pour une masse énorme (le dash reste toujours utile)', () => {
    const huge = dashSpeedForMass(50_000_000);
    expect(huge).toBeCloseTo(DASH_BASE_SPEED * 0.4, 6);
    expect(huge).toBeGreaterThan(0);
  });
});

describe('velocityForMass/accelerationForMass — non-régression (formules inchangées)', () => {
  it('v(m) ne descend jamais sous velocityFloor', () => {
    // speedMassExponent (0.0333) est volontairement quasi plat — un exposant plus marqué le
    // rendrait dominant bien avant une masse aussi extrême, d'où cette config locale dédiée.
    const steepConfig: MovementConfig = { ...config, speedMassExponent: 0.5 };
    expect(velocityForMass(1e12, steepConfig)).toBeCloseTo(config.velocityFloor, 6);
  });

  it('a(m) décroît avec la masse', () => {
    expect(accelerationForMass(5000, config)).toBeLessThan(accelerationForMass(config.startMass, config));
  });
});
