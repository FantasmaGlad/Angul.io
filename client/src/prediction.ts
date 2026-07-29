import {
  accelerationForMass,
  add,
  length,
  massToRadius,
  moveToward,
  scale,
  sub,
  velocityForMass,
  type EntitySnapshot,
  type MovementConfig,
  type Vector2,
} from '@angulio/shared';

/** Prédiction locale du blob du joueur + réconciliation par rejeu d'inputs avec l'état autoritaire
 * du serveur (plan_performance_reseau.md Phase 1). Sans ce module, le blob du joueur suit le même
 * pipeline retardé que les entités distantes (buffer d'interpolation, voir renderEngine.ts) :
 * ~100-150ms de latence structurelle entre "je bouge la souris" et "je vois le blob réagir", même
 * en LAN.
 *
 * Principe (identique au netcode agar.io/FPS/MOBA) : le client rejoue localement, à chaque frame,
 * exactement la même formule de mouvement que le serveur (`moveToward` + accélération/vitesse
 * dépendantes de la masse, voir shared/src/movement.ts) pour chacun de ses PROPRES morceaux —
 * donc réagit à l'input sans attendre l'aller-retour réseau.
 *
 * Réconciliation par REJEU (pas un simple blend/snap, voir historique de ce fichier) : un `state`
 * autoritaire reçu MAINTENANT décrit forcément la position du joueur telle qu'elle était il y a
 * ~RTT/2 + un tick — pas "maintenant". Comparer naïvement "où j'ai déjà prédit être maintenant" à
 * "où j'étais il y a RTT/2 + un tick" produit un écart qui grandit avec la latence ET la vitesse de
 * déplacement, alors que ce n'est PAS une erreur de prédiction : c'est l'avance normale et voulue
 * de la prédiction. Le corriger comme une erreur (blend/snap vers l'arrière en continu) tire
 * visiblement le blob en arrière à chaque `state` reçu — un vrai "rollback" perceptible dès que la
 * latence/gigue réseau devient significative (mesuré en production : ~50ms de RTT avec ~30ms de
 * gigue sur une connexion résidentielle, voir plan_performance_reseau.md). La solution standard
 * (Quake/Source/Overwatch) : ancrer la position PRÉDITE sur la position AUTORITAIRE reçue, puis
 * REJOUER les inputs déjà appliqués localement depuis l'instant estimé de cette capture serveur —
 * on retombe ainsi sur la même position "en avance" qu'avant, mais désormais réellement ancrée à
 * la vérité serveur plutôt qu'à une dérive accumulée. Le budget de rejeu est petit (le journal
 * d'inputs ne couvre que quelques centaines de ms), donc peu coûteux même à un framerate élevé.
 *
 * Volontairement limité au déplacement en vol libre : ni les collisions/répulsions entre
 * morceaux, ni le split lui-même (nouvelle pièce, vitesse d'éjection), ni la perte passive de
 * masse ne sont prédits/rejoués ici — ces événements restent entièrement dictés par le serveur et
 * n'apparaissent qu'à la réception du `state` qui les contient. Compromis délibéré : l'essentiel de
 * la sensation de latence vient du pilotage (diriger vers le curseur), pas de ces événements
 * ponctuels, et les prédire fidèlement dupliquerait des règles de jeu (avantage de masse, cooldown
 * de fusion, bords de carte…) avec un vrai risque de désync silencieuse. Un vrai événement
 * discontinu (split, collision, mangé…) survenu depuis le dernier `state` connu n'est de toute
 * façon pas rejouable : il est simplement absorbé au `state` SUIVANT, qui ré-ancre la position à
 * nouveau — MAIS voir `RECONCILE_SNAP_THRESHOLD_PX` : un absorbé "sec" s'est révélé bien plus
 * visible que prévu en pratique, la répulsion entre morceaux (server/src/mods/parametric/index.ts
 * `applyRepulsion`) se déclenchant en continu dès qu'un bot frôle le joueur sur une carte peuplée —
 * pas un événement rare, un nudge de position à quasiment chaque `state` reçu. D'où le lissage
 * borné ci-dessous, appliqué à l'écart RÉSIDUEL post-rejeu (jamais à l'écart brut position-à-
 * position comme l'ancienne réconciliation blend/snap pré-e0ec331) : dans le cas normal (aucun
 * événement non modélisé depuis le dernier `state`), rejouer depuis `authoritative` reconstruit
 * exactement la position déjà prédite — l'écart résiduel est donc nul et ce lissage n'a aucun
 * effet, contrairement à l'ancien blend qui tirait le blob en arrière en continu proportionnellement
 * à la latence (le bug que e0ec331 corrigeait). Il ne s'active que quand le résidu est non nul,
 * c'est-à-dire précisément quand un événement non rejouable (répulsion, croissance) l'a produit.
 *
 * Le lissage lui-même NE corrige PAS la position simulée (`position`, utilisée pour la vélocité/
 * l'intégration — elle doit rester exacte immédiatement, sinon la physique locale désynchronise) :
 * il corrige uniquement l'AFFICHAGE, via un `visualOffset` séparé qui absorbe le saut et se résorbe
 * ensuite à VITESSE PLAFONNÉE (`VISUAL_CORRECTION_SPEED_PX_PER_S`), frame de rendu après frame de
 * rendu, plutôt qu'un pourcentage comblé en un seul `state` reçu (~30Hz). Un pourcentage fixe
 * produit un bond proportionnellement plus grand pour un écart plus grand ("violent" à chaque vrai
 * événement, en pratique dès qu'un bot pousse le joueur) ; une vitesse plafonnée étale la même
 * correction sur autant de frames que nécessaire pour ne jamais dépasser un déplacement visuel
 * confortable, quelle que soit l'ampleur de l'écart — technique standard ("network smoothing",
 * Source engine/Unity Netcode) qui découple la position simulée (toujours exacte) de la position
 * affichée (toujours continue).
 *
 * `step()` intègre à un PAS DE TEMPS FIXE (`FIXED_STEP_SECONDS`), jamais au `dt` variable de la
 * frame de rendu (accumulateur ci-dessous, pattern "fix your timestep" classique) : c'est ce qui
 * manquait pour que le joueur bénéficie de la même immunité à la gigue de timing des frames que
 * les robots/joueurs distants. Ces derniers sont dessinés par simple ÉVALUATION d'une fonction
 * d'interpolation entre deux points serveur fixes à l'instant `t` de la frame courante — quelle que
 * soit l'irrégularité réelle des timestamps `requestAnimationFrame` (compositeur, charge machine,
 * moniteur haut rafraîchissement...), le résultat est mathématiquement le même point sur la même
 * courbe, donc lisse par construction. Le joueur, à l'inverse, était intégré pas à pas avec le `dt`
 * RÉEL de chaque frame : la moindre irrégularité de ce `dt` (même quelques dixièmes de ms, réels et
 * mesurables sur n'importe quel navigateur) perturbait directement la position accumulée d'une
 * frame à l'autre — la seule vraie raison pour laquelle "seul le joueur tressaute, jamais les
 * robots" même une fois la réconciliation parfaitement lissée. Un pas fixe assez petit
 * (`FIXED_STEP_SECONDS`) pour qu'aucun sous-pas ne soit individuellement perceptible restaure cette
 * même immunité : la simulation locale redevient déterministe, indépendante du framerate réel —
 * PAS besoin de forcer artificiellement les FPS sur un multiple du tick serveur (impossible à
 * garantir de toute façon : un navigateur ne fournit aucune garantie de cadence rAF exacte, et la
 * question n'a plus lieu d'être une fois la simulation locale elle-même indépendante du framerate). */

