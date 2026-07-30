import { describe, expect, it } from 'vitest';
import { Room } from '../room.js';
import {
  buildStateMessage,
  buildVisibleEntitySnapshots,
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

  it('reflète la position réelle d’une particule à vélocité non nulle (éjection de masse) au lieu de la figer au cache', () => {
    const room = makeRoom();
    const entity = room.world.spawnParticle({ x: 0, y: 0 }, 10);
    entity.velocity = { x: 100, y: 0 }; // particule éjectée (tryEjectMass), encore en mouvement

    const firstSnapshot = toSnapshot(entity);
    expect(firstSnapshot.x).toBe(0);

    // La position évolue tick après tick tant que la vélocité n'est pas retombée à zéro (voir
    // EJECT_FRICTION_PER_SEC, mods/parametric/index.ts `onTick`) — simulé ici directement.
    entity.position = { x: 50, y: 0 };
    const secondSnapshot = toSnapshot(entity);
    expect(secondSnapshot.x).toBe(50); // pas figé à l'ancienne position (0) par le cache

    // Une fois immobile (vélocité retombée à zéro), la position de repos redevient mise en cache
    // normalement, comme la nourriture ordinaire.
    entity.velocity = { x: 0, y: 0 };
    entity.position = { x: 75, y: 0 };
    const restSnapshot = toSnapshot(entity);
    expect(restSnapshot.x).toBe(75);
    expect(toSnapshot(entity)).toBe(restSnapshot); // même référence : bien mis en cache désormais
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
    if (SPECTATOR_FOOD_SAMPLE_EVERY > 1) {
      expect(particles.some((entity) => !isVisibleToSpectator(entity))).toBe(true);
    } else {
      expect(particles.every((entity) => isVisibleToSpectator(entity))).toBe(true);
    }
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

describe('buildVisibleEntitySnapshots', () => {
  it('renvoie TOUTES les entités pour un joueur (chargement dynamique par intérêt retiré, demande utilisateur)', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    room.addPlayer('p2', 'Bob');
    const ownPiece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    const nearby = room.world.spawnParticle({ x: 100, y: 0 }, 1);
    // Bien plus loin que l'ancien rayon d'intérêt (quelques milliers de px) : doit désormais
    // rester inclus, contrairement au comportement avant ce correctif.
    const farAway = room.world.spawnParticle({ x: 10_000, y: 10_000 }, 1);
    room.world.spawnPiece('p2', { x: 0, y: 0 }, 20);

    const allEntities = room.world.allEntities();
    const entities = buildVisibleEntitySnapshots(allEntities, false);
    const ids = entities.map((e) => e.i);

    expect(ids).toContain(ownPiece.id);
    expect(ids).toContain(nearby.id);
    expect(ids).toContain(farAway.id);
    expect(entities).toHaveLength(allEntities.length);
  });

  it('échantillonne la nourriture pour un spectateur (jamais les morceaux de joueurs), quelle que soit la distance', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    const ownPiece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    room.world.spawnParticle({ x: 10_000, y: 10_000 }, 1);

    const allEntities = room.world.allEntities();
    const entities = buildVisibleEntitySnapshots(allEntities, true);

    // Le morceau du joueur (kind 'c') doit être présent, quelle que soit la distance — seule la
    // nourriture est échantillonnée pour un spectateur (voir isVisibleToSpectator).
    expect(entities.some((e) => e.i === ownPiece.id)).toBe(true);
    expect(entities.length).toBeLessThan(allEntities.length); // au moins une particule filtrée
  });
});

describe('buildStateMessage', () => {
  it('construit `self`/le classement pour un joueur à partir d’un snapshot déjà prêt, renvoie totalMass', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    room.addPlayer('p2', 'Bob');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    room.world.spawnPiece('p2', { x: 0, y: 0 }, 20);

    const allEntities = room.world.allEntities();
    const entities = buildVisibleEntitySnapshots(allEntities, false);
    const topScores = computeTopScores(room.world, Array.from(room.world.allPlayers()));

    const { message, totalMass } = buildStateMessage({
      room,
      playerId: 'p1',
      tick: 1,
      entities,
      topScores,
    });

    expect(totalMass).toBe(50);
    expect(message.type).toBe('state');
    if (message.type !== 'state') throw new Error('unreachable');
    expect(message.entities).toBe(entities); // partagé tel quel, jamais recopié/refiltré
    expect(message.leaderboard.find((entry) => entry.isSelf)?.nickname).toBe('Alice');
  });

  it('n’attribue aucun `self` à un spectateur (aucun morceau ne lui appartient)', () => {
    const room = makeRoom();
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);

    const allEntities = room.world.allEntities();
    const entities = buildVisibleEntitySnapshots(allEntities, true);
    const topScores = computeTopScores(room.world, Array.from(room.world.allPlayers()));

    const { message } = buildStateMessage({
      room,
      playerId: 'spectator-1',
      tick: 1,
      entities,
      topScores,
    });

    if (message.type !== 'state') throw new Error('unreachable');
    expect(message.self).toBeUndefined();
  });
});
