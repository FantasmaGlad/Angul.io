import type { ServerMessage } from '@angulio/shared';
import { describe, expect, it } from 'vitest';
import type { BotConfig } from '../../mods/parametric/config.js';
import { createParametricMod } from '../../mods/parametric/index.js';
import { testConfig } from '../../mods/parametric/testConfig.js';
import type { PlayerId, PlayerInput } from '../types.js';
import type { ModResolver } from '../roomManager.js';
import type { TickPayload } from './protocol.js';
import { applyRoomBotCountOverride, RoomInstance } from './roomInstance.js';
import { SPECTATOR_TICK_DIVISOR } from './snapshotBuilder.js';

const BASE_BOTS: BotConfig = {
  enabled: true,
  updateFrequencyHz: 4,
  proportions: { fuis: 30, neutre: 30, agressif: 40 },
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

  /** Correctif "le plus gros lag est juste après la connexion" : un destinataire SANS morceau
   * (tout juste rejoint et pas encore apparu, ou mort en attente de respawn) recevait le SALON
   * ENTIER à chaque tick — des milliers de pastilles sérialisées/reparsées ~20 fois par seconde,
   * pour un client qui n'a rien à cadrer. */
  it("un joueur sans morceau reçoit une liste VIDE, jamais le salon entier", () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');
    // Volontairement AUCUN `spawnPiece` pour Alice (le mod factice de `makeInstance` n'en spawne
    // pas non plus au join) — l'état exact du repli sous test.
    for (let i = 0; i < 20; i++) instance.room.world.spawnParticle({ x: 10 + i, y: 10 }, 1);
    instance.connectViewer(alice.playerId, false);

    const payloads = capture(instance);
    instance.room.tick();

    const message = payloads.find((p) => p.playerId === alice.playerId)!.message;
    expect(stateEntities(message)).toEqual([]);
    instance.destroy();
  });

  it("envoie l'état complet filtré par intérêt dès le tick où le morceau existe (rien de perdu, juste différé)", () => {
    const instance = makeInstance();
    const alice = instance.join('Alice');
    if (!alice.ok) throw new Error('join a échoué');
    instance.room.world.spawnParticle({ x: 50, y: 0 }, 1);
    instance.connectViewer(alice.playerId, false);

    const payloads = capture(instance);
    instance.room.tick(); // pas encore de morceau -> liste vide
    instance.room.world.spawnPiece(alice.playerId, { x: 0, y: 0 }, 50);
    instance.room.tick(); // le morceau existe -> resynchro complète (`!lastSent`)

    const aliceMessages = payloads.filter((p) => p.playerId === alice.playerId);
    const secondMessage = aliceMessages[1]!.message;
    if (secondMessage.type !== 'state') throw new Error('unreachable');
    expect(secondMessage.entitiesFull).toBe(true);
    expect(secondMessage.entities.some((e) => e.k === 'f')).toBe(true);
    expect(secondMessage.entities.some((e) => e.k === 'c')).toBe(true);
    instance.destroy();
  });
});

/** Dispatch admin `adminAction({ kind: 'spawnBot', ... })` (§4.3, `adminAction` switch) — Bots
 * PERSONNALISÉS (cahier_des_charges_admin.md §9.3/§17, "création de robots configurables
 * sur-mesure") : vérifie que les champs `nickname`/`mass`/`x`/`y` de l'action traversent bien
 * cette frontière worker jusqu'au morceau du bot réellement spawné, et que l'action existante SANS
 * ces champs (bouton "Spawn bot" déjà en production) reste inchangée. Mod paramétrique réel
 * (contrairement à `makeInstance` ci-dessus, dont le mod factice `{ id: 'test' }` ne spawne aucun
 * morceau à la connexion) — nécessaire ici pour observer une masse/position de morceau. */
