import type { EntitySnapshot } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import { computeCamera } from './render.js';

function piece(overrides: Partial<EntitySnapshot>): EntitySnapshot {
  return {
    i: 'e1',
    k: 'c',
    x: 0,
    y: 0,
    r: 7,
    m: 50,
    p: 'p1',
    ...overrides,
  };
}

describe('computeCamera', () => {
  it('retombe sur la position de repli si le joueur n’a aucun morceau', () => {
    const camera = computeCamera([], 'p1', { x: 500, y: 500 });
    expect(camera).toEqual({ x: 500, y: 500, scale: 1 });
  });

  it('se centre sur l’unique morceau du joueur', () => {
    const camera = computeCamera([piece({ x: 100, y: 200 })], 'p1', { x: 0, y: 0 });
    expect(camera.x).toBeCloseTo(100, 6);
    expect(camera.y).toBeCloseTo(200, 6);
    expect(camera.scale).toBeCloseTo(1, 6); // masse = référence -> échelle de base
  });

  it('se centre sur le barycentre pondéré par la masse de plusieurs morceaux', () => {
    const entities = [
      piece({ i: 'a', x: 0, y: 0, m: 100 }),
      piece({ i: 'b', x: 300, y: 0, m: 100 }),
    ];
    const camera = computeCamera(entities, 'p1', { x: 0, y: 0 });
    expect(camera.x).toBeCloseTo(150, 6); // milieu, masses égales
  });

  it('dézoome (échelle réduite) quand la masse totale augmente', () => {
    const small = computeCamera([piece({ m: 50 })], 'p1', { x: 0, y: 0 });
    const big = computeCamera([piece({ m: 5000 })], 'p1', { x: 0, y: 0 });
    expect(big.scale).toBeLessThan(small.scale);
  });

  it('ignore les morceaux appartenant à d’autres joueurs', () => {
    const entities = [
      piece({ i: 'mine', x: 10, y: 10, p: 'p1' }),
      piece({ i: 'other', x: 999, y: 999, p: 'p2' }),
    ];
    const camera = computeCamera(entities, 'p1', { x: 0, y: 0 });
    expect(camera.x).toBeCloseTo(10, 6);
    expect(camera.y).toBeCloseTo(10, 6);
  });
});