interface PredictedPiece {
  position: Vector2;
  velocity: Vector2;
  mass: number;
  /** Écart entre la position AFFICHÉE et `position` (simulée, exacte) — non nul juste après une
   * réconciliation ayant absorbé un vrai événement, se résorbe ensuite vers {0,0} à vitesse
   * plafonnée (voir `VISUAL_CORRECTION_SPEED_PX_PER_S`). Jamais utilisé par `integrate()`/la
   * physique, uniquement par `applyTo()`/`getOwnPosition()` (l'affichage). */
  visualOffset: Vector2;
}

/** Un échantillon d'input local déjà appliqué (`step`), horodaté — rejoué lors de la
 * réconciliation pour reconstruire "où la prédiction en serait" à partir d'une position ancrée à
 * la vérité serveur plutôt que de la dérive accumulée. */
interface InputSample {
  atMs: number;
  dtSeconds: number;
  target: Vector2;
  intensity: number;
}

/** Fenêtre de journal conservée (ms) — doit largement couvrir la pire latence réaliste (RTT +
 * marge de traitement serveur) ; au-delà, un échantillon ne sera de toute façon jamais rejoué. */
const HISTORY_WINDOW_MS = 600;
/** Doit rester identique à `TARGET_DEAD_ZONE_PX` (server/src/mods/parametric/index.ts) — voir
 * `integrate()`. Élimine l'instabilité de normalisation d'un vecteur quasi nul (`offset` de la
 * position vers la cible) : c'était le tremblotement visible du blob du joueur (absent des
 * robots/joueurs distants, toujours lissés par l'interpolation, jamais par un recalcul brut à
 * chaque frame de rendu comme ici). */
