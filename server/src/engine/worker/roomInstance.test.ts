import type { ServerMessage } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import type { BotConfig } from '../../mods/parametric/config.js';
import type { ModResolver } from '../roomManager.js';
import type { TickPayload } from './protocol.js';
import { applyRoomBotCountOverride, RoomInstance } from './roomInstance.js';
import { SPECTATOR_TICK_DIVISOR } from './snapshotBuilder.js';

const BASE_BOTS: BotConfig = {
  enabled: true,
  updateFrequencyHz: 4,
  proportions: { fuis: 0.25, neutre: 0.25, agressif: 0.25, fou: 0.25 },
};

describe('applyRoomBotCountOverride', () => {
  it('min === max produit une population fixe (baseline/max/min alignés)', () => {
    const result = applyRoomBotCountOverride(BASE_BOTS, { min: 10, max: 10 });
    expect(result.ambientTargetCount).toBe(10);
    expect(result.maxTotal).toBe(10);
    expect(result.challengers?.baselineCount).toBe(10);
    expect(result.challengers?.maxWithHumans).toBe(10);
    expect(result.challengers?.minWithHumans).toBe(10);
  });

  it('min < max reproduit la rampe existante bornée par ces valeurs', () => {
    const result = applyRoomBotCountOverride(BASE_BOTS, { min: 3, max: 40 });
    expect(result.challengers?.baselineCount).toBe(3);
    expect(result.challengers?.maxWithHumans).toBe(40);
    expect(result.challengers?.minWithHumans).toBe(3);
    expect(result.ambientTargetCount).toBe(40);
    expect(result.maxTotal).toBe(40);
  });

  it("étend massMultipliers pour couvrir jusqu'à `max` rangs (sinon BotManager les recoupe)", () => {
    const withShortMultipliers: BotConfig = {
      ...BASE_BOTS,
      challengers: {
        enabled: true,
        baselineCount: 6,
        maxWithHumans: 15,
        minWithHumans: 6,
        rampHumans: 5,
        massMultipliers: [50, 40, 30],
      },
    };
    const result = applyRoomBotCountOverride(withShortMultipliers, { min: 0, max: 50 });
    expect(result.challengers?.massMultipliers).toHaveLength(50);
    // Les 3 premiers paliers d'origine sont conservés tels quels...
    expect(result.challengers?.massMultipliers.slice(0, 3)).toEqual([50, 40, 30]);
    // ...le dernier palier connu (30) est répété pour tous les rangs supplémentaires.
    expect(result.challengers?.massMultipliers[49]).toBe(30);
  });

  it("préserve rampHumans/massMultipliers existants quand seules les bornes de population changent", () => {
    const withChallengers: BotConfig = {
      ...BASE_BOTS,
      challengers: {
        enabled: true,
        baselineCount: 6,
        maxWithHumans: 15,
        minWithHumans: 6,
        rampHumans: 8,
        massMultipliers: Array(20).fill(5),
      },
    };
    const result = applyRoomBotCountOverride(withChallengers, { min: 2, max: 20 });
    expect(result.challengers?.rampHumans).toBe(8);
    expect(result.challengers?.massMultipliers).toHaveLength(20);
  });
});

/** Filtrage par intérêt + delta nourriture (cahier_des_charges_perf_reseau_grande_carte.md §3) —
 * exercé directement au niveau de `RoomInstance` (pas seulement `interestFilter.ts` en isolation)
 * pour verrouiller le comportement réellement observé par un joueur : `handleTick` doit produire
 * des `entities` PAR JOUEUR, jamais partagées, tout en gardant spectateur/vue admin inchangés. */
