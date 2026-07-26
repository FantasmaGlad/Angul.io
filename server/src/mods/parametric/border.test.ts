import { describe, expect, it } from 'vitest';
import type { Entity } from '../../engine/types.js';
import { applyBorder } from './border.js';
import { testConfig } from './testConfig.js';

function fakePiece(overrides: Partial<Entity> = {}): Entity {
  return {
    id: 'e1',
    kind: 'piece',
    position: { x: 0, y: 0 },
    velocity: { x: 0, y: 0 },
    mass: 50,
    radius: 10,
    data: {},
    ...overrides,
  };
}

describe('applyBorder — STRICT_WALL', () => {
  const config = testConfig({ arena: { width: 100, height: 100, borderType: 'STRICT_WALL' } });

  it('bloque la position au bord et annule la vélocité perpendiculaire', () => {
    const entity = fakePiece({ position: { x: -5, y: 50 }, velocity: { x: -10, y: 3 } });
    applyBorder(entity, config);
    expect(entity.position.x).toBe(10); // = rayon
    expect(entity.velocity.x).toBe(0);
    expect(entity.velocity.y).toBe(3); // axe non concerné, inchangé
  });
});

describe('applyBorder — ELASTIC_BOUNCE', () => {
  const config = testConfig({
    arena: { width: 100, height: 100, borderType: 'ELASTIC_BOUNCE', bounceRestitution: 0.8 },
  });

  it('inverse et réduit la vélocité perpendiculaire selon la restitution', () => {
    const entity = fakePiece({ position: { x: -5, y: 50 }, velocity: { x: -10, y: 0 } });
    applyBorder(entity, config);
    expect(entity.position.x).toBe(10);
    expect(entity.velocity.x).toBeCloseTo(8, 6); // -(-10)*0.8 = 8
  });
});

describe('applyBorder — TOROIDAL', () => {
  const config = testConfig({ arena: { width: 100, height: 100, borderType: 'TOROIDAL' } });

  it('fait réapparaître de l’autre côté de la carte', () => {
    const entity = fakePiece({ position: { x: -5, y: 105 } });
    applyBorder(entity, config);
    expect(entity.position.x).toBeCloseTo(95, 6);
    expect(entity.position.y).toBeCloseTo(5, 6);
  });
});

describe('applyBorder — TOXIC_ZONE', () => {
  it('échoue explicitement (paramètres non spécifiés) plutôt que de faire silencieusement rien', () => {
    const config = testConfig({ arena: { width: 100, height: 100, borderType: 'TOXIC_ZONE' } });
    expect(() => applyBorder(fakePiece(), config)).toThrow();
  });
});
