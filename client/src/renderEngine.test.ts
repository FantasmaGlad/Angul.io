import type { EntitySnapshot } from '@angulio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RenderEngine } from './renderEngine.js';

function entity(id: string, x: number): EntitySnapshot {
  return { i: id, k: 'c', x, y: 0, r: 10, m: 50, p: 'self' };
}

/** La ligne de temps de lecture (`SnapshotItem.serverTimeMs`) est dérivée du NUMÉRO DE TICK, ancré
 * une seule fois sur l'horloge client au premier snapshot reçu — jamais de l'heure d'arrivée de
 * chaque message individuel. Cette suite vérifie que ça tient sa promesse : une rafale réseau
 * (plusieurs `state` reçus coup sur coup après un micro-décrochage, mesuré en production —
 * ~50ms de RTT avec ~30ms de gigue, voir plan_performance_reseau.md) ne doit ni téléporter une
 * entité (régression corrigée précédemment) ni geler la lecture plus que nécessaire (nouveau
 * comportement : la rafale redevient une simple interpolation fluide à travers le temps simulé
 * réellement écoulé, pas un saut). */
describe('RenderEngine — ligne de temps ancrée sur le numéro de tick', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interpole en douceur à travers une rafale au lieu de sauter directement à la dernière valeur', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30); // ancre : tick 1 == horloge client 0
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('1', 100)], 2, 30); // tick normal, +33.3ms simulés
    // Rafale : le tick 5 (3 ticks plus tard, ~100ms de temps simulé) arrive seulement 2ms après
    // le tick 2 en temps d'ARRIVÉE client — mais sa ligne de temps interne reste correcte.
    nowSpy.mockReturnValueOnce(35);
    engine.pushSnapshot([entity('1', 500)], 5, 30);

    // Rendu peu après l'arrivée de la rafale (buffer d'interpolation) : encore tôt dans
    // l'intervalle simulé tick2→tick5, donc proche de x=100, pas un saut à x=500.
    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);

    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThan(100);
    expect(own!.x).toBeLessThan(350); // loin d'un télétransport vers 500
  });

  it("n'est pas perturbée par l'heure d'arrivée : deux mêmes tick/position donnent le même rendu quelle que soit la gigue d'arrivée", () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(1000); // horloge client arbitraire au moment de l'ancrage
    engine.pushSnapshot([entity('1', 0)], 10, 30);
    nowSpy.mockReturnValueOnce(1200); // arrivée tardive/atypique, sans rapport avec le tick réel
    engine.pushSnapshot([entity('1', 100)], 11, 30);

    // Le rendu ne dépend que de l'écart entre l'ancre et `now` — pas de l'heure d'arrivée de la
    // 2e snapshot (1200 dans ce test), qui n'intervient jamais dans le calcul de `serverTimeMs`.
    nowSpy.mockReturnValueOnce(1000 + 100 + 16); // ancre + intervalDelay(100) + un peu
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);
    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThanOrEqual(0);
    expect(own!.x).toBeLessThanOrEqual(100);
  });

  it('extrapole au-delà du dernier tick connu lors d’un vrai décrochage, borné par le plafond', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('1', 100)], 2, 30);

    // Bien après le dernier tick connu (buffer à sec) — mais dans la fenêtre d'extrapolation.
    nowSpy.mockReturnValueOnce(200);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', true);
    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
    expect(own!.x).toBeGreaterThan(100);
  });

  it('comptabilise les ticks manqués sans être perturbé par la ligne de temps ancrée', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(100);
    engine.pushSnapshot([entity('1', 100)], 4, 30); // 2 ticks manqués (2 et 3)

    expect(engine.missedTickCount).toBe(2);
  });
});

/** Le culling de viewport a été déplacé EN AMONT de l'interpolation/du lissage (voir le
 * commentaire de `getInterpolatedEntities`, `fromEntities`/`toEntities`) — cette suite vérifie
 * que le résultat visible reste identique à l'ancien pipeline (cull APRÈS), pas seulement que la
 * fonction ne plante pas : une entité dans le viewport doit toujours être interpolée/lissée
 * normalement, une entité loin hors du viewport doit toujours disparaître, et les propres
 * morceaux du joueur doivent toujours être conservés quelle que soit leur position (même règle
 * que `cullEntitiesForViewport`, render.ts). */
