import { randomInt } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GameMod } from './mod.js';
import { RoomManager, type ModResolver, type RoomManagerOptions } from './roomManager.js';
import { createLocalRoomHost } from './worker/roomHost.js';

vi.mock('node:crypto', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:crypto')>();
  return { ...actual, randomInt: vi.fn(actual.randomInt) };
});

const testMod: GameMod = { id: 'test' };

function testResolver(mapSize = 1000): ModResolver {
  return () => ({ mod: testMod, mapSize });
}

describe('RoomManager', () => {
  const managers: RoomManager[] = [];

  function makeManager(
    resolver: ModResolver = testResolver(),
    tickRateHz = 20,
    options?: RoomManagerOptions,
  ): RoomManager {
    // Nettoyage désactivé par défaut dans les tests (délai très long) : chaque comportement de
    // nettoyage est testé explicitement via `pruneEmptyRooms()`, appelé manuellement plutôt que
    // d'attendre un vrai délai d'horloge.
    const host = createLocalRoomHost(resolver);
    const manager = new RoomManager(host, tickRateHz, {
      emptyRoomGraceMs: 10_000_000,
      ...options,
    });
    managers.push(manager);
    return manager;
  }

  afterEach(() => {
    // Chaque Room créée démarre un setInterval réel — l'arrêter évite de laisser le process de
    // test tourner indéfiniment (pas de handle exposé par RoomManager lui-même, on passe par la
    // Room de chaque salon connu). Idem pour le timer de nettoyage du RoomManager lui-même.
    for (const manager of managers) {
      manager.stopPruning();
      for (const managed of manager.allManagedRooms()) managed.room.stop();
    }
    managers.length = 0;
  });

  it('crée un salon et le retrouve par id', () => {
    const manager = makeManager();
    const summary = manager.createRoom({ name: 'Salon 1', modId: 'vanilla', visibility: 'public' });

    expect(summary).toMatchObject({
      name: 'Salon 1',
      modId: 'vanilla',
      visibility: 'public',
      playerCount: 0,
    });
    expect(manager.getManagedRoom(summary.id)?.name).toBe('Salon 1');
  });

  it('attribue des ids courts et uniques à chaque salon', () => {
    const manager = makeManager();
    const first = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
    const second = manager.createRoom({ name: 'B', modId: 'vanilla', visibility: 'public' });

    expect(first.id).not.toBe(second.id);
  });

  it('ne liste que les salons publics', () => {
    const manager = makeManager();
    manager.createRoom({ name: 'Public', modId: 'vanilla', visibility: 'public' });
    manager.createRoom({ name: 'Privé', modId: 'vanilla', visibility: 'private' });

    const names = manager.listPublicRooms().map((room) => room.name);
    expect(names).toEqual(['Public']);
  });

  it('plusieurs salons existent en mémoire simultanément avec des simulations indépendantes', () => {
    const mod: GameMod = {
      id: 'test',
      onPlayerJoin: (world, playerId) => {
        world.spawnPiece(playerId, { x: 0, y: 0 }, 50);
      },
    };
    const manager = makeManager(() => ({ mod, mapSize: 1000 }));

    const roomA = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
    const roomB = manager.createRoom({ name: 'B', modId: 'vanilla', visibility: 'public' });

    const managedA = manager.getManagedRoom(roomA.id)!;
    const managedB = manager.getManagedRoom(roomB.id)!;

    managedA.room.addPlayer('p1', 'Alice');
    // roomB ne voit aucun joueur : les deux Room ne partagent aucun état.
    expect(managedA.room.world.allPlayers()).toHaveLength(1);
    expect(managedB.room.world.allPlayers()).toHaveLength(0);

    managedA.room.tick();
    managedB.room.tick();

    expect(managedA.room.currentTick).toBe(1);
    expect(managedB.room.currentTick).toBe(1);
    expect(managedA.room.world.allEntities().length).toBeGreaterThan(0);
    expect(managedB.room.world.allEntities()).toHaveLength(0);
  });

  it('playerCount reflète le nombre de joueurs réel du salon', () => {
    const manager = makeManager();
    const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
    const managed = manager.getManagedRoom(summary.id)!;

    managed.room.addPlayer('p1', 'Alice');
    managed.room.addPlayer('p2', 'Bob');

    expect(manager.listPublicRooms()[0].playerCount).toBe(2);
  });

  it('notifie les auditeurs onRoomCreated pour chaque nouveau salon, y compris après coup', () => {
    const manager = makeManager();
    const created: string[] = [];
    manager.onRoomCreated((managed) => created.push(managed.name));

    manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
    manager.createRoom({ name: 'B', modId: 'vanilla', visibility: 'public' });

    expect(created).toEqual(['A', 'B']);
  });

  it('resolveMod reçoit le modId demandé, permettant un mapSize propre à chaque salon', () => {
    const requestedIds: string[] = [];
    const manager = makeManager((modId) => {
      requestedIds.push(modId);
      return { mod: testMod, mapSize: modId === 'hardcore' ? 20_000 : 4000 };
    });

    manager.createRoom({ name: 'A', modId: 'hardcore', visibility: 'public' });

    expect(requestedIds).toEqual(['hardcore']);
    expect(manager.getManagedRoom('1')!.room.world.mapSize).toBe(20_000);
  });

  describe('salons privés (Lot 2.3)', () => {
    it('génère un code d’invitation à 6 chiffres pour un salon privé, absent pour un salon public', () => {
      const manager = makeManager();
      const priv = manager.createRoom({ name: 'Privé', modId: 'vanilla', visibility: 'private' });
      const pub = manager.createRoom({ name: 'Public', modId: 'vanilla', visibility: 'public' });

      expect(priv.inviteCode).toMatch(/^\d{6}$/);
      expect(pub.inviteCode).toBeUndefined();
    });

    it('complète par des zéros à gauche un code tiré en dessous de 100000', () => {
      vi.mocked(randomInt).mockReturnValueOnce(42);
      const manager = makeManager();

      const priv = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'private' });

      expect(priv.inviteCode).toBe('000042');
    });

    it('tire un nouveau code en cas de collision avec un salon privé déjà actif', () => {
      const manager = makeManager();
      vi.mocked(randomInt).mockReturnValueOnce(123456);
      const first = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'private' });
      expect(first.inviteCode).toBe('123456');

      // Même valeur tirée une première fois (collision avec le salon existant), puis une
      // valeur différente : le second salon ne doit jamais récupérer un code déjà utilisé.
      vi.mocked(randomInt).mockReturnValueOnce(123456).mockReturnValueOnce(654321);
      const second = manager.createRoom({ name: 'B', modId: 'vanilla', visibility: 'private' });

      expect(second.inviteCode).toBe('654321');
    });

    it('résout un salon privé par son code d’invitation', () => {
      const manager = makeManager();
      const priv = manager.createRoom({ name: 'Privé', modId: 'vanilla', visibility: 'private' });

      expect(manager.getManagedRoom(priv.inviteCode!)?.id).toBe(priv.id);
    });

    it('refuse de résoudre un salon privé par son id brut (id court, séquentiel, énumérable)', () => {
      const manager = makeManager();
      const priv = manager.createRoom({ name: 'Privé', modId: 'vanilla', visibility: 'private' });

      // Sans cette protection, deviner "1", "2", "3"... suffirait à rejoindre n'importe quel
      // salon "privé" — l'id seul ne doit jamais suffire, seul le code d'invitation le doit.
      expect(manager.getManagedRoom(priv.id)).toBeUndefined();
    });

    it('ne résout pas un salon public par un code arbitraire (seuls les salons privés ont un code)', () => {
      const manager = makeManager();
      manager.createRoom({ name: 'Public', modId: 'vanilla', visibility: 'public' });

      expect(manager.getManagedRoom('un-code-au-hasard')).toBeUndefined();
    });

    it('n’expose jamais un salon privé via listPublicRooms', () => {
      const manager = makeManager();
      manager.createRoom({ name: 'Privé', modId: 'vanilla', visibility: 'private' });

      expect(manager.listPublicRooms()).toEqual([]);
    });
  });

  describe('durcissement avant exposition publique', () => {
    it('refuse de créer un salon au-delà de maxRooms', () => {
      const manager = makeManager(testResolver(), 20, { maxRooms: 2 });
      manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
      manager.createRoom({ name: 'B', modId: 'vanilla', visibility: 'public' });

      expect(() =>
        manager.createRoom({ name: 'C', modId: 'vanilla', visibility: 'public' }),
      ).toThrow(/maximal/);
    });

    it('supprime un salon non permanent vide depuis plus longtemps que le délai de grâce', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 5 });
      const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });

      await new Promise((resolve) => setTimeout(resolve, 20));
      manager.pruneEmptyRooms();

      expect(manager.getManagedRoom(summary.id)).toBeUndefined();
    });

    it('ne supprime jamais un salon permanent, même vide', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 5 });
      const summary = manager.createRoom({
        name: 'Défaut',
        modId: 'vanilla',
        visibility: 'public',
        permanent: true,
      });

      await new Promise((resolve) => setTimeout(resolve, 20));
      manager.pruneEmptyRooms();

      expect(manager.getManagedRoom(summary.id)).toBeDefined();
    });

    it('ne supprime pas un salon qui a au moins un joueur', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 5 });
      const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });
      manager.getManagedRoom(summary.id)!.room.addPlayer('p1', 'Alice');

      await new Promise((resolve) => setTimeout(resolve, 20));
      manager.pruneEmptyRooms();

      expect(manager.getManagedRoom(summary.id)).toBeDefined();
    });

    it('notifie onRoomRemoved quand un salon est supprimé automatiquement', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 5 });
      const removed: string[] = [];
      manager.onRoomRemoved((id) => removed.push(id));
      const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });

      await new Promise((resolve) => setTimeout(resolve, 20));
      manager.pruneEmptyRooms();

      expect(removed).toEqual([summary.id]);
    });
  });

  describe('capacité et durée de vie (refonte UI/UX accueil)', () => {
    it('expose une capacité par défaut et le flag permanent sur RoomSummary', () => {
      const manager = makeManager();
      const summary = manager.createRoom({
        name: 'Défaut',
        modId: 'vanilla',
        visibility: 'public',
        permanent: true,
      });

      expect(summary.maxPlayers).toBeGreaterThan(0);
      expect(summary.permanent).toBe(true);
    });

    it('reflète la capacité personnalisée ("Nombre de Joueurs")', () => {
      const manager = makeManager();
      const summary = manager.createRoom({
        name: 'A',
        modId: 'vanilla',
        visibility: 'public',
        maxPlayers: 12,
      });

      expect(summary.maxPlayers).toBe(12);
      expect(manager.getManagedRoom(summary.id)?.maxPlayers).toBe(12);
    });

    it('un salon sans permanent:true a permanent:false par défaut', () => {
      const manager = makeManager();
      const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });

      expect(summary.permanent).toBe(false);
    });

    it('ferme automatiquement un salon à l’échéance de sa durée de vie, même avec un joueur connecté', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 10_000_000 });
      const removed: string[] = [];
      manager.onRoomRemoved((id) => removed.push(id));
      const summary = manager.createRoom({
        name: 'Éphémère',
        modId: 'vanilla',
        visibility: 'public',
        durationMs: 5,
      });
      manager.getManagedRoom(summary.id)!.room.addPlayer('p1', 'Alice');

      await new Promise((resolve) => setTimeout(resolve, 30));

      expect(manager.getManagedRoom(summary.id)).toBeUndefined();
      expect(removed).toEqual([summary.id]);
    });

    it('un salon sans durationMs ne s’auto-supprime jamais par expiration', async () => {
      const manager = makeManager(testResolver(), 20, { emptyRoomGraceMs: 10_000_000 });
      const summary = manager.createRoom({ name: 'A', modId: 'vanilla', visibility: 'public' });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(manager.getManagedRoom(summary.id)).toBeDefined();
    });

    it('expireRoom sur un id déjà supprimé ne fait rien (pas d’erreur, pas de double notification)', () => {
      const manager = makeManager();
      const removed: string[] = [];
      manager.onRoomRemoved((id) => removed.push(id));

      expect(() => manager.expireRoom('id-inconnu')).not.toThrow();
      expect(removed).toEqual([]);
    });

    it('permet de désactiver les bots à la création du salon (botsEnabled: false)', () => {
      const botsConfig = {
        enabled: true,
        targetRatio: 0.5,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      };
      const manager = makeManager(() => ({ mod: testMod, mapSize: 1000, bots: botsConfig }));

      const summary = manager.createRoom({
        name: 'Salon Sans Bots',
        modId: 'vanilla',
        visibility: 'public',
        botsEnabled: false,
      });

      const managed = manager.getManagedRoom(summary.id)!;
      managed.room.tick();

      expect(managed.room.botManager?.activeBotCount ?? 0).toBe(0);
      expect(managed.room.world.allPlayers()).toHaveLength(0);
    });

    it('supprime un salon non-permanent avec bots lorsque le nombre de joueurs humains tombe à 0', () => {
      const botsConfig = {
        enabled: true,
        targetRatio: 0.5,
        ambientTargetCount: 6,
        updateFrequencyHz: 2,
        proportions: { fuis: 25, neutre: 30, agressif: 30, fou: 15 },
      };
      const manager = makeManager(() => ({ mod: testMod, mapSize: 1000, bots: botsConfig }), 20, {
        emptyRoomGraceMs: 50,
      });

      const summary = manager.createRoom({
        name: 'Salon Privé Bots',
        modId: 'vanilla',
        visibility: 'private',
        botsEnabled: true,
      });

      const managed = manager.allManagedRooms().find((r) => r.id === summary.id)!;
      // Active les bots
      managed.room.tick();
      expect(managed.room.world.allPlayers().length).toBeGreaterThan(0);

      // Un joueur humain arrive puis repart
      managed.room.addPlayer('human-1', 'Alice');
      expect(manager.humanCountOf(managed)).toBe(1);

      managed.room.removePlayer('human-1');
      expect(manager.humanCountOf(managed)).toBe(0);

      // Avancer le temps au-delà de emptyRoomGraceMs
      const originalNow = Date.now;
      try {
        Date.now = () => originalNow() + 100;
        manager.pruneEmptyRooms();
      } finally {
        Date.now = originalNow;
      }

      expect(manager.allManagedRooms().find((r) => r.id === summary.id)).toBeUndefined();
    });
  });
});
