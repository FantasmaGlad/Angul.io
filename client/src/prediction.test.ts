import type { EntitySnapshot, MovementConfig } from '@angulio/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalPrediction } from './prediction.js';

/** Accélération quasi infinie : la vitesse cible est atteinte en un seul pas, ce qui rend la
 * position résultante de chaque `step` triviale à calculer à la main (déplacement constant de
 * v0*dt par pas tant que la cible reste loin) — simplifie les assertions sans perdre en fidélité
 * au vrai modèle (mêmes formules que shared/src/movement.ts). */
const MOVEMENT: MovementConfig = {
  v0: 100,
  speedMultiplier: 1,
  speedMassExponent: 0,
  velocityFloor: 0,
  accelerationBase: 1e9,
  accelerationMassExponent: 0,
  startMass: 50,
  mergeOverlapMinFraction: 0.3,
};

function ownSnapshot(id: string, x: number, y: number, mass = 50): EntitySnapshot {
  return { i: id, k: 'c', x, y, r: 10, m: mass, p: 'self' };
}

/** Régression : l'ancienne réconciliation (blend/snap direct entre position prédite courante et
 * position autoritaire) tirait systématiquement le blob en arrière à chaque `state` reçu, dès que
 * la latence réseau devenait significative — un "rollback" visible signalé après déploiement en
 * production (RTT ~50ms mesuré, voir plan_performance_reseau.md). La réconciliation par rejeu
 * élimine ce biais : un écart n'est corrigé que s'il reflète un vrai désaccord avec le serveur, pas
 * simplement l'avance normale de la prédiction sur un état forcément un peu plus vieux. */