describe('RoomInstance — adminAction(\'spawnBot\') bots personnalisés (§9.3/§17 cahier_des_charges_admin.md)', () => {
  function makeBotInstance(): RoomInstance {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0 },
        challengers: {
          enabled: false,
          baselineCount: 0,
          minWithHumans: 0,
          maxWithHumans: 0,
          rampHumans: 1,
          massMultipliers: [],
        },
      },
    });
    const mod = createParametricMod(config);
    const resolver: ModResolver = () => ({ mod, mapSize: 2000, bots: config.bots });
    return new RoomInstance(
      { id: 'room-custom-bots', modId: 'test', tickRateHz: 20, maxPlayers: 30, resetSchedule: null },
      resolver,
    );
  }

  it('applique pseudo/masse/position personnalisés depuis une action admin spawnBot', () => {
    const instance = makeBotInstance();

    const result = instance.adminAction({
      kind: 'spawnBot',
      nickname: 'AdminBot',
      mass: 500000,
      x: 300,
      y: 400,
    });
    expect(result.ok).toBe(true);

    const player = instance.room.world.allPlayers().find((p) => p.nickname === 'AdminBot');
    expect(player).toBeDefined();
    const piece = instance.room.world.getPiecesByOwner(player!.id)[0];
    expect(piece?.mass).toBe(500000);
    expect(piece?.position).toEqual({ x: 300, y: 400 });

    instance.destroy();
  });

  it('conserve le comportement existant du bouton "Spawn bot" (sans options, régression)', () => {
    const instance = makeBotInstance();
    const before = instance.room.botManager?.activeBotCount ?? 0;

    const result = instance.adminAction({ kind: 'spawnBot' });
    expect(result.ok).toBe(true);
    expect(instance.room.botManager?.activeBotCount).toBe(before + 1);

    instance.destroy();
  });
});

/** Phase P4 (plan-implementation-admin.md §6) : drag & drop, marionnette, apparence à la volée,
 * spawn virus/vagues de bots, relais dash/eject du Blob Dieu. Mod factice avec un espion
 * `onPlayerInput` (au lieu du vrai mod paramétrique) pour les actions qui doivent seulement
 * vérifier CE QUI EST RELAYÉ à `mod.onPlayerInput`/`Room.handleInput`, indépendamment de toute
 * règle de jeu réelle — plus rapide et plus ciblé que de dérouler une vraie physique. */
