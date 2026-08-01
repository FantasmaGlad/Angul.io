import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMod } from './mod.js';
import { Room } from './room.js';

/** Room configurée pour un unique tick déterministe : start() (dt ignoré) puis stop(), puis un
 * seul tick() manuel avec un ÉCART D'HORLOGE RÉEL contrôlé via performance.now() mocké —
 * `dtSeconds` ne pilote plus la physique (pas de temps fixe, voir `Room.tick()`), seulement la
 * détection de surcharge (`tickOverruns`). La plupart des tests ci-dessous passent 0.05 (== le
 * nominal à tickRateHz=20) précisément pour ne déclencher aucun overrun sans rapport avec ce
 * qu'ils testent. */
function makeDeterministicRoom(mod: GameMod, dtSeconds: number): Room {
  vi.spyOn(performance, 'now').mockReturnValueOnce(0);
  const room = new Room(mod, { mapSize: 1000, tickRateHz: 20 });
  room.start();
  room.stop();
  vi.spyOn(performance, 'now').mockReturnValueOnce(dtSeconds * 1000);
  return room;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('Room — cycle de vie des hooks', () => {
  it('appelle onRoomInit une seule fois à la construction', () => {
    const onRoomInit = vi.fn();
    const mod: GameMod = { id: 'test', onRoomInit };
    new Room(mod, { mapSize: 1000, tickRateHz: 20 });
    expect(onRoomInit).toHaveBeenCalledTimes(1);
  });

  it('appelle onTick puis onPostMove puis onCollision dans cet ordre à chaque tick', () => {
    const calls: string[] = [];
    const mod: GameMod = {
      id: 'test',
      onTick: () => calls.push('onTick'),
      onPostMove: () => calls.push('onPostMove'),
      onCollision: () => calls.push('onCollision'),
    };
    const room = makeDeterministicRoom(mod, 0.05);
    room.world.spawnParticle({ x: 0, y: 0 }, 10);
    room.world.spawnParticle({ x: 1, y: 0 }, 10); // chevauchement garanti (rayons ≈ 1.78)

    room.tick();

    expect(calls).toEqual(['onTick', 'onPostMove', 'onCollision']);
  });

  it('intègre génériquement la position à partir de la vélocité (position += v * dt)', () => {
    const mod: GameMod = { id: 'test' };
    const room = makeDeterministicRoom(mod, 0.05); // == nominal (tickRateHz: 20), aucun overrun
    const entity = room.world.spawnParticle({ x: 0, y: 0 }, 10);
    entity.velocity = { x: 20, y: 0 };

    room.tick();

    expect(entity.position.x).toBeCloseTo(1, 10); // 20 uc/s * 0.05s (pas nominal)
  });

  it('utilise un dt PHYSIQUE fixe (1/tickRateHz), indépendant du temps réel réellement écoulé', () => {
    // "Fix your timestep" côté serveur : un écart d'horloge réel de 0.1s (double du nominal
    // 0.05s à tickRateHz=20, ex. gigue de `setTimeout`/charge d'un autre salon) ne doit PAS se
    // répercuter dans la physique — sinon la position autoritaire elle-même porte du bruit de
    // timing à chaque tick (voir le commentaire de `Room.tick()`).
    const mod: GameMod = { id: 'test' };
    const room = makeDeterministicRoom(mod, 0.1); // écart réel 0.1s, mais dt physique reste 0.05s
    const entity = room.world.spawnParticle({ x: 0, y: 0 }, 10);
    entity.velocity = { x: 20, y: 0 };

    room.tick();

    expect(entity.position.x).toBeCloseTo(1, 10); // 20 uc/s * 0.05s (nominal), PAS 0.1s (réel)
  });

  it('tickOverruns détecte, lui, un vrai retard d’horloge (diagnostic non affecté par le dt fixe)', () => {
    const mod: GameMod = { id: 'test' };
    // Premier tick() après start() : jamais compté comme overrun (garde `tickCount > 1`, voir
    // Room.tick()), quel que soit l'écart réel — d'où un premier tick "neutre" (dtSeconds au
    // nominal) avant celui qui doit réellement déclencher la détection.
    const room = makeDeterministicRoom(mod, 0.05);
    room.tick();
    expect(room.tickMetrics().overruns).toBe(0);

    // 0.1s réel > 1.5x le nominal (0.05s x 1.5 = 0.075s) : un overrun doit être compté, même si
    // le dt physique injecté dans la physique reste fixe à 0.05s (voir le test précédent).
    vi.spyOn(performance, 'now').mockReturnValueOnce(200);
    room.tick();

    expect(room.tickMetrics().overruns).toBe(1);
  });

  it('déclenche onPlayerDeath quand un joueur perd son dernier morceau', () => {
    const onPlayerDeath = vi.fn();
    const mod: GameMod = { id: 'test', onPlayerDeath };
    const room = makeDeterministicRoom(mod, 0.05);
    room.addPlayer('p1', 'Alice');
    const piece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);

    room.tick(); // le joueur est vivant (a un morceau) : pas de mort déclenchée
    expect(onPlayerDeath).not.toHaveBeenCalled();

    room.world.removeEntity(piece.id);
    vi.spyOn(performance, 'now').mockReturnValueOnce(200);
    room.tick(); // plus aucun morceau : transition vivant -> mort

    expect(onPlayerDeath).toHaveBeenCalledWith(room.world, 'p1');
  });

  it('transmet les inputs reçus au mod via onPlayerInput', () => {
    const onPlayerInput = vi.fn();
    const mod: GameMod = { id: 'test', onPlayerInput };
    const room = makeDeterministicRoom(mod, 0.05);
    room.addPlayer('p1', 'Alice');

    room.handleInput('p1', { target: { x: 1, y: 0 }, intensity: 1, split: false });

    expect(onPlayerInput).toHaveBeenCalledWith(room.world, 'p1', {
      target: { x: 1, y: 0 },
      intensity: 1,
      split: false,
    });
  });

  it('délègue getAccelerationForMass au mod, undefined si le mod ne l’implémente pas', () => {
    const withHook = makeDeterministicRoom(
      { id: 'test', getAccelerationForMass: (mass) => mass * 2 },
      0.05,
    );
    expect(withHook.getAccelerationForMass(10)).toBe(20);

    const withoutHook = makeDeterministicRoom({ id: 'test' }, 0.05);
    expect(withoutHook.getAccelerationForMass(10)).toBeUndefined();
  });

  it('délègue transformScoreForAccount au mod, identité (score/xp bruts) si absent', () => {
    const withHook = makeDeterministicRoom(
      { id: 'test', transformScoreForAccount: () => ({ score: 0, xp: 0 }) },
      0.05,
    );
    expect(withHook.transformScoreForAccount(500, 300)).toEqual({ score: 0, xp: 0 });

    const withoutHook = makeDeterministicRoom({ id: 'test' }, 0.05);
    expect(withoutHook.transformScoreForAccount(500, 300)).toEqual({ score: 500, xp: 300 });
  });

  it('notifie les listeners onPlayerDeath indépendamment du mod (utile au réseau)', () => {
    const mod: GameMod = { id: 'test' };
    const room = makeDeterministicRoom(mod, 0.05);
    const deathListener = vi.fn();
    room.onPlayerDeath(deathListener);
    room.addPlayer('p1', 'Alice');
    const piece = room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);

    room.tick();
    expect(deathListener).not.toHaveBeenCalled();

    room.world.removeEntity(piece.id);
    vi.spyOn(performance, 'now').mockReturnValueOnce(200);
    room.tick();

    expect(deathListener).toHaveBeenCalledWith('p1', {
      killerNickname: undefined,
      survivalTimeSec: expect.any(Number),
    });
  });
});