describe('LocalPrediction — réconciliation par rejeu', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ne tire pas la position en arrière quand l'autoritaire confirme la prédiction, latence compensée", () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    // Amorce (aucun historique à rejouer).
    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    // Trois pas locaux, chacun avance de 10 unités (v=100px/s à dt=0.1s), aux temps client 100/200/300.
    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // `state` reçu à t=300, latence aller simple estimée à 100ms : reflète donc l'état serveur à
    // t≈200 — et le serveur, ayant appliqué le même modèle sur les mêmes inputs, est bien à
    // (20,0), exactement ce que le client avait déjà prédit à ce moment-là.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 20, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // Toujours (30,0) : le rejeu retrouve exactement la position déjà prédite au lieu de la tirer
    // vers l'ancienne valeur autoritaire (ce que faisait l'ancien blend/snap).
    expect(entity!.x).toBeCloseTo(30, 5);
    expect(entity!.y).toBeCloseTo(0, 5);
  });

  it('absorbe un petit désaccord serveur non prédit (répulsion, croissance...) sans discontinuité immédiate', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // Cette fois, le serveur était réellement à (15,0) à t≈200 (ex. répulsion contre un bot) —
    // 5 unités de moins que ce que le client avait prédit. Rejouer le pas suivant (+10) par-dessus
    // cette vérité donne 25 (résidu de -5 par rapport aux 30 déjà prédits) — un petit résidu de ce
    // type (répulsion routinière, très fréquente sur une carte peuplée de bots) est absorbé dans
    // `visualOffset` (voir le commentaire d'en-tête) plutôt qu'appliqué d'un coup à la position
    // affichée : à l'instant même de la réconciliation, AUCUN saut visible ne doit apparaître.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 15, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // Toujours 30 à l'instant T : la position SIMULÉE a bien sauté à 25 (voir le test suivant),
    // mais l'affichage reste continu — le rattrapage se fera progressivement via `step()`.
    expect(entity!.x).toBeCloseTo(30, 5);
  });

  it('résorbe le correctif visuel à vitesse plafonnée (pas d’un coup, pas instantané)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);
    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 15, 0)], 'self', MOVEMENT, 100);
    // Position simulée désormais à 25, correctif visuel de +5 en attente (voir test précédent).

    // Cible = position simulée courante (25) : zone morte, la simulation n'avance plus — isole la
    // résorption du correctif visuel de tout mouvement. dt = exactement UN pas fixe interne
    // (1/240s, voir FIXED_STEP_SECONDS) : à VISUAL_CORRECTION_SPEED_PX_PER_S=600, le pas maximal
    // par sous-pas est de 600/240 = 2.5px — bien en-deçà des 5px de correctif restant.
    nowSpy.mockReturnValueOnce(301);
    prediction.step(1 / 240, { x: 25, y: 0 }, 1, MOVEMENT);

    const [midway] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // 25 + (5 - 2.5) = 27.5 : ni un saut instantané à 25, ni le correctif intact à 30.
    expect(midway!.x).toBeCloseTo(27.5, 5);

    // Un second pas fixe épuise exactement le reste du correctif (2.5px restants, pas max 2.5px).
    nowSpy.mockReturnValueOnce(302);
    prediction.step(1 / 240, { x: 25, y: 0 }, 1, MOVEMENT);

    const [resolved] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    expect(resolved!.x).toBeCloseTo(25, 5);
  });

  it('ignore un écart résiduel infime (bruit d’intégration dt variable/fixe, pas un vrai désaccord)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // Rejouer le dernier pas (+10) par-dessus cette vérité (21) donne 31 — un résidu de 1 unité
    // par rapport aux 30 déjà prédits, sous RECONCILE_IGNORE_THRESHOLD_PX (1.5) : c'est le genre
    // d'écart minuscule et permanent produit par deux intégrations légèrement différentes de la
    // même formule (dt variable côté client, dt fixe côté serveur), pas un vrai désaccord — il ne
    // doit provoquer AUCUNE correction, pour ne pas créer un tremblement continu.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', 21, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    expect(entity!.x).toBeCloseTo(30, 5);
  });

  it('snap immédiatement sur un vrai désaccord massif (téléportation, mort/respawn, nouveau morceau)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    const target = { x: 1000, y: 0 };

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(200);
    prediction.step(0.1, target, 1, MOVEMENT);
    nowSpy.mockReturnValueOnce(300);
    prediction.step(0.1, target, 1, MOVEMENT);

    // Écart de 200 unités (bien au-delà de RECONCILE_SNAP_THRESHOLD_PX = 120) : un vrai
    // désaccord discontinu, pas un nudge de répulsion — corrigé intégralement, sans lissage.
    nowSpy.mockReturnValueOnce(300);
    prediction.reconcile([ownSnapshot('1', -200, 0)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // -200 + 10 (rejeu du dernier pas) = -190, sans atténuation.
    expect(entity!.x).toBeCloseTo(-190, 5);
  });

  it("n'applique aucune force dans la zone morte autour de la cible (évite le tremblotement)", () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');

    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    // Cible à 1px (< TARGET_DEAD_ZONE_PX) : intensité effective nulle malgré intensity=1, donc la
    // vitesse (nulle au départ) ne bouge pas — pas de direction instable calculée sur ce vecteur
    // quasi nul.
    nowSpy.mockReturnValueOnce(16);
    prediction.step(0.016, { x: 1, y: 0 }, 1, MOVEMENT);

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    expect(entity!.x).toBeCloseTo(0, 6);
    expect(entity!.y).toBeCloseTo(0, 6);
  });

  it('amorce directement un morceau inconnu (premier state de la vie, ou apparu ce tick)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(1000);

    prediction.reconcile([ownSnapshot('42', 5, 7)], 'self', MOVEMENT, 100);

    const [entity] = prediction.applyTo([ownSnapshot('42', 999, 999)], 'self');
    expect(entity).toEqual(expect.objectContaining({ x: 5, y: 7 }));
  });

  it('regroupe le rejeu par blocs de la taille du tick serveur (élimine le biais de sur-intégration d’une rampe)', () => {
    // Accélération FINIE (contrairement à MOVEMENT, quasi infinie) : exerce une vraie rampe de
    // vélocité, le seul cas où l'intégration fine (1/240s) diverge numériquement de l'intégration
    // par tick serveur (1/30s) — voir le commentaire de `chunkHistoryForReplay`.
    const RAMP_MOVEMENT: MovementConfig = {
      v0: 300,
      speedMultiplier: 1,
      speedMassExponent: 0,
      velocityFloor: 0,
      accelerationBase: 4500,
      accelerationMassExponent: 0,
      startMass: 50,
  mergeOverlapMinFraction: 0.3,
    };
    const SERVER_TICK_RATE_HZ = 30;
    const FAR_TARGET = { x: 1000, y: 0 };

    // Amorce le morceau au repos puis rejoue exactement 8 sous-pas fins de 1/240s — soit
    // exactement UN tick serveur à 30Hz (240/30=8). Vélocité 0->150 (PAS encore saturée, la
    // cible est 300), position finale 2.8125 — calculé à la main (rampe clampée par
    // `moveToward`, voir shared/src/vector.ts) : identique pour les deux variantes ci-dessous,
    // c'est `beforeReconcile` (la prédiction déjà en direct avant toute réconciliation).
    function buildRampedPrediction(): LocalPrediction {
      const prediction = new LocalPrediction();
      const nowSpy = vi.spyOn(performance, 'now');
      nowSpy.mockReturnValueOnce(0);
      prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', RAMP_MOVEMENT, 0);
      for (let i = 0; i < 8; i++) {
        nowSpy.mockReturnValueOnce((i + 1) * (1000 / 240));
        prediction.step(1 / 240, FAR_TARGET, 1, RAMP_MOVEMENT);
      }
      return prediction;
    }

    // Ancre autoritaire arbitraire (isolée de toute estimation de latence réaliste — seul le
    // regroupement du rejeu est sous test ici) ; `estimatedLatencyMs` place `sinceMs` avant tous
    // les échantillons (rejoue les 8 en entier) dans les deux cas. Décalée à 15 (pas 5) : le résidu
    // qui en résulte doit dépasser nettement le seuil dynamique d'ignorance de `reconcile()`
    // (désormais aussi dimensionné sur la tolérance à la gigue réseau, voir
    // RECONCILE_JITTER_TOLERANCE_TICKS dans prediction.ts) pour que ce test continue à observer le
    // lissage (`visualOffset`) plutôt qu'un résidu ignoré comme du bruit.
    const authoritative = ownSnapshot('1', 15, 0);
    const nowAtReconcileMs = 1000 / 30;
    const hugeLatencyMs = nowAtReconcileMs + 1;

    // Sans regroupement (comportement pré-correctif, `serverTickRateHz` omis) : rejeu des 8
    // échantillons fins un par un, en partant de la vélocité DÉJÀ ramenée à 150 par le direct —
    // diverge de ce qu'un pas serveur unique de 1/30s aurait produit à partir du même point.
    const unchunked = buildRampedPrediction();
    vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcileMs);
    unchunked.reconcile([authoritative], 'self', RAMP_MOVEMENT, hugeLatencyMs);

    // Avec regroupement (`serverTickRateHz` fourni) : un seul bloc de dt=1/30s — mathématiquement
    // identique à un pas serveur unique à partir du même point de départ.
    const chunked = buildRampedPrediction();
    vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcileMs);
    chunked.reconcile([authoritative], 'self', RAMP_MOVEMENT, hugeLatencyMs, SERVER_TICK_RATE_HZ);

    // Les deux résidus dépassent le seuil dynamique d'ignorance de `reconcile()` (voir le
    // commentaire sur `authoritative` ci-dessus) mais restent dans la bande lissée
    // (< RECONCILE_SNAP_THRESHOLD_PX = 120) : `applyTo` juste après reconcile affiche encore
    // `beforeReconcile` des deux côtés (le saut est absorbé dans `visualOffset`, pas visible
    // instantanément). On avance ensuite de 16 sous-pas fins supplémentaires avec la MÊME cible
    // lointaine (vélocité déjà saturée à 300 des deux côtés depuis le rejeu : `moveToward` ne fait
    // plus rien, la position avance donc de EXACTEMENT 300/240=1.25 par sous-pas, sans interférence
    // de la zone morte) — largement assez pour résorber entièrement le correctif visuel résiduel
    // des deux côtés (20px/2.5px-par-sous-pas et 22.1875px/2.5px-par-sous-pas, soit 8 et ~9
    // sous-pas), et lire ainsi la position SIMULÉE (post-rejeu) une fois `visualOffset` revenu à
    // {0,0}.
    for (let i = 0; i < 16; i++) {
      vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcileMs + (i + 1) * (1000 / 240));
      unchunked.step(1 / 240, FAR_TARGET, 1, RAMP_MOVEMENT);
      chunked.step(1 / 240, FAR_TARGET, 1, RAMP_MOVEMENT);
    }

    const [unchunkedResult] = unchunked.applyTo([ownSnapshot('1', 999, 999)], 'self');
    const [chunkedResult] = chunked.applyTo([ownSnapshot('1', 999, 999)], 'self');

    // Rejeu fin : 22.8125 (position simulée post-rejeu) + 16×1.25 = 42.8125.
    expect(unchunkedResult!.x).toBeCloseTo(42.8125, 5);
    // Rejeu par bloc de tick serveur : 25 (== un seul pas serveur de dt=1/30s) + 16×1.25 = 45.
    expect(chunkedResult!.x).toBeCloseTo(45, 5);
    // Écart mesurable (>2px) entre les deux stratégies de rejeu pour la MÊME rampe — c'est
    // précisément le biais que corrige le regroupement.
    expect(chunkedResult!.x - unchunkedResult!.x).toBeGreaterThan(2);
  });

  it('retire un morceau absent du dernier state (fusion/mort/absorption)', () => {
    const prediction = new LocalPrediction();
    const nowSpy = vi.spyOn(performance, 'now');
    nowSpy.mockReturnValueOnce(0);
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', MOVEMENT, 0);

    nowSpy.mockReturnValueOnce(100);
    prediction.reconcile([], 'self', MOVEMENT, 0);

    const result = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // Plus de morceau prédit pour '1' : l'entité passe telle quelle (pipeline serveur habituel).
    expect(result[0]).toEqual(ownSnapshot('1', 999, 999));
  });
});

