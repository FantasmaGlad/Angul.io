import { describe, expect, it } from 'vitest';
import { Room } from '../room.js';
import { SpatialHash } from '../spatialHash.js';
import {
  buildStateMessage,
  centroidOf,
  computeTopScores,
  isVisibleToSpectator,
  SPECTATOR_FOOD_SAMPLE_EVERY,
  toSnapshot,
} from './snapshotBuilder.js';

/** Extraite de broadcast.ts (voir plan_implementation, "worker_threads") sans changement de
 * comportement — ces tests fixent ce comportement avant toute migration vers un `RoomHost`
 * hébergé dans un worker, pour garantir une sortie identique dans les deux hébergements. */
function makeRoom(): Room {
  return new Room({ id: 'test' }, { mapSize: 1000, tickRateHz: 20 });
}

describe('toSnapshot', () => {
  it('arrondit position/rayon au dixième et la masse à l’entier', () => {
    const room = makeRoom();
    const entity = room.world.spawnParticle({ x: 1.23, y: 4.56 }, 10.4);
    entity.radius = 7.89;

    const snapshot = toSnapshot(entity);

    expect(snapshot).toEqual({
      i: entity.id,
      k: 'f',
      x: 1.2,
      y: 4.6,
      r: 7.9,
      m: 10,
      p: undefined,
    });
  });

  it('distingue nourriture ("f") et morceau de joueur ("c")', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    const piece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 20);

    expect(toSnapshot(piece).k).toBe('c');
  });
});

describe('isVisibleToSpectator', () => {
  it('retient toujours les morceaux de joueurs/bots', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    const piece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 20);
    expect(isVisibleToSpectator(piece)).toBe(true);
  });

  it(`échantillonne 1 particule de nourriture sur ${SPECTATOR_FOOD_SAMPLE_EVERY}, par id stable`, () => {
    const room = makeRoom();
    // Assez de particules pour couvrir tous les restes possibles de id % SPECTATOR_FOOD_SAMPLE_EVERY
    // quel que soit l'id de départ (dépend de l'ordre de création interne à World).
    const particles = Array.from({ length: SPECTATOR_FOOD_SAMPLE_EVERY * 2 }, () =>
      room.world.spawnParticle({ x: 0, y: 0 }, 1),
    );

    for (const entity of particles) {
      expect(isVisibleToSpectator(entity)).toBe(Number(entity.id) % SPECTATOR_FOOD_SAMPLE_EVERY === 0);
    }
    expect(particles.some((entity) => isVisibleToSpectator(entity))).toBe(true);
    expect(particles.some((entity) => !isVisibleToSpectator(entity))).toBe(true);
  });
});

describe('centroidOf', () => {
  it('retourne undefined pour une liste vide', () => {
    expect(centroidOf([])).toBeUndefined();
  });

  it('pondère par la masse de chaque morceau', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    const heavy = room.world.spawnPiece('p1', { x: 0, y: 0 }, 30);
    const light = room.world.spawnPiece('p1', { x: 100, y: 0 }, 10);

    const centroid = centroidOf([heavy, light]);

    expect(centroid).toBeDefined();
    expect(centroid!.x).toBeCloseTo(25, 10); // (0*30 + 100*10) / 40
    expect(centroid!.y).toBeCloseTo(0, 10);
  });
});

describe('computeTopScores', () => {
  it('trie par score décroissant, exclut les scores nuls, plafonne à 10', () => {
    const room = makeRoom();
    room.addPlayer('low', 'Low');
    room.addPlayer('high', 'High');
    room.addPlayer('zero', 'Zero'); // aucun morceau : score 0, exclu du classement
    room.world.spawnPiece('low', { x: 0, y: 0 }, 10);
    room.world.spawnPiece('high', { x: 0, y: 0 }, 90);

    const scores = computeTopScores(room.world, Array.from(room.world.allPlayers()));

    expect(scores).toEqual([
      { id: 'high', nickname: 'High', score: 90 },
      { id: 'low', nickname: 'Low', score: 10 },
    ]);
  });
});

describe('buildStateMessage', () => {
  it('filtre les entités par rayon d’intérêt pour un joueur, renvoie totalMass et le classement', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    room.addPlayer('p2', 'Bob');
    const ownPiece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    const nearby = room.world.spawnParticle({ x: 100, y: 0 }, 1);
    const farAway = room.world.spawnParticle({ x: 10_000, y: 10_000 }, 1);
    room.world.spawnPiece('p2', { x: 0, y: 0 }, 20);

    const interestHash = new SpatialHash(200);
    const allEntities = room.world.allEntities();
    for (const entity of allEntities) interestHash.insert(entity);
    const topScores = computeTopScores(room.world, Array.from(room.world.allPlayers()));

    const { message, totalMass } = buildStateMessage({
      room,
      playerId: 'p1',
      isSpectator: false,
      tick: 1,
      allEntities,
      topScores,
      interestHash,
      interestRadiusPx: 200,
    });

    expect(totalMass).toBe(50);
    expect(message.type).toBe('state');
    if (message.type !== 'state') throw new Error('unreachable');
    const ids = message.entities.map((e) => e.i);
    expect(ids).toContain(ownPiece.id);
    expect(ids).toContain(nearby.id);
    expect(ids).not.toContain(farAway.id);
    expect(message.leaderboard.find((entry) => entry.isSelf)?.nickname).toBe('Alice');
  });

  it('renvoie toutes les entités (nourriture échantillonnée) pour un spectateur, sans filtre de rayon', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    room.world.spawnParticle({ x: 10_000, y: 10_000 }, 1);

    const interestHash = new SpatialHash(200);
    const allEntities = room.world.allEntities();
    for (const entity of allEntities) interestHash.insert(entity);
    const topScores = computeTopScores(room.world, Array.from(room.world.allPlayers()));

    const { message } = buildStateMessage({
      room,
      playerId: 'spectator-1',
      isSpectator: true,
      tick: 1,
      allEntities,
      topScores,
      interestHash,
      interestRadiusPx: 200,
    });

    if (message.type !== 'state') throw new Error('unreachable');
    // Le morceau du joueur (kind 'c') doit être présent, quelle que soit la distance — seule la
    // nourriture est échantillonnée pour un spectateur (voir isVisibleToSpectator).
    expect(message.entities.some((e) => e.k === 'c')).toBe(true);
    expect(message.self).toBeUndefined(); // un spectateur n'a aucun morceau à soi
  });
});