describe('Room — reset automatique (Lot 2.4)', () => {
  it('reset() vide entièrement le monde (morceaux et nourriture) et fait respawn chaque joueur connecté', () => {
    const onPlayerJoin = vi.fn((world, playerId: string) => {
      world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
    });
    const mod: GameMod = { id: 'test', onPlayerJoin };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20, resetSchedule: null });
    room.addPlayer('p1', 'Alice');
    room.world.spawnParticle({ x: 10, y: 10 }, 5);
    onPlayerJoin.mockClear();

    room.reset();

    expect(room.world.allEntities()).toHaveLength(1); // seulement le nouveau morceau d'Alice
    expect(room.world.getPiecesByOwner('p1')).toHaveLength(1);
    expect(onPlayerJoin).toHaveBeenCalledWith(room.world, 'p1');
  });

  it('conserve le joueur connecté (pseudo, identité) à travers un reset', () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20, resetSchedule: null });
    room.addPlayer('p1', 'Alice');

    room.reset();

    expect(room.world.getPlayer('p1')?.nickname).toBe('Alice');
  });

  it('notifie onPlayerDeath pour chaque joueur ENCORE EN VIE avant de le respawn (retour utilisateur : "le score n\'est pas enregistré quand le salon se reset")', () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20, resetSchedule: null });
    room.addPlayer('p1', 'Alice'); // vivant au moment du reset
    room.addPlayer('p2', 'Bob');
    for (const pieceId of [...room.world.getPlayer('p2')!.pieceIds]) room.world.removeEntity(pieceId);
    // Bob n'a plus aucun morceau (mort avant le reset, en attente de respawn) : ne doit PAS
    // déclencher `onPlayerDeath` une seconde fois — seul Alice était réellement en vie.
    const deathListener = vi.fn();
    room.onPlayerDeath(deathListener);

    room.reset();

    expect(deathListener).toHaveBeenCalledTimes(1);
    expect(deathListener).toHaveBeenCalledWith('p1', {
      killerNickname: undefined,
      survivalTimeSec: expect.any(Number),
    });
  });

  it('notifie les listeners onReset à chaque reset, manuel ou automatique', () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20, resetSchedule: null });
    const listener = vi.fn();
    room.onReset(listener);

    room.reset();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('se réinitialise automatiquement selon la planification fournie (mode "interval", pour les tests)', async () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      resetSchedule: { type: 'interval', intervalMs: 20 },
    });
    const listener = vi.fn();
    room.onReset(listener);

    room.start();
    await new Promise((resolve) => setTimeout(resolve, 70));
    room.stop();

    // Au moins un déclenchement en ~70ms pour un intervalle de 20ms (probablement plusieurs,
    // la planification se reprogrammant après chaque reset — voir Room.scheduleReset).
    expect(listener.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('resetSchedule: null désactive tout reset automatique', async () => {
    const mod: GameMod = { id: 'test' };
    const room = new Room(mod, { mapSize: 1000, tickRateHz: 20, resetSchedule: null });
    const listener = vi.fn();
    room.onReset(listener);

    room.start();
    await new Promise((resolve) => setTimeout(resolve, 50));
    room.stop();

    expect(listener).not.toHaveBeenCalled();
  });
});