const TARGET_DEAD_ZONE_PX = 3;
/** Repli si aucune mesure de latence n'est encore disponible (avant le premier `pong`, voir
 * GameView.tsx) — plutôt conservateur (rejoue peu) qu'agressif (rejouerait trop et re-créerait de
 * l'avance non ancrée). */
const DEFAULT_LATENCY_MS = 60;
/** Écart résiduel (px, post-rejeu) au-delà duquel on snap immédiatement plutôt que lisser — au-delà
 * de ce seuil, quasi certainement un vrai téléport (mort/respawn, nouveau morceau, bord de carte),
 * pas un nudge de répulsion routinier. Valeur reprise de l'ancienne réconciliation blend/snap
 * (pré-e0ec331), qui s'appliquait déjà au même ordre de grandeur d'écart. */
const RECONCILE_SNAP_THRESHOLD_PX = 120;
/** Vitesse maximale (px/s) à laquelle `visualOffset` se résorbe vers {0,0} — voir le commentaire
 * d'en-tête ("network smoothing"). ~2x la vitesse de base typique (v0 ≈ 245-300px/s, voir
 * server/configs/*.json) : assez rapide pour qu'une correction proche du seuil de snap
 * (RECONCILE_SNAP_THRESHOLD_PX) se résorbe en ~200ms plutôt que de traîner, assez lent pour ne
 * jamais ressembler à un second bond. */
const VISUAL_CORRECTION_SPEED_PX_PER_S = 600;
/** Écart résiduel (px) en-deçà duquel on n'applique AUCUNE correction, même lissée. Depuis que le
 * rejeu (`reconcile`) regroupe l'historique par blocs de la taille d'un tick serveur plutôt que de
 * rejouer chaque sous-pas fin de `step()` individuellement (voir `chunkHistoryForReplay`), les deux
 * intégrations (client/serveur) utilisent la même discrétisation pour la même portion de temps —
 * il ne reste plus qu'un biais résiduel de l'ordre de `accel·dt²/2` par bloc (voir le commentaire
 * de `chunkHistoryForReplay`), pas un vrai désaccord.
 *
 * Dérivé DYNAMIQUEMENT (voir `reconcile`) de `accel·dtTick²/2` plutôt qu'une constante fixe —
 * l'ancienne valeur (un nombre "magique" en pixels, 1.5 puis 2.5 puis 3.0 au fil des réglages de
 * `accelerationBase`/`accelerationMassExponent`, voir historique de ce fichier) devait être
 * recalibrée à la main à chaque changement de la physique d'un mode, et restait fausse pour tout
 * futur mode avec sa propre config (le biais résiduel est proportionnel à l'accélération EFFECTIVE
 * du morceau, qui dépend de sa masse ET du mod actif — pas une constante universelle). En dérivant
 * le seuil de la formule physique elle-même (accélération réelle du morceau × pas de tick², voir
 * le commentaire de `chunkHistoryForReplay`), tout mode futur obtient automatiquement un seuil
 * cohérent avec ses propres réglages, sans retouche manuelle — "communise" ce correctif entre
 * Vanilla, Hardcore et tout mod à venir. */
const RECONCILE_IGNORE_SAFETY_FACTOR = 1.5;
/** Plancher (px) du seuil dynamique ci-dessus — pur bruit d'arrondi flottant à masse/accélération
 * quasi nulle, jamais un vrai désaccord ; évite que le seuil ne tombe à (quasi) zéro et ne
 * déclenche un lissage visuel pour un résidu insignifiant. */
const RECONCILE_IGNORE_FLOOR_PX = 0.5;
/** Plafond (px) du seuil dynamique ci-dessus — borne supérieure pour éviter que des objets de test
 * ou des accélérations extrêmes ne fassent s'envoler le seuil d'ignorance. */