/** Contrairement à `entity()` ci-dessus (toujours `p: 'self'`), une entité qui n'appartient PAS
 * au joueur — nécessaire pour vérifier qu'une entité distante lointaine est bien cullée, sans que
 * la règle "toujours garder ses propres morceaux" (cullEntitiesForViewport, render.ts) ne
 * l'exempte à tort. */
function otherEntity(id: string, x: number): EntitySnapshot {
  return { i: id, k: 'c', x, y: 0, r: 10, m: 50, p: 'someone-else' };
}

function food(id: string, x: number): EntitySnapshot {
  return { i: id, k: 'f', x, y: 0, r: 5, m: 1 };
}

describe('RenderEngine — culling déplacé avant interpolation/lissage (joueur, pas spectateur)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('interpole normalement une entité DANS le viewport', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('1', 0)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('1', 100)], 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', false);

    const own = result.find((e) => e.i === '1');
    expect(own).toBeDefined();
  });

  it('exclut une entité loin hors du viewport (culling toujours effectif malgré le réordonnancement)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    // Très loin du centre caméra (0,0) avec un viewport de 2000x2000 à l'échelle 1 — bien
    // au-delà de la marge de culling (CULL_MARGIN_WORLD_PX, render.ts).
    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([otherEntity('far', 100_000)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([otherEntity('far', 100_000)], 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', false);

    expect(result.find((e) => e.i === 'far')).toBeUndefined();
  });

  it('conserve toujours les propres morceaux du joueur, même loin hors du viewport', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('self', 100_000)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('self', 100_000)], 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, 'self', false);

    expect(result.find((e) => e.i === 'self')).toBeDefined();
  });
});

/** Mode spectateur (fond animé de l'accueil, voir SpectatorBackground.tsx) : les créatures
 * (joueurs/bots, 'k' === 'c') doivent TOUJOURS être toutes affichées, seule la nourriture ('f')
 * est sous-échantillonnée (retour utilisateur : le lobby ne doit jamais sacrifier de bot, une
 * pastille de nourriture individuelle est de toute façon à peine visible sur un fond dézoomé). */
describe('RenderEngine — sous-échantillonnage spectateur type-aware (nourriture uniquement)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('conserve TOUTES les créatures en mode spectateur, même en grand nombre', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    const creatures = Array.from({ length: 500 }, (_, i) => otherEntity(`bot-${i}`, 0));

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot(creatures, 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot(creatures, 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, undefined, true);

    expect(result).toHaveLength(500);
  });

  it("ne conserve qu'environ 10% de la nourriture en mode spectateur", () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    // Id purement numériques et séquentiels ("1", "2", "3"...), PAS "food-0"/"food-1"... — c'est
    // exactement la forme des vrais id serveur (`String(nextEntityId++)`, voir World.spawnEntity) :
    // un simple hash polynomial (essayé d'abord pour `hashEntityId`, voir son commentaire) reste
    // quasi-monotone sur des chaînes aussi courtes/régulières, donc PAS dispersé du tout par rapport
    // au seuil de coupure — un préfixe alphabétique masquait ce problème dans une version antérieure
    // de ce test, en apportant à tort assez de variation de caractères pour bien disperser malgré
    // le mauvais hash.
    const pellets = Array.from({ length: 2000 }, (_, i) => food(String(i + 1), 0));

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot(pellets, 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot(pellets, 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const result = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, undefined, true);

    // Hash-based, pas un tirage exact à 10.00% — large tolérance pour éviter tout flakiness.
    expect(result.length).toBeGreaterThan(100);
    expect(result.length).toBeLessThan(300);
  });

  it('sous-échantillonne la nourriture de façon déterministe (même résultat à chaque appel pour le même snapshot)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    const pellets = Array.from({ length: 200 }, (_, i) => food(`food-${i}`, 0));

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot(pellets, 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot(pellets, 2, 30);

    nowSpy.mockReturnValueOnce(135);
    const first = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, undefined, true);
    nowSpy.mockReturnValueOnce(136);
    const second = engine.getInterpolatedEntities(16, { x: 0, y: 0, scale: 1 }, 2000, 2000, undefined, true);

    expect(first.map((e) => e.i).sort()).toEqual(second.map((e) => e.i).sort());
  });
});