describe("RoomInstance — adminAction P4 (contrôle & marionnette, cahier_des_charges_admin.md §9-§10)", () => {
  function makeInputSpyInstance(): {
    instance: RoomInstance;
    inputs: Array<{ playerId: PlayerId; input: PlayerInput }>;
  } {
    const inputs: Array<{ playerId: PlayerId; input: PlayerInput }> = [];
    const resolver: ModResolver = () => ({
      mod: {
        id: 'test-input-spy',
        onPlayerJoin: (world, id) => {
          world.spawnPiece(id, { x: 100, y: 100 }, 50);
        },
        onPlayerInput: (world, playerId, input) => {
          inputs.push({ playerId, input });
        },
      },
      mapSize: 2000,
    });
    const instance = new RoomInstance(
      { id: 'room-spy', modId: 'test', tickRateHz: 20, maxPlayers: 30, resetSchedule: null },
      resolver,
    );
    return { instance, inputs };
  }

  it("dragMove translate TOUS les morceaux du joueur par le même delta (§9.1) — offsets relatifs préservés", () => {
    const { instance } = makeInputSpyInstance();
    const playerId = '1';
    instance.room.addPlayer(playerId, 'Drag');
    // Un 2e morceau volontairement décalé (simule un joueur splitté) — `onPlayerJoin` du mod
    // factice n'en spawne qu'un seul à (100,100).
    instance.room.world.spawnPiece(playerId, { x: 140, y: 160 }, 30);

    const result = instance.adminAction({ kind: 'dragMove', playerId, x: 500, y: 500 });
    expect(result.ok).toBe(true);

    const pieces = instance.room.world.getPiecesByOwner(playerId);
    expect(pieces).toHaveLength(2);
    // Barycentre (masse 50 à (100,100), masse 30 à (140,160)) = (115, 122.5) avant translation ;
    // delta = (500-115, 500-122.5) appliqué identiquement aux deux morceaux.
    const big = pieces.find((p) => p.mass === 50)!;
    const small = pieces.find((p) => p.mass === 30)!;
    expect(small.position.x - big.position.x).toBeCloseTo(140 - 100, 5); // offset relatif inchangé
    expect(small.position.y - big.position.y).toBeCloseTo(160 - 100, 5);
    const totalMass = pieces.reduce((s, p) => s + p.mass, 0);
    const centerX = pieces.reduce((s, p) => s + p.position.x * p.mass, 0) / totalMass;
    const centerY = pieces.reduce((s, p) => s + p.position.y * p.mass, 0) / totalMass;
    expect(centerX).toBeCloseTo(500, 5);
    expect(centerY).toBeCloseTo(500, 5);

    instance.destroy();
  });

  it("dragMove renvoie false pour un joueur sans morceau", () => {
    const { instance } = makeInputSpyInstance();
    const result = instance.adminAction({ kind: 'dragMove', playerId: 'inconnu', x: 1, y: 1 });
    expect(result.ok).toBe(false);
    instance.destroy();
  });

  it("possess suspend l'input NORMAL (vrai client ou bot, même Room.handleInput) — seul possessInput fait autorité (§9.3)", () => {
    const { instance, inputs } = makeInputSpyInstance();
    const playerId = '1';
    instance.room.addPlayer(playerId, 'Marionnette');

    expect(instance.adminAction({ kind: 'possess', playerId }).ok).toBe(true);

    // Input "normal" (chemin emprunté par un vrai client WS, `RoomInstance.input`) — doit être
    // ignoré tant que le joueur est possédé.
    instance.input(playerId, { target: { x: 1, y: 1 }, intensity: 1, split: false });
    expect(inputs).toHaveLength(0);

    // possessInput contourne volontairement la suspension.
    const possessResult = instance.adminAction({
      kind: 'possessInput',
      playerId,
      x: 9,
      y: 9,
      intensity: 1,
      split: false,
      dash: true,
      eject: true,
    });
    expect(possessResult.ok).toBe(true);
    expect(inputs).toHaveLength(1);
    expect(inputs[0]).toEqual({
      playerId,
      input: { target: { x: 9, y: 9 }, intensity: 1, split: false, dash: true, eject: true },
    });

    // unpossess restaure l'input normal.
    expect(instance.adminAction({ kind: 'unpossess', playerId }).ok).toBe(true);
    instance.input(playerId, { target: { x: 2, y: 2 }, intensity: 1, split: false });
    expect(inputs).toHaveLength(2);

    instance.destroy();
  });

  it("possessInput est refusé (ok:false) si le joueur n'est pas actuellement possédé", () => {
    const { instance, inputs } = makeInputSpyInstance();
    const playerId = '1';
    instance.room.addPlayer(playerId, 'PasPossede');

    const result = instance.adminAction({
      kind: 'possessInput',
      playerId,
      x: 1,
      y: 1,
      intensity: 1,
      split: false,
    });
    expect(result.ok).toBe(false);
    expect(inputs).toHaveLength(0);

    instance.destroy();
  });

  it("possess sur un joueur inconnu renvoie false", () => {
    const { instance } = makeInputSpyInstance();
    expect(instance.adminAction({ kind: 'possess', playerId: 'inconnu' }).ok).toBe(false);
    instance.destroy();
  });

  it("godInput relaie dash/eject à Room.handleInput (§10.4, extension du Blob Dieu)", () => {
    const { instance, inputs } = makeInputSpyInstance();
    const godId = 'admin-god-1';
    expect(instance.adminAction({ kind: 'enableGodmode', playerId: godId, nickname: 'Dieu' }).ok).toBe(true);

    const result = instance.adminAction({
      kind: 'godInput',
      playerId: godId,
      x: 42,
      y: 43,
      intensity: 1,
      split: false,
      dash: true,
      eject: true,
    });
    expect(result.ok).toBe(true);

    const godInput = inputs.find((entry) => entry.playerId === godId);
    expect(godInput?.input).toEqual({
      target: { x: 42, y: 43 },
      intensity: 1,
      split: false,
      dash: true,
      eject: true,
    });

    instance.destroy();
  });

  it("setAppearance met à jour nickname/skin ET rediffuse via le même canal que onPlayerJoin (§9.4)", () => {
    const { instance } = makeInputSpyInstance();
    const playerId = '1';
    instance.room.addPlayer(playerId, 'AvantChangement');

    const joinEvents: Array<{ playerId: PlayerId; nickname: string; skin?: string }> = [];
    instance.onPlayerJoin((event) => joinEvents.push(event));

    const result = instance.adminAction({
      kind: 'setAppearance',
      playerId,
      nickname: 'ApresChangement',
      color: '#abcdef',
    });
    expect(result.ok).toBe(true);

    const player = instance.room.world.getPlayer(playerId);
    expect(player?.nickname).toBe('ApresChangement');
    expect(player?.skin).toBe('#abcdef');

    expect(joinEvents).toHaveLength(1);
    expect(joinEvents[0]).toEqual({ playerId, nickname: 'ApresChangement', skin: '#abcdef' });

    instance.destroy();
  });

  it("setAppearance renvoie false pour un joueur inconnu", () => {
    const { instance } = makeInputSpyInstance();
    const result = instance.adminAction({ kind: 'setAppearance', playerId: 'inconnu', nickname: 'X' });
    expect(result.ok).toBe(false);
    instance.destroy();
  });

  it('spawnVirus place un virus du type/masse/rayon attendus aux coordonnées données (§10.2)', () => {
    const { instance } = makeInputSpyInstance();
    const result = instance.adminAction({ kind: 'spawnVirus', x: 111, y: 222, virusType: 2 });
    expect(result.ok).toBe(true);

    const virus = instance.room.world.allEntities().find((e) => e.kind === 'virus');
    expect(virus).toBeDefined();
    expect(virus?.position).toEqual({ x: 111, y: 222 });
    expect(virus?.mass).toBe(300); // vType 2 (Rouge) : formule dédiée
    // Rayon = 150 (formule de base) rétréci de 10% d'aire (VIRUS_HITBOX_RADIUS_FACTOR, voir
    // mods/parametric/index.ts, dupliqué ici — même raisonnement que Room.spawnVirus).
    expect(virus?.radius).toBeCloseTo(150 * Math.sqrt(0.9), 5);
    expect(virus?.virusId).toBe(2);

    instance.destroy();
  });

  it('spawnVirus type 1/3 utilise la formule générique (masse 200, rayon 100)', () => {
    const { instance } = makeInputSpyInstance();
    instance.adminAction({ kind: 'spawnVirus', x: 1, y: 1, virusType: 1 });
    const virus = instance.room.world.allEntities().find((e) => e.kind === 'virus');
    expect(virus?.mass).toBe(200);
    expect(virus?.radius).toBeCloseTo(100 * Math.sqrt(0.9), 5);
    instance.destroy();
  });
});