const RECONCILE_IGNORE_MAX_PX = 3.0;
/** Pas de temps interne FIXE auquel `step()` intègre la simulation locale (voir le commentaire
 * d'en-tête, "fix your timestep") — indépendant du `dt` réel de la frame de rendu. Assez fin pour
 * qu'aucun sous-pas ne soit perceptible individuellement, même sur un écran très haut
 * rafraîchissement (jusqu'à 240Hz). */
const FIXED_STEP_SECONDS = 1 / 240;
/** Plafond de rattrapage par appel à `step()` — au-delà (onglet mis en arrière-plan, point d'arrêt
 * debugger, gros GC...), mieux vaut perdre un peu de précision temporelle que d'exécuter des
 * dizaines de sous-pas d'un coup au retour au premier plan. */
const MAX_FRAME_SECONDS = 0.25;

export class LocalPrediction {
  private readonly pieces = new Map<string, PredictedPiece>();
  private readonly history: InputSample[] = [];
  private pendingDashes: Array<{ atMs: number; impulse: Vector2 }> = [];
  /** Reliquat de temps non encore intégré en pas fixe (voir `step()`). */
  private accumulatorSeconds = 0;
  private activeTarget: Vector2 | undefined;
  private activeIntensity = 0;

  /** Enregistre l'input exact transmis au serveur pour aligner à 100% la prédiction locale. */
  recordSentInput(target: Vector2, intensity: number): void {
    this.activeTarget = target;
    this.activeIntensity = intensity;
  }