describe('RoomInstance — filtrage par intérêt (handleTick)', () => {
  function makeInstance(mapSize = 100_000, tickRateHz = 30): RoomInstance {
    const resolver: ModResolver = () => ({ mod: { id: 'test' }, mapSize });
    return new RoomInstance(
      { id: 'room-1', modId: 'test', tickRateHz, maxPlayers: 30, resetSchedule: null },
      resolver,
    );
  }

  /** Accumule TOUS les payloads de TOUS les ticks déclenchés après son appel (utile pour les
   * ticks spectateur, envoyés seulement 1 tick sur `SPECTATOR_TICK_DIVISOR`). */
  function capture(instance: RoomInstance): TickPayload[] {
    const all: TickPayload[] = [];
    instance.onTick((_tick, payloads) => all.push(...payloads));
    return all;
  }

  function stateEntities(message: ServerMessage): Array<{ i: string; x: number; y: number }> {
    if (message.type !== 'state') throw new Error('message attendu de type "state"');
    return message.entities;
  }

  it('deux joueurs éloignés reçoivent des `entities` différentes, chacun voit son propre morceau mais pas celui du lointain', () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    const bob = instance.join('Bob');
    if (!alice.ok || !bob.ok) throw new Error('join a échoué');

    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 50);
    instance.room.world.spawnPiece(bob.playerId, { x: 90_000, y: 90_000 }, 50);
    instance.connectViewer(alice.playerId, false);
    instance.connectViewer(bob.playerId, false);

    const payloads = capture(instance);
    instance.room.tick();

    const aliceMessage = payloads.find((p) => p.playerId === alice.playerId)!.message;
    const bobMessage = payloads.find((p) => p.playerId === bob.playerId)!.message;
    const aliceEntities = stateEntities(aliceMessage);
    const bobEntities = stateEntities(bobMessage);

    expect(aliceEntities.some((e) => e.x === 0 && e.y === 0)).toBe(true); // son propre morceau
    expect(bobEntities.some((e) => e.x === 90_000 && e.y === 90_000)).toBe(true); // idem pour Bob
    // Ni l'un ni l'autre ne voit le morceau du lointain — bien au-delà du rayon d'intérêt, même
    // avec la marge de sécurité (shared/src/camera.ts `interestRadiusForMass`).
    expect(aliceEntities.some((e) => e.x === 90_000)).toBe(false);
    expect(bobEntities.some((e) => e.x === 0 && e.y === 0)).toBe(false);
    instance.destroy();
  });

  it('les propres morceaux du joueur sont toujours inclus même hors de son propre rayon d’intérêt', () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');

    // Deux morceaux du même joueur, très éloignés l'un de l'autre (après un Dash/split) — le
    // centre d'intérêt est le barycentre pondéré (`centroidOf`), donc plus proche de la masse
    // principale ; le morceau isolé loin du barycentre doit néanmoins toujours être inclus.
    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 1000);
    instance.room.world.spawnPiece(alice.playerId, { x: 95_000, y: 0 }, 10);
    instance.connectViewer(alice.playerId, false);

    const payloads = capture(instance);
    instance.room.tick();

    const entities = stateEntities(payloads.find((p) => p.playerId === alice.playerId)!.message);
    expect(entities.some((e) => e.x === 0 && e.y === 0)).toBe(true);
    expect(entities.some((e) => e.x === 95_000 && e.y === 0)).toBe(true);
    instance.destroy();
  });

  it('un spectateur/la vue admin continue de recevoir le salon entier, sans filtrage par intérêt', () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');

    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 50);
    // Un morceau (pas une particule — l'échantillonnage dédié au fond spectateur,
    // `isVisibleToSpectator`, ne concerne QUE la nourriture, hors périmètre ici) très loin de
    // tout joueur, pour vérifier l'absence de filtrage par intérêt côté spectateur/admin.
    instance.room.world.addPlayer('bot-1', 'Bot');
    instance.room.world.spawnPiece('bot-1', { x: 99_000, y: 99_000 }, 5);
    instance.connectViewer('spectator-1', true);

    const payloads = capture(instance);
    for (let i = 0; i < SPECTATOR_TICK_DIVISOR; i++) instance.room.tick();

    const spectatorMessages = payloads.filter((p) => p.playerId === 'spectator-1');
    expect(spectatorMessages.length).toBeGreaterThan(0);
    const entities = stateEntities(spectatorMessages[0]!.message);
    expect(entities.some((e) => e.x === 99_000 && e.y === 99_000)).toBe(true);
    instance.destroy();
  });

  it('canal admin (§10.1 cahier_des_charges_admin.md) : cadence/fidélité DÉCOUPLÉES du spectateur joueur — toute la nourriture, sans sous-échantillonnage', () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');
    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 50);

    // 12 particules — avec SPECTATOR_FOOD_SAMPLE_EVERY=6, un spectateur JOUEUR n'en verrait
    // qu'une fraction (isVisibleToSpectator, id % 6 === 0), jamais la vue admin.
    const foodIds: string[] = [];
    for (let i = 0; i < 12; i++) {
      foodIds.push(instance.room.world.spawnParticle({ x: 10 + i, y: 10 }, 1).id);
    }

    instance.connectViewer('admin-1', true, true);
    instance.connectViewer('spectator-1', true, false);

    const payloads = capture(instance);
    // ADMIN_TICK_DIVISOR = 1 : un seul tick suffit pour l'admin ; SPECTATOR_TICK_DIVISOR peut
    // exiger plusieurs ticks pour que le spectateur joueur reçoive quoi que ce soit.
    for (let i = 0; i < SPECTATOR_TICK_DIVISOR; i++) instance.room.tick();

    const adminMessages = payloads.filter((p) => p.playerId === 'admin-1');
    const spectatorMessages = payloads.filter((p) => p.playerId === 'spectator-1');
    expect(adminMessages.length).toBeGreaterThan(0);
    expect(spectatorMessages.length).toBeGreaterThan(0);

    const adminFoodIds = stateEntities(adminMessages[0]!.message)
      .filter((e) => foodIds.includes(e.i))
      .map((e) => e.i);
    const spectatorFoodIds = stateEntities(spectatorMessages[0]!.message)
      .filter((e) => foodIds.includes(e.i))
      .map((e) => e.i);

    // L'admin voit TOUTES les particules spawnées, le spectateur joueur seulement une partie
    // (sous-échantillonnage `isVisibleToSpectator`) — la différence prouve le découplage.
    expect(adminFoodIds.length).toBe(12);
    expect(spectatorFoodIds.length).toBeLessThan(12);
    instance.destroy();
  });

  it('nourriture : delta puis resynchronisation complète — un id delta n’est envoyé qu’une fois, une resynchro renvoie tout', () => {
    const instance = makeInstance(100_000, 30);
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');

    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 50);
    instance.room.world.spawnParticle({ x: 50, y: 0 }, 1);
    instance.connectViewer(alice.playerId, false);

    const payloads = capture(instance);
    instance.room.tick(); // tick 1 : premier envoi à ce joueur -> resynchro complète (entitiesFull=true)

    const firstMessage = payloads.find((p) => p.playerId === alice.playerId)!.message;
    if (firstMessage.type !== 'state') throw new Error('unreachable');
    expect(firstMessage.entitiesFull).toBe(true);
    expect(firstMessage.entities.some((e) => e.k === 'f')).toBe(true);

    instance.room.tick(); // tick 2 : la pastille n'a pas bougé, pas de resynchro due -> delta vide
    const secondMessage = payloads.filter((p) => p.playerId === alice.playerId)[1]!.message;
    if (secondMessage.type !== 'state') throw new Error('unreachable');
    expect(secondMessage.entitiesFull).toBe(false);
    expect(secondMessage.entities.some((e) => e.k === 'f')).toBe(false);
    instance.destroy();
  });
});