describe("RoomInstance — adminAction('spawnBots') vagues de bots (§10.3 cahier_des_charges_admin.md)", () => {
  function makeBotInstance(maxPlayers = 100): RoomInstance {
    const config = testConfig({
      bots: {
        enabled: true,
        targetRatio: 0,
        updateFrequencyHz: 2,
        proportions: { fuis: 0, neutre: 100, agressif: 0 },
        challengers: {
          enabled: false,
          baselineCount: 0,
          minWithHumans: 0,
          maxWithHumans: 0,
          rampHumans: 1,
          massMultipliers: [],
        },
      },
    });
    const mod = createParametricMod(config);
    const resolver: ModResolver = () => ({ mod, mapSize: 4000, bots: config.bots });
    return new RoomInstance(
      { id: 'room-bot-waves', modId: 'test', tickRateHz: 20, maxPlayers, resetSchedule: null },
      resolver,
    );
  }

  it('spawn N bots en une action, personnalité aléatoire par bot, masse partagée appliquée à chacun (additif, ne touche pas spawnBot)', () => {
    const instance = makeBotInstance();
    const before = instance.room.botManager?.activeBotCount ?? 0;

    const result = instance.adminAction({ kind: 'spawnBots', count: 5, mass: 1234 });
    expect(result.ok).toBe(true);
    expect(instance.room.botManager?.activeBotCount).toBe(before + 5);

    const bots = instance.room.world.allPlayers().filter((p) => instance.room.botManager?.isBot(p.id));
    expect(bots).toHaveLength(5);
    for (const bot of bots) {
      const piece = instance.room.world.getPiecesByOwner(bot.id)[0];
      expect(piece?.mass).toBe(1234);
    }

    instance.destroy();
  });

  it('borne count à [1,50] côté serveur, pas seulement côté UI (§10.3 : "1-50")', () => {
    const instance = makeBotInstance();
    const before = instance.room.botManager?.activeBotCount ?? 0;

    instance.adminAction({ kind: 'spawnBots', count: 999 });
    expect(instance.room.botManager?.activeBotCount).toBe(before + 50);

    instance.destroy();
  });

  it("renvoie false si les bots sont désactivés pour ce salon", () => {
    const resolver: ModResolver = () => ({ mod: { id: 'test' }, mapSize: 2000 });
    const instance = new RoomInstance(
      { id: 'room-no-bots', modId: 'test', tickRateHz: 20, maxPlayers: 30, resetSchedule: null },
      resolver,
    );
    const result = instance.adminAction({ kind: 'spawnBots', count: 3 });
    expect(result.ok).toBe(false);
    instance.destroy();
  });
});