  /** À appeler à chaque `state` reçu, avec les entités BRUTES du message (pas interpolées) — met
   * à jour/crée/retire les morceaux prédits du joueur pour rester cohérent avec ce que le serveur
   * connaît réellement (nouveaux morceaux après un split, morceaux disparus après une fusion/mort/
   * absorption), puis ancre chaque morceau connu sur la vérité serveur et rejoue l'historique
   * d'inputs récent par-dessus (voir le commentaire d'en-tête).
   *
   * `estimatedLatencyMs` : estimation de la latence aller simple (RTT mesuré / 2, voir
   * GameView.tsx `lastPingMs`) — détermine à partir de quel instant du journal rejouer. Une
   * estimation imprécise ne casse rien (juste un peu plus/moins de rejeu que l'idéal), contrairement
   * à l'ancienne approche blend/snap qui accumulait une erreur systématique proportionnelle à la
   * latence RÉELLE quelle que soit la précision de l'estimation.
   *
   * `serverTickRateHz` : cadence de tick du salon (reçue dans `welcome`, voir GameView.tsx) —
   * détermine la granularité à laquelle regrouper le rejeu (voir `chunkHistoryForReplay`).
   * `undefined` (mod de test sans config connue) retombe sur un rejeu échantillon par échantillon,
   * comme avant ce regroupement.
   *
   * `authoritativeVelocities` : vélocité autoritaire par morceau (`message.self?.pieces`, voir
   * protocol.ts) — sans elle, le rejeu repart de `predicted.velocity` telle que `step()` l'a déjà
   * fait progresser EN DIRECT pendant la fenêtre qu'on s'apprête à rejouer, et lui réapplique
   * l'accélération une seconde fois sur ce même intervalle (double comptage, voir
   * fix_vitesse_reseau.md) — un biais qui ne se voit qu'en accélération/décélération (vélocité pas
   * encore saturée), jamais à l'arrêt ni à vitesse de croisière. `undefined` (ancien serveur, ou
   * morceau absent de la map) : repli sur ce comportement pré-correctif pour ce morceau. */
  reconcile(
    entities: EntitySnapshot[],
    selfPlayerId: string,
    movement: MovementConfig,
    estimatedLatencyMs: number = DEFAULT_LATENCY_MS,
    serverTickRateHz?: number,
    authoritativeVelocities?: Map<string, Vector2>,
  ): void {
    const nowMs = performance.now();
    this.pruneHistory(nowMs);
    const sinceMs = nowMs - Math.max(0, estimatedLatencyMs);
    const relevantSamples = this.history.filter((sample) => sample.atMs > sinceMs);
    const replayChunks = this.chunkHistoryForReplay(relevantSamples, serverTickRateHz);

    const seenIds = new Set<string>();
    for (const entity of entities) {
      if (entity.k !== 'c' || entity.p !== selfPlayerId) continue;
      seenIds.add(entity.i);

      const authoritative: Vector2 = { x: entity.x, y: entity.y };
      const predicted = this.pieces.get(entity.i);
      if (!predicted) {
        // Morceau inconnu (premier `state` de la vie, ou apparu ce tick — ex. juste après un
        // split) : pas d'historique de CE morceau à rejouer, on part directement de la position
        // serveur (il rejoindra le rejeu normalement dès le `state` suivant).
        this.pieces.set(entity.i, {
          position: authoritative,
          velocity: { x: 0, y: 0 },
          mass: entity.m,
          visualOffset: { x: 0, y: 0 },
        });
        continue;
      }

      const beforeReconcile = predicted.position;
      predicted.mass = entity.m;
      predicted.position = authoritative;
      // Rembobine la vélocité sur la vérité serveur AVANT de rejouer (voir le commentaire de
      // `authoritativeVelocities` ci-dessus) — sans ce reset, le rejeu repart de la vélocité déjà
      // avancée en direct par `step()` et double-compte l'accélération sur la fenêtre rejouée.
      const knownVelocity = authoritativeVelocities?.get(entity.i);
      if (knownVelocity) predicted.velocity = { ...knownVelocity };

      const activeDashes = this.pendingDashes.filter((d) => d.atMs >= sinceMs);
      for (const dash of activeDashes) {
        predicted.velocity = add(predicted.velocity, dash.impulse);
      }

      for (const chunk of replayChunks) {
        this.integrate(predicted, chunk.dtSeconds, chunk.target, chunk.intensity, movement);
      }

      // Écart résiduel entre "où la prédiction en était déjà" et "où le rejeu vient de la
      // reconstruire" — quasi nul dans le cas normal (bruit d'intégration dt variable/fixe, voir
      // le seuil dynamique ci-dessous), plus significatif seulement quand un événement non rejoué
      // (répulsion, croissance...) a réellement déplacé le morceau côté serveur. Voir aussi
      // RECONCILE_SNAP_THRESHOLD_PX.
      const residual = sub(predicted.position, beforeReconcile);
      const residualDist = length(residual);
      const tickSeconds = serverTickRateHz && serverTickRateHz > 0 ? 1 / serverTickRateHz : 1 / 30;
      const dynamicIgnoreThresholdPx = Math.min(
        RECONCILE_IGNORE_MAX_PX,
        Math.max(
          RECONCILE_IGNORE_FLOOR_PX,
          accelerationForMass(predicted.mass, movement) * tickSeconds * tickSeconds * 0.5 * RECONCILE_IGNORE_SAFETY_FACTOR,
        ),
      );
      if (residualDist <= dynamicIgnoreThresholdPx) {
        predicted.position = beforeReconcile;
      } else if (residualDist <= RECONCILE_SNAP_THRESHOLD_PX) {
        // `predicted.position` reste la reconstruction exacte (la simulation ne doit jamais
        // dévier) — le saut est absorbé dans `visualOffset`, résorbé à vitesse plafonnée par
        // `step()`, pour que l'AFFICHAGE reste continu au lieu de sauter avec elle.
        predicted.visualOffset = sub(predicted.visualOffset, residual);
      } else {
        // Vrai téléport (mort/respawn, nouveau morceau, bord de carte...) : aucun lissage visuel,
        // l'affichage saute directement avec la simulation.
        predicted.visualOffset = { x: 0, y: 0 };
      }
    }

    for (const id of [...this.pieces.keys()]) {
      if (!seenIds.has(id)) this.pieces.delete(id);
    }
  }