describe('Room — actions admin (cahier_des_charges_admin.md §4.3-4.4)', () => {
  it('killPlayer retire tous les morceaux du joueur (déclenche la mort au tick suivant), false pour un joueur inconnu', () => {
    const room = makeDeterministicRoom({ id: 'test' }, 0.05);
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    room.world.spawnPiece('p1', { x: 10, y: 0 }, 30);

    expect(room.killPlayer('inconnu')).toBe(false);
    expect(room.killPlayer('p1')).toBe(true);
    expect(room.world.getPiecesByOwner('p1')).toHaveLength(0);
  });

  it('setFrozen : ignore les inputs et force la vélocité à zéro chaque tick tant que gelé', () => {
    const room = makeDeterministicRoom({ id: 'test', onPlayerInput: (world, id, input) => {
      for (const piece of world.getPiecesByOwner(id)) piece.velocity = input.target;
    } }, 0.1);
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);

    room.setFrozen('p1', true);
    expect(room.isFrozen('p1')).toBe(true);
    room.handleInput('p1', { target: { x: 5, y: 5 }, intensity: 1, split: false });
    // L'input est ignoré (jamais transmis au mod) : la vélocité n'a jamais été positionnée à {5,5}.
    room.tick();
    const [piece] = room.world.getPiecesByOwner('p1');
    expect(piece!.velocity).toEqual({ x: 0, y: 0 });
    expect(piece!.position).toEqual({ x: 0, y: 0 });

    room.setFrozen('p1', false);
    expect(room.isFrozen('p1')).toBe(false);
    room.handleInput('p1', { target: { x: 5, y: 5 }, intensity: 1, split: false });
    expect(piece!.velocity).toEqual({ x: 5, y: 5 });
  });

  it('setPlayerMass répartit la masse cible proportionnellement entre les morceaux existants', () => {
    const room = makeDeterministicRoom({ id: 'test' }, 0.05);
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 30);
    room.world.spawnPiece('p1', { x: 10, y: 0 }, 10); // total 40, ratio 3:1

    expect(room.setPlayerMass('nobody', 100)).toBe(false);
    expect(room.setPlayerMass('p1', 400)).toBe(true);
    const [a, b] = room.world.getPiecesByOwner('p1');
    expect(a!.mass + b!.mass).toBeCloseTo(400, 5);
    expect(a!.mass / b!.mass).toBeCloseTo(3, 5);
  });

  it('forceRemerge regroupe tous les morceaux en un seul (masse conservée)', () => {
    const room = makeDeterministicRoom({ id: 'test' }, 0.05);
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 30);
    room.world.spawnPiece('p1', { x: 1, y: 0 }, 20);
    room.world.spawnPiece('p1', { x: 2, y: 0 }, 10);

    expect(room.forceRemerge('nobody')).toBe(false);
    expect(room.forceRemerge('p1')).toBe(true);
    const pieces = room.world.getPiecesByOwner('p1');
    expect(pieces).toHaveLength(1);
    expect(pieces[0]!.mass).toBeCloseTo(60, 5);
  });

  it('forceSplit synthétise un input split:true transmis au mod', () => {
    const onPlayerInput = vi.fn();
    const room = makeDeterministicRoom({ id: 'test', onPlayerInput }, 0.05);
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 5, y: 5 }, 50);

    expect(room.forceSplit('nobody')).toBe(false);
    expect(room.forceSplit('p1')).toBe(true);
    expect(onPlayerInput).toHaveBeenCalledWith(
      room.world,
      'p1',
      expect.objectContaining({ split: true }),
    );
  });

  it('spawnFood/clearFood : ajoute puis vide toutes les particules du salon', () => {
    const room = makeDeterministicRoom({ id: 'test' }, 0.05);
    room.spawnFood({ x: 1, y: 1 }, 5);
    room.spawnFood({ x: 2, y: 2 }, 7);
    expect(room.world.allEntities().filter((e) => e.kind === 'particle')).toHaveLength(2);

    expect(room.clearFood()).toBe(2);
    expect(room.world.allEntities().filter((e) => e.kind === 'particle')).toHaveLength(0);
  });

  it('clearBots/forceSpawnBot : false/0 sans bots activés', () => {
    const room = makeDeterministicRoom({ id: 'test' }, 0.05);
    expect(room.clearBots()).toBe(0);
    expect(room.forceSpawnBot()).toBe(false);
  });

  it('clearBots/forceSpawnBot avec des bots activés', () => {
    const mod: GameMod = { id: 'test' };
    vi.spyOn(performance, 'now').mockReturnValue(0);
    const room = new Room(mod, {
      mapSize: 1000,
      tickRateHz: 20,
      maxPlayers: 10,
      bots: { enabled: true, targetRatio: 0.5, updateFrequencyHz: 2, proportions: { fuis: 100, neutre: 0, agressif: 0, fou: 0 } },
    });
    room.botManager!.adjustPopulation();
    expect(room.botManager!.activeBotCount).toBeGreaterThan(0);

    const countBefore = room.botManager!.activeBotCount;
    expect(room.forceSpawnBot()).toBe(true);
    expect(room.botManager!.activeBotCount).toBe(countBefore + 1);

    // clearAll() re-peuple immédiatement (bots activés pour ce salon, voir BotManager.clearAll) —
    // le nombre retiré est correct, mais le salon n'est jamais durablement vide de bots.
    expect(room.clearBots()).toBe(countBefore + 1);
    expect(room.botManager!.activeBotCount).toBeGreaterThan(0);
  });

  it('switchMod reconstruit world/mod/botManager en place et re-spawne les joueurs humains connectés', () => {
    const modA: GameMod = {
      id: 'a',
      onPlayerJoin: (world, id) => world.spawnPiece(id, { x: 0, y: 0 }, 10),
    };
    const modB: GameMod = {
      id: 'b',
      onPlayerJoin: (world, id) => world.spawnPiece(id, { x: 0, y: 0 }, 99),
    };
    const room = new Room(modA, { mapSize: 1000, tickRateHz: 20 });
    room.addPlayer('p1', 'Alice');
    expect(room.world.getPiecesByOwner('p1')[0]!.mass).toBe(10);

    const resetListener = vi.fn();
    room.onReset(resetListener);
    room.switchMod(modB, { mapSize: 2000 });

    expect(room.world.mapSize).toBe(2000);
    expect(room.world.getPiecesByOwner('p1')[0]!.mass).toBe(99);
    expect(resetListener).toHaveBeenCalledTimes(1);
  });

  it("Blob Dieu (isGodPlayerId) : invisible du classement (computeTopScores)", async () => {
    const { computeTopScores } = await import('./worker/snapshotBuilder.js');
    const room = new Room({ id: 'test' }, { mapSize: 1000, tickRateHz: 20 });
    room.addPlayer('p1', 'Alice');
    room.world.spawnPiece('p1', { x: 0, y: 0 }, 50);
    room.addPlayer('admin-god-1', 'Fantadmin');
    room.world.spawnPiece('admin-god-1', { x: 0, y: 0 }, 999999);

    const scores = computeTopScores(room.world, room.world.allPlayers());
    expect(scores.map((s) => s.id)).toEqual(['p1']);
  });
});
