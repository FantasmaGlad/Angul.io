import { describe, expect, it } from 'vitest';
import type { BaseRoomConfig } from './roomsConfig.js';
import { diffBaseRooms, validateBaseRoomsPayload } from './roomsDiff.js';

function room(overrides: Partial<BaseRoomConfig> & { id: string }): BaseRoomConfig {
  return { name: 'Salon', modId: 'vanilla', mapSize: 15000, maxPlayers: 30, resetDurationMin: 120, ...overrides };
}

describe('diffBaseRooms (P6, §8.4 plan-implementation-admin.md)', () => {
  it("une entrée sans id est toujours 'created', même si une entrée précédente porte le même nom", () => {
    const previous = [room({ id: 'a', name: 'Vanilla' })];
    const proposed = [room({ id: 'a', name: 'Vanilla' }), { name: 'Vanilla', modId: 'vanilla' } as BaseRoomConfig];
    const diff = diffBaseRooms(previous, proposed);
    expect(diff.find((e) => e.status === 'created')).toBeDefined();
  });

  it("mapSize différent => 'recreated'", () => {
    const previous = [room({ id: 'a', mapSize: 15000 })];
    const proposed = [room({ id: 'a', mapSize: 20000 })];
    expect(diffBaseRooms(previous, proposed)).toEqual([{ id: 'a', name: 'Salon', status: 'recreated' }]);
  });

  it("maxPlayers différent => 'recreated'", () => {
    const previous = [room({ id: 'a', maxPlayers: 30 })];
    const proposed = [room({ id: 'a', maxPlayers: 50 })];
    expect(diffBaseRooms(previous, proposed)[0]?.status).toBe('recreated');
  });

  it("modId différent (sans changement structurel) => 'hot-reconfigured'", () => {
    const previous = [room({ id: 'a', modId: 'vanilla' })];
    const proposed = [room({ id: 'a', modId: 'hardcore' })];
    expect(diffBaseRooms(previous, proposed)).toEqual([{ id: 'a', name: 'Salon', status: 'hot-reconfigured' }]);
  });

  it("resetDurationMin différent (sans changement structurel) => 'hot-reconfigured'", () => {
    const previous = [room({ id: 'a', resetDurationMin: 120 })];
    const proposed = [room({ id: 'a', resetDurationMin: 60 })];
    expect(diffBaseRooms(previous, proposed)[0]?.status).toBe('hot-reconfigured');
  });

  it("aucun changement => 'unchanged'", () => {
    const previous = [room({ id: 'a' })];
    const proposed = [room({ id: 'a' })];
    expect(diffBaseRooms(previous, proposed)[0]?.status).toBe('unchanged');
  });

  it("une entrée précédente absente des proposées => 'closed'", () => {
    const previous = [room({ id: 'a' }), room({ id: 'b', name: 'À fermer' })];
    const proposed = [room({ id: 'a' })];
    expect(diffBaseRooms(previous, proposed)).toEqual([
      { id: 'a', name: 'Salon', status: 'unchanged' },
      { id: 'b', name: 'À fermer', status: 'closed' },
    ]);
  });

  it('recréation ET fermeture simultanées, ordre attendu (proposées puis fermetures)', () => {
    const previous = [room({ id: 'a', mapSize: 15000 }), room({ id: 'b', name: 'À fermer' })];
    const proposed = [room({ id: 'a', mapSize: 20000 })];
    const diff = diffBaseRooms(previous, proposed);
    expect(diff.map((e) => e.status)).toEqual(['recreated', 'closed']);
  });
});

describe('validateBaseRoomsPayload (A10 cahier_des_charges_admin.md)', () => {
  const availableModIds = ['vanilla', 'hardcore'];

  it('accepte un payload valide', () => {
    const result = validateBaseRoomsPayload(
      [{ id: 'a', name: 'Vanilla', modId: 'vanilla', mapSize: 15000, maxPlayers: 30, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(result.ok).toBe(true);
  });

  it('rejette un tableau vide', () => {
    expect(validateBaseRoomsPayload([], availableModIds).ok).toBe(false);
  });

  it('rejette un nom vide', () => {
    const result = validateBaseRoomsPayload(
      [{ name: '  ', modId: 'vanilla', mapSize: 15000, maxPlayers: 30, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.some((e) => e.includes('nom'))).toBe(true);
  });

  it('rejette un modId inconnu', () => {
    const result = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'inconnu', mapSize: 15000, maxPlayers: 30, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(result.ok).toBe(false);
  });

  it('rejette mapSize hors bornes [1000,50000]', () => {
    const tooSmall = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'vanilla', mapSize: 500, maxPlayers: 30, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(tooSmall.ok).toBe(false);
    const tooBig = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'vanilla', mapSize: 100_000, maxPlayers: 30, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(tooBig.ok).toBe(false);
  });

  it('rejette maxPlayers hors bornes [1,200]', () => {
    const result = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'vanilla', mapSize: 15000, maxPlayers: 500, resetDurationMin: 120 }],
      availableModIds,
    );
    expect(result.ok).toBe(false);
  });

  it('rejette resetDurationMin négatif', () => {
    const result = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'vanilla', mapSize: 15000, maxPlayers: 30, resetDurationMin: -1 }],
      availableModIds,
    );
    expect(result.ok).toBe(false);
  });

  it('accepte resetDurationMin à 0 (reset automatique désactivé)', () => {
    const result = validateBaseRoomsPayload(
      [{ name: 'X', modId: 'vanilla', mapSize: 15000, maxPlayers: 30, resetDurationMin: 0 }],
      availableModIds,
    );
    expect(result.ok).toBe(true);
  });
});