  /** À appeler à chaque frame de rendu (`requestAnimationFrame`), avec l'input courant — avance
   * la simulation locale des morceaux du joueur exactement comme `onTick`/`onPlayerInput` du mod
   * paramétrique (server/src/mods/parametric/index.ts) le font côté serveur, et journalise
   * l'échantillon pour un rejeu ultérieur (voir `reconcile`). */
  step(dtSeconds: number, target: Vector2, intensity: number, movement: MovementConfig): void {
    if (dtSeconds <= 0) return;

    const effTarget = this.activeTarget ?? target;
    const effIntensity = this.activeTarget ? this.activeIntensity : intensity;

    // Accumulateur (voir le commentaire d'en-tête, "fix your timestep") : le `dt` réel de la frame
    // de rendu ne sert qu'à savoir COMBIEN de pas fixes exécuter, jamais comme pas d'intégration
    // lui-même — la simulation locale reste ainsi déterministe, indépendante du framerate réel.
    this.accumulatorSeconds = Math.min(this.accumulatorSeconds + dtSeconds, MAX_FRAME_SECONDS);
    const maxOffsetStep = VISUAL_CORRECTION_SPEED_PX_PER_S * FIXED_STEP_SECONDS;
    // Un seul horodatage pour tous les sous-pas de CET appel — largement assez précis pour le
    // découpage `sinceMs` de `reconcile()` (granularité de plusieurs ms), et évite un appel
    // `performance.now()` par sous-pas (jusqu'à des dizaines par frame sur un gros ralentissement).
    const atMs = performance.now();

    while (this.accumulatorSeconds >= FIXED_STEP_SECONDS) {
      this.accumulatorSeconds -= FIXED_STEP_SECONDS;

      this.history.push({ atMs, dtSeconds: FIXED_STEP_SECONDS, target: effTarget, intensity: effIntensity });

      for (const piece of this.pieces.values()) {
        this.integrate(piece, FIXED_STEP_SECONDS, effTarget, effIntensity, movement);
        // Résorption à vitesse plafonnée de l'écart d'affichage laissé par une réconciliation
        // récente (voir `reconcile`), au même pas fixe que le reste de la simulation locale.
        piece.visualOffset = moveToward(piece.visualOffset, { x: 0, y: 0 }, maxOffsetStep);
      }
    }
    this.pruneHistory(atMs);
  }

  /** Applique localement une impulsion de Dash à toutes les pièces prédites du joueur pour éviter tout décalage entre la prédiction locale et le serveur.
   *
   * Journalise aussi l'impulsion dans `pendingDashes` (voir son commentaire de champ) —
   * indispensable pour que `reconcile()` la réapplique lors du rejeu : sans cet enregistrement,
   * le tout premier `state` reçu après le dash réinitialise `predicted.velocity` sur la vélocité
   * autoritaire (pré-dash, voir `reconcile`) et le rejeu ne restitue jamais l'impulsion —
   * l'accélération locale du dash est alors visuellement annulée puis "revient" d'un coup au
   * tick suivant, perçu comme un gros lag/saccade au dash. */
  applyDash(direction: Vector2, speedImpulse = 2700): void {
    for (const piece of this.pieces.values()) {
      piece.velocity = add(piece.velocity, scale(direction, speedImpulse));
    }
    this.pendingDashes.push({ atMs: performance.now(), impulse: scale(direction, speedImpulse) });
  }

