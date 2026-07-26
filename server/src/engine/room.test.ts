import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMod } from './mod.js';
import { Room } from './room.js';

/** Room configurée pour un unique tick déterministe : start() (dt ignoré) puis stop(), puis un
 * seul tick() manuel avec un dt contrôlé via performance.now() mocké. */
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
    const room = makeDeterministicRoom(mod, 0.1);
    const entity = room.world.spawnParticle({ x: 0, y: 0 }, 10);
    entity.velocity = { x: 20, y: 0 };

    room.tick();

    expect(entity.position.x).toBeCloseTo(2, 10); // 20 uc/s * 0.1s
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

    room.handleInput('p1', { dir: { x: 1, y: 0 }, split: false });

    expect(onPlayerInput).toHaveBeenCalledWith(room.world, 'p1', {
      dir: { x: 1, y: 0 },
      split: false,
    });
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

    expect(deathListener).toHaveBeenCalledWith('p1');
  });
});