/** Accélération FINIE, choisie assez faible pour ne JAMAIS saturer (`moveToward` plafonné) sur
 * toute la durée des deux tests ci-dessous (vélocité max atteinte ~244px/s, cible v0=300px/s) —
 * isole strictement l'effet du rembobinage de vélocité de `reconcile()`, sans interférence d'un
 * plafonnement de rampe. */
const REWIND_MOVEMENT: MovementConfig = {
  v0: 300,
  speedMultiplier: 1,
  speedMassExponent: 0,
  velocityFloor: 0,
  accelerationBase: 2250,
  accelerationMassExponent: 0,
  startMass: 50,
  mergeOverlapMinFraction: 0.3,
};
const REWIND_STEP_MS = 1000 / 240;
const REWIND_FAR_TARGET = { x: 1000, y: 0 };

/** Amorce un morceau au repos puis rejoue 31 sous-pas fins CONTINUS (~3.875 ticks serveur à 30Hz,
 * jamais interrompus par un `reconcile()`) — point de départ commun aux deux tests ci-dessous
 * (fix_vitesse_reseau.md), avant que leur unique appel à `reconcile()` sous test ne diverge selon
 * que `authoritativeVelocities` est fourni ou non. 31 (pas 16) : le résidu de rejeu introduit par
 * le double comptage (voir le test de régression ci-dessous) doit dépasser nettement le seuil
 * dynamique d'ignorance de `reconcile()` — désormais dimensionné aussi sur la tolérance à la
 * gigue réseau (`RECONCILE_JITTER_TOLERANCE_TICKS`, voir prediction.ts), bien plus large que
 * l'ancien plafond fixe (3px) pour lequel une fenêtre de 16 sous-pas suffisait.
 *
 * Piège volontairement évité ici (voir fix_vitesse_reseau.md, "Piège à éviter en écrivant les
 * tests") : les 31 sous-pas sont RÉELLEMENT rejoués en direct via `step()`, jamais simulés "à la
 * main" par un autre chemin — sinon `predicted.velocity` ne refléterait pas fidèlement ce que
 * `step()` a réellement accumulé, et le test mesurerait autre chose que le vrai bug.
 *
 * Après les 31 sous-pas : vélocité 0->290.625px/s (rampe clampée par `moveToward`, accélération
 * 2250px/s² constante, JAMAIS saturée — plafond v0=300px/s). Les deux tests ci-dessous rejouent
 * la fenêtre ENTIÈRE (ancre autoritaire au repos, t=0) plutôt qu'une simple fin de fenêtre : la
 * vélocité au repos (0) élimine tout calcul intermédiaire, l'ancre reste triviale à vérifier à la
 * main. */