  /** Regroupe les échantillons fins de `step()` (pas `FIXED_STEP_SECONDS`, 1/240s) en blocs dont la
   * durée cumulée correspond au pas serveur (1/`serverTickRateHz`) avant rejeu — plutôt qu'un
   * `integrate()` par échantillon fin.
   *
   * Pourquoi : `moveToward` (voir `integrate`) est une rampe linéaire clampée ; pour la MÊME rampe
   * (direction/intensité constantes), l'intégrer en N pas fins ou en 1 pas grossier ne converge PAS
   * vers la même position tant que la vélocité n'a pas saturé sa cible — l'intégration (semi-
   * implicite, position += vélocité déjà mise à jour × dt) d'un pas grossier "dépasse" celle d'une
   * intégration fine d'environ `accel·dt²/2` par pas de rampe. Le serveur (`Room.tick()`) intègre
   * en 1 seul pas de `1/tickRateHz` ; rejouer avec ~8 pas de `1/240s` pour ce même intervalle
   * introduisait donc un écart systématique de quelques px à CHAQUE accélération/changement de cap
   * — soit en pilotage actif, en permanence — largement au-dessus de
   * `RECONCILE_IGNORE_THRESHOLD_PX`, corrigé en boucle par le lissage visuel (le tremblement
   * "dans tous les sens, en continu" du blob du joueur). Regrouper le rejeu à la même granularité
   * que le serveur reproduit la même discrétisation pour le même intervalle de temps, éliminant ce
   * biais à la source plutôt que de le lisser après coup.
   *
   * Le pas fin de `step()` lui-même n'a pas besoin de changer : c'est ce qui rend le rendu EN
   * DIRECT fluide et indépendant du framerate, et il n'est comparé à rien — seul le REJEU doit
   * matcher la discrétisation serveur. Un bloc peut donc regrouper plusieurs frames de rendu
   * (target légèrement différent d'une frame à l'autre en pilotage actif) ; comme le serveur, qui
   * n'applique qu'UNE cible par tick (celle du dernier `input` reçu), on retient la cible du DERNIER
   * échantillon du bloc pour tout le bloc plutôt que de mélanger plusieurs cibles dans un seul
   * `integrate()`. */
  private chunkHistoryForReplay(
    samples: InputSample[],
    serverTickRateHz: number | undefined,
  ): Array<{ dtSeconds: number; target: Vector2; intensity: number }> {
    if (!serverTickRateHz || serverTickRateHz <= 0) {
      // Cadence serveur inconnue (ex. mod de test) : repli sur l'ancien comportement, un bloc par
      // échantillon fin — jamais le cas en production, où `welcome` fournit toujours `tickRateHz`.
      return samples.map((sample) => ({
        dtSeconds: sample.dtSeconds,
        target: sample.target,
        intensity: sample.intensity,
      }));
    }

    const tickSeconds = 1 / serverTickRateHz;
    const chunks: Array<{ dtSeconds: number; target: Vector2; intensity: number }> = [];
    let accDtSeconds = 0;
    let lastTarget: Vector2 | undefined;
    let lastIntensity = 0;

    for (const sample of samples) {
      accDtSeconds += sample.dtSeconds;
      lastTarget = sample.target;
      lastIntensity = sample.intensity;
      // Tolérance flottante : la somme de plusieurs `FIXED_STEP_SECONDS` peut manquer `tickSeconds`
      // de quelques ulps même quand elle le couvre exactement (ex. 8×1/240s vs 1/30s).
      if (accDtSeconds >= tickSeconds - 1e-9) {
        chunks.push({ dtSeconds: accDtSeconds, target: lastTarget, intensity: lastIntensity });
        accDtSeconds = 0;
        lastTarget = undefined;
      }
    }
    // Reliquat plus court qu'un tick plein (fin de fenêtre de rejeu) : rejoué tel quel, borné par
    // construction à moins de `tickSeconds` — pas de biais significatif sur un intervalle aussi
    // court.
    if (accDtSeconds > 0 && lastTarget) {
      chunks.push({ dtSeconds: accDtSeconds, target: lastTarget, intensity: lastIntensity });
    }
    return chunks;
  }

  /** Cœur du modèle de mouvement (identique à `onTick`/`inputVectorOf` du mod paramétrique côté
   * serveur) — extrait en méthode pour être appelé aussi bien en direct (`step`) qu'en rejeu
   * (`reconcile`), garantissant que les deux utilisent EXACTEMENT le même calcul. */
  private integrate(
    piece: PredictedPiece,
    dtSeconds: number,
    target: Vector2,
    intensity: number,
    movement: MovementConfig,
  ): void {
    const offset = sub(target, piece.position);
    const dist = length(offset);
    // Zone morte : voir TARGET_DEAD_ZONE_PX et son homologue serveur (inputVectorOf,
    // mods/parametric/index.ts) — intensité effective nulle, direction sans importance.
    const direction = dist > 0 ? scale(offset, 1 / dist) : { x: 1, y: 0 };
    const inDeadZone = dist < TARGET_DEAD_ZONE_PX;
    // Miroir exact d'`inputVectorOf` côté serveur (voir son commentaire) : dès que le joueur a
    // plus d'un morceau, l'intensité analogique (dérivée souris↔centre écran, hors de propos
    // dès que le curseur est placé entre plusieurs morceaux pour les regrouper) est ignorée au
    // profit d'une convergence à pleine vitesse — sans ce miroir, la prédiction locale
    // divergerait du serveur et `reconcile()` "snapperait" la position à chaque `state` reçu.
    const hasMultiplePieces = this.pieces.size > 1;
    const effectiveIntensity = inDeadZone ? 0 : hasMultiplePieces ? 1 : intensity;
    const accelIntensity = 1;

    const targetVelocity = scale(direction, velocityForMass(piece.mass, movement) * effectiveIntensity);
    const maxChange = accelerationForMass(piece.mass, movement) * accelIntensity * dtSeconds;
    piece.velocity = moveToward(piece.velocity, targetVelocity, maxChange);
    piece.position = add(piece.position, scale(piece.velocity, dtSeconds));

    if (movement.mapSize && movement.mapSize > 0) {
      const r = massToRadius(piece.mass);
      const minX = r;
      const maxX = movement.mapSize - r;
      const minY = r;
      const maxY = movement.mapSize - r;
      if (piece.position.x < minX) {
        piece.position.x = minX;
        piece.velocity.x = 0;
      } else if (piece.position.x > maxX) {
        piece.position.x = maxX;
        piece.velocity.x = 0;
      }
      if (piece.position.y < minY) {
        piece.position.y = minY;
        piece.velocity.y = 0;
      } else if (piece.position.y > maxY) {
        piece.position.y = maxY;
        piece.velocity.y = 0;
      }
    }
  }