/** Delta nourriture (cahier_des_charges_perf_reseau_grande_carte.md §3.5) : le serveur ne
 * réenvoie une pastille ('f') que si elle est nouvellement entrée dans l'intérêt du joueur — ce
 * qui suppose que le client ACCUMULE la nourriture reçue plutôt que de ne garder que le dernier
 * tick brut (contrairement à `interpolateEntities`, qui lui reste volontairement inchangé, voir
 * son commentaire). `pushSnapshot`'s 4e paramètre (`entitiesFull`) pilote ce comportement. */
describe('RenderEngine — accumulation persistante de la nourriture (delta réseau)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('conserve une pastille omise sur un tick delta (entitiesFull=false)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30, true);
    nowSpy.mockReturnValueOnce(33);
    // Tick delta : la pastille f1 n'a pas bougé, le serveur ne la réenvoie pas — seul le morceau
    // du joueur est présent (toujours envoyé en entier, voir roomInstance.ts).
    engine.pushSnapshot([entity('c1', 10)], 2, 30, false);

    const last = engine.snapshotQueue[engine.snapshotQueue.length - 1]!;
    expect(last.entities.some((e) => e.i === 'f1')).toBe(true);
    expect(last.entities.some((e) => e.i === 'c1')).toBe(true);
  });

  it('purge une pastille absente d’un tick de resynchronisation complète (entitiesFull=true)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30, true);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('c1', 10)], 2, 30, false); // delta : f1 toujours implicite

    // Resynchro complète : f1 a été mangée entre-temps (par un autre joueur) — absente de la
    // liste complète, doit disparaître plutôt que de rester affichée indéfiniment.
    nowSpy.mockReturnValueOnce(66);
    engine.pushSnapshot([entity('c1', 20)], 3, 30, true);

    const last = engine.snapshotQueue[engine.snapshotQueue.length - 1]!;
    expect(last.entities.some((e) => e.i === 'f1')).toBe(false);
  });

  it('fusionne une nouvelle pastille delta sans effacer celles déjà connues', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30, true);
    nowSpy.mockReturnValueOnce(33);
    // Delta : une seconde pastille entre dans l'intérêt, f1 reste implicite.
    engine.pushSnapshot([entity('c1', 10), food('f2', 80)], 2, 30, false);

    const last = engine.snapshotQueue[engine.snapshotQueue.length - 1]!;
    expect(last.entities.some((e) => e.i === 'f1')).toBe(true);
    expect(last.entities.some((e) => e.i === 'f2')).toBe(true);
  });

  it('reset() vide la nourriture accumulée (nouvelle vie/reconnexion)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30, true);
    engine.reset();
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('c1', 0)], 1, 30, false);

    const last = engine.snapshotQueue[engine.snapshotQueue.length - 1]!;
    expect(last.entities.some((e) => e.i === 'f1')).toBe(false);
  });

  it('sans 4e paramètre (spectateur historique), se comporte comme entitiesFull=true (remplace, ne fusionne pas)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30);
    nowSpy.mockReturnValueOnce(33);
    engine.pushSnapshot([entity('c1', 10)], 2, 30); // pas de 4e argument

    const last = engine.snapshotQueue[engine.snapshotQueue.length - 1]!;
    expect(last.entities.some((e) => e.i === 'f1')).toBe(false);
  });
});

/** `forgetFood` renvoie les ids RÉELLEMENT retirés — contrat dont dépend le crédit de masse de la
 * prédiction locale (voir GameView.tsx / `LocalPrediction.addPredictedMass`) : une même pastille
 * est signalée mangée à chaque frame de rendu tant que les snapshots déjà empilés la contiennent
 * encore, et la créditer à chaque fois gonflerait la masse prédite d'un ordre de grandeur. */
describe('RenderEngine — forgetFood renvoie les ids réellement oubliés (dédoublonnage du crédit de masse)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('renvoie les ids connus au premier appel, puis plus rien aux appels suivants pour les mêmes ids', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50), food('f2', 60)], 1, 30, true);

    expect(engine.forgetFood(['f1', 'f2']).sort()).toEqual(['f1', 'f2']);
    expect(engine.forgetFood(['f1', 'f2'])).toEqual([]);
  });

  it('ignore un id inconnu (pastille d’un autre joueur, jamais reçue par ce client)', () => {
    const engine = new RenderEngine();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    engine.pushSnapshot([entity('c1', 0), food('f1', 50)], 1, 30, true);

    expect(engine.forgetFood(['inconnue', 'f1'])).toEqual(['f1']);
  });
});