function buildPreReplayWindowPrediction(): LocalPrediction {
  const prediction = new LocalPrediction();
  const nowSpy = vi.spyOn(performance, 'now');
  nowSpy.mockReturnValueOnce(0);
  prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', REWIND_MOVEMENT, 0);
  for (let i = 0; i < 31; i++) {
    nowSpy.mockReturnValueOnce((i + 1) * REWIND_STEP_MS);
    prediction.step(1 / 240, REWIND_FAR_TARGET, 1, REWIND_MOVEMENT);
  }
  return prediction;
}

describe('LocalPrediction — rembobinage de la vélocité avant rejeu (fix_vitesse_reseau.md)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('avec `authoritativeVelocities` fourni : résidu de rejeu négligeable, aucune erreur mesurable introduite', () => {
    const prediction = buildPreReplayWindowPrediction();

    // Fenêtre de rejeu = la fenêtre ENTIÈRE (31 sous-pas) : ancre autoritaire au repos, `sinceMs`
    // placé juste après t=0 (jamais exactement 0, pour ne jamais dépendre d'une égalité flottante
    // exacte sur le filtre strict `sample.atMs > sinceMs` de `reconcile()`).
    const nowAtReconcile = 31 * REWIND_STEP_MS;
    const sinceCutoff = 0.5 * REWIND_STEP_MS;
    const estimatedLatencyMs = nowAtReconcile - sinceCutoff;

    vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcile);
    // Position ET vélocité autoritaires fournies au MÊME instant connu (t=0, au repos) —
    // exactement la recette de fix_vitesse_reseau.md ("Piège à éviter") : sans la vélocité, ce
    // test mesurerait l'ANCIEN bug, pas le correctif.
    prediction.reconcile(
      [ownSnapshot('1', 0, 0)],
      'self',
      REWIND_MOVEMENT,
      estimatedLatencyMs,
      30, // serverTickRateHz : regroupe les 31 sous-pas rejoués en blocs de tick (chunkHistoryForReplay)
      new Map([['1', { x: 0, y: 0 }]]),
    );

    // Avance encore de 10 sous-pas fins (cible inchangée, toujours loin) pour laisser le correctif
    // visuel se résorber ENTIÈREMENT (VISUAL_CORRECTION_SPEED_PX_PER_S : 2.5px max par sous-pas,
    // donc 25px de capacité sur 10 sous-pas, largement au-dessus du résidu de 4.1015625 ci-dessous)
    // — seul moyen d'observer la position SIMULÉE réelle via `applyTo()`, qui masquerait sinon
    // instantanément tout écart derrière `visualOffset` (voir le test "absorbe un petit désaccord"
    // plus haut : AUCUN saut n'est jamais visible à l'instant même de la réconciliation).
    for (let i = 0; i < 10; i++) {
      vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcile + (i + 1) * REWIND_STEP_MS);
      prediction.step(1 / 240, REWIND_FAR_TARGET, 1, REWIND_MOVEMENT);
    }

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // 31.875 : EXACTEMENT la position qu'une simulation locale continue (SANS AUCUNE
    // réconciliation) aurait atteinte après le même temps total écoulé (41 sous-pas depuis le
    // repos) — la vélocité rembobinée élimine tout double comptage ; le résidu de rejeu restant
    // (4.1015625, biais de granularité fine/grossière sur une rampe qui n'a pas fini de saturer,
    // voir `chunkHistoryForReplay`) tombe sous le seuil dynamique d'ignorance de `reconcile()` et
    // est ignoré : `reconcile()` n'introduit ici aucune erreur mesurable.
    expect(entity!.x).toBeCloseTo(31.875, 5);
  });

  it("SANS `authoritativeVelocities` (paramètre omis) : reproduit l'ancien double comptage — régression", () => {
    const prediction = buildPreReplayWindowPrediction();
    const nowAtReconcile = 31 * REWIND_STEP_MS;
    const sinceCutoff = 0.5 * REWIND_STEP_MS;
    const estimatedLatencyMs = nowAtReconcile - sinceCutoff;

    vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcile);
    // Même position autoritaire, même fenêtre de rejeu, même `serverTickRateHz` que le test
    // précédent — seul `authoritativeVelocities` est omis (comportement pré-correctif) : isole
    // strictement son effet.
    prediction.reconcile([ownSnapshot('1', 0, 0)], 'self', REWIND_MOVEMENT, estimatedLatencyMs, 30);

    for (let i = 0; i < 10; i++) {
      vi.spyOn(performance, 'now').mockReturnValueOnce(nowAtReconcile + (i + 1) * REWIND_STEP_MS);
      prediction.step(1 / 240, REWIND_FAR_TARGET, 1, REWIND_MOVEMENT);
    }

    const [entity] = prediction.applyTo([ownSnapshot('1', 999, 999)], 'self');
    // 51.25, PAS 31.875 (voir le test précédent) : le rejeu est reparti de la vélocité DÉJÀ
    // avancée en direct par `step()` (290.625px/s, incluant déjà l'accélération de LA FENÊTRE
    // qu'on est en train de rejouer) au lieu de la vélocité autoritaire à `sinceMs` (0px/s) —
    // l'accélération de cette fenêtre est comptée deux fois (une fois en direct, une fois au
    // rejeu). Résidu de rejeu (19.375) largement au-dessus du seuil dynamique d'ignorance de
    // `reconcile()` : un vrai écart perceptible (le tremblement décrit dans
    // fix_vitesse_reseau.md), pas du bruit d'arrondi — exactement le comportement pré-correctif.
    expect(entity!.x).toBeCloseTo(51.25, 5);
    expect(entity!.x - 31.875).toBeGreaterThan(15); // marge large vs le résultat corrigé ci-dessus
  });
});