  private pruneHistory(nowMs: number): void {
    const cutoff = nowMs - HISTORY_WINDOW_MS;
    while (this.history.length > 0 && this.history[0]!.atMs < cutoff) {
      this.history.shift();
    }
    // Même fenêtre que l'historique d'inputs (`pendingDashes` n'a besoin de couvrir que ce que
    // `reconcile()` peut encore rejouer) — sans cet élagage, chaque dash de la session
    // s'accumulerait indéfiniment (fuite mémoire non bornée sur une longue partie).
    this.pendingDashes = this.pendingDashes.filter((d) => d.atMs >= cutoff);
  }

  /** Remplace, dans `entities` (déjà interpolées/cullées côté serveur-distant), la position des
   * morceaux du joueur par leur position AFFICHÉE (simulation + `visualOffset`, voir le
   * commentaire d'en-tête) — ne touche à rien d'autre (rayon/masse/couleur restent ceux du
   * pipeline serveur habituel). */
  applyTo(entities: EntitySnapshot[], selfPlayerId: string): EntitySnapshot[] {
    if (this.pieces.size === 0) return entities;
    return entities.map((entity) => {
      if (entity.k !== 'c' || entity.p !== selfPlayerId) return entity;
      const predicted = this.pieces.get(entity.i);
      if (!predicted) return entity;
      return {
        ...entity,
        x: predicted.position.x + predicted.visualOffset.x,
        y: predicted.position.y + predicted.visualOffset.y,
      };
    });
  }

  /** Barycentre (pondéré par la masse) des morceaux prédits du joueur — à utiliser comme
   * référence pour convertir la position écran du curseur en coordonnées monde (voir
   * `input.ts`/`GameView.tsx`), PLUTÔT QUE la position de la caméra. La caméra est lissée
   * (`cameraLerp`, GameView.tsx) donc en retard de quelques frames à ~150ms sur la vraie position
   * dès qu'un événement non prédit la déplace (répulsion contre un bot, etc. — voir `reconcile`) ;
   * l'utiliser comme référence de pilotage couplerait la précision du contrôle à la vitesse de
   * convergence du suivi caméra, réintroduisant un tremblement (le curseur au centre de l'écran ne
   * correspondrait plus exactement à "aucune commande" tant que la caméra n'a pas rattrapé la vraie
   * position). `undefined` hors partie ou avant le premier `reconcile` (fallback caméra, voir
   * l'appelant). */
  getOwnPosition(): Vector2 | undefined {
    if (this.pieces.size === 0) return undefined;
    let mass = 0;
    let x = 0;
    let y = 0;
    for (const piece of this.pieces.values()) {
      mass += piece.mass;
      // Position AFFICHÉE (simulation + visualOffset, voir le commentaire d'en-tête) : la caméra
      // et la référence de pilotage doivent suivre ce que le joueur voit réellement, pas la
      // position simulée invisible pendant qu'un `visualOffset` résiduel se résorbe encore.
      x += (piece.position.x + piece.visualOffset.x) * piece.mass;
      y += (piece.position.y + piece.visualOffset.y) * piece.mass;
    }
    if (mass <= 0) return undefined;
    return { x: x / mass, y: y / mass };
  }

  /** À appeler à chaque nouvelle vie (message `welcome`) — un id de morceau ne se réutilise
   * jamais d'une vie à l'autre (compteur global côté serveur, voir World.spawnEntity), donc rien
   * ne serait techniquement faux sans ce reset, mais il évite de conserver inutilement une entrée
   * pendant l'écran de mort. Vide aussi le journal d'inputs (les échantillons d'une vie précédente
   * n'ont plus de sens à rejouer). */
  reset(): void {
    this.pieces.clear();
    this.history.length = 0;
    this.activeTarget = undefined;
    this.activeIntensity = 0;
  }
}
