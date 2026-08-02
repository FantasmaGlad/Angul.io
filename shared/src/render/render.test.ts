import type { EntitySnapshot } from '../protocol.js';
import { describe, expect, it } from 'vitest';
import {
  BASE_SCALE,
  computeCamera,
  cullEntitiesForViewport,
  foodColorForMass,
  interpolateEntities,
} from './render.js';

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
    expect(camera).toEqual({ x: 500, y: 500, scale: BASE_SCALE });
  });

  it('se centre sur l’unique morceau du joueur', () => {
    const camera = computeCamera([piece({ x: 100, y: 200 })], 'p1', { x: 0, y: 0 });
    expect(camera.x).toBeCloseTo(100, 6);
    expect(camera.y).toBeCloseTo(200, 6);
    expect(camera.scale).toBeCloseTo(BASE_SCALE, 6); // masse = référence -> échelle de base
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

describe('interpolateEntities', () => {
  it('renvoie le dernier snapshot tel quel en l’absence de snapshot précédent', () => {
    const latest = [piece({ x: 100, y: 100 })];
    expect(interpolateEntities(undefined, latest, 0.5)).toEqual(latest);
  });

  it('interpole la position à mi-chemin entre les deux snapshots (t=0.5)', () => {
    const previous = [piece({ i: 'a', x: 0, y: 0, r: 10 })];
    const latest = [piece({ i: 'a', x: 100, y: 200, r: 20 })];

    const result = interpolateEntities(previous, latest, 0.5);

    expect(result).toEqual([piece({ i: 'a', x: 50, y: 100, r: 15 })]);
  });

  it('t=0 retombe exactement sur la position précédente, t=1 sur la dernière connue', () => {
    const previous = [piece({ i: 'a', x: 0, y: 0 })];
    const latest = [piece({ i: 'a', x: 100, y: 100 })];

    expect(interpolateEntities(previous, latest, 0)).toEqual([piece({ i: 'a', x: 0, y: 0 })]);
    expect(interpolateEntities(previous, latest, 1)).toEqual([piece({ i: 'a', x: 100, y: 100 })]);
  });

  it('rend une entité tout juste apparue directement à sa position, sans historique', () => {
    const previous = [piece({ i: 'a', x: 0, y: 0 })];
    const latest = [piece({ i: 'a', x: 0, y: 0 }), piece({ i: 'new', x: 500, y: 500 })];

    const result = interpolateEntities(previous, latest, 0.5);

    expect(result.find((e) => e.i === 'new')).toEqual(piece({ i: 'new', x: 500, y: 500 }));
  });

  it('ne renvoie plus une entité disparue entre les deux snapshots (mangée/despawn)', () => {
    const previous = [piece({ i: 'a', x: 0, y: 0 }), piece({ i: 'gone', x: 1, y: 1 })];
    const latest = [piece({ i: 'a', x: 10, y: 10 })];

    const result = interpolateEntities(previous, latest, 0.5);

    expect(result.map((e) => e.i)).toEqual(['a']);
  });
});

describe('cullEntitiesForViewport', () => {
  const camera = { x: 0, y: 0, scale: 1 };

  it('garde une entité dans le viewport et rejette une entité loin en dehors', () => {
    const inView = piece({ i: 'in', x: 10, y: 10, p: undefined });
    const outOfView = piece({ i: 'out', x: 10_000, y: 10_000, p: undefined });

    const result = cullEntitiesForViewport([inView, outOfView], camera, 800, 600, undefined);

    expect(result.map((e) => e.i)).toEqual(['in']);
  });

  it('garde toujours les morceaux du joueur lui-même, même hors du viewport', () => {
    const ownFarAway = piece({ i: 'mine', x: 10_000, y: 10_000, p: 'p1' });

    const result = cullEntitiesForViewport([ownFarAway], camera, 800, 600, 'p1');

    expect(result.map((e) => e.i)).toEqual(['mine']);
  });

  it('garde une entité juste en dehors du viewport strict grâce à la marge', () => {
    // Demi-largeur viewport = 400 (800/2/scale) ; avec une marge de 50, une entité à x=420
    // (rayon 7) doit rester incluse alors qu'elle dépasserait un viewport sans marge.
    const nearEdge = piece({ i: 'edge', x: 420, y: 0, r: 7, p: undefined });

    const result = cullEntitiesForViewport([nearEdge], camera, 800, 600, undefined, 50);

    expect(result.map((e) => e.i)).toEqual(['edge']);
  });
});

describe('foodColorForMass — types de particules (v8.0)', () => {
  it('associe une couleur distincte à chacune des masses 1, 2, 3, 5, 8, 10, 40', () => {
    const colors = [1, 2, 3, 5, 8, 10, 40].map(foodColorForMass);
    expect(new Set(colors).size).toBe(6); // 6 couleurs car masse 3 et 5 partagent #8B008B
  });

  it('reste stable (même couleur) pour une masse donnée', () => {
    expect(foodColorForMass(1)).toBe(foodColorForMass(1));
  });

  it('retombe sur une couleur de repli pour une masse inconnue (mod futur)', () => {
    expect(foodColorForMass(999)).toBe(foodColorForMass(1));
  });
});
