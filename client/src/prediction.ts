import {
  accelerationForMass,
  add,
  decelerationForMass,
  distance,
  length,
  massToRadius,
  moveToward,
  PI,
  restingDistanceForOverlap,
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
 * rendu, plutôt qu'un pourcentage comblé en un seul `state` reçu (~20Hz). Un pourcentage fixe
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
 * Vanilla, Hardcore et tout mod à venir.
 *
 * Ce terme seul ne couvre que le biais de la phase d'ACCÉLÉRATION (avant saturation de la
 * vitesse) — il ne couvre PAS une seconde source de résidu, distincte et mesurée bien plus grande
 * en simulation (voir historique de ce fichier, "tremblement du blob du joueur") : `sinceMs`
 * (point de départ du rejeu) dépend de `estimatedLatencyMs`, une estimation LISSÉE (EMA 1x/s, voir
 * GameView.tsx) de la latence MOYENNE — jamais exacte pour un message DONNÉ dès que la gigue
 * réseau réelle (mesurée en production : voir `smoothedLatencyMs`) dépasse quelques ms. Or
 * `chunkHistoryForReplay` regroupe le rejeu par BLOCS de la taille d'un tick : un écart de
 * `sinceMs` d'une fraction de tick suffit à inclure/exclure un bloc ENTIER, donc à décaler le
 * résidu d'un plein multiple de `vitesse_croisière × dtTick` — un ordre de grandeur au-dessus du
 * biais d'accélération ci-dessus, et strictement DE LA MÊME NATURE que lui (bruit de découpage
 * temporel du rejeu, jamais un vrai désaccord physique) : à l'arrêt (vitesse nulle) ce terme
 * s'annule de lui-même, exactement comme le biais d'accélération, ce qui explique que ce
 * tremblement soit lui aussi invisible à l'arrêt et perceptible seulement en pilotage actif. */
const RECONCILE_IGNORE_SAFETY_FACTOR = 1.5;
/** Plancher (px) du seuil dynamique ci-dessus — pur bruit d'arrondi flottant à masse/accélération
 * quasi nulle, jamais un vrai désaccord ; évite que le seuil ne tombe à (quasi) zéro et ne
 * déclenche un lissage visuel pour un résidu insignifiant. */
const RECONCILE_IGNORE_FLOOR_PX = 0.5;
/** Tolère jusqu'à un bloc de rejeu ENTIER (voir le commentaire ci-dessus sur `sinceMs`) de bruit de
 * découpage temporel — au-delà, considéré comme un vrai événement (répulsion, correction). 1.0
 * couvrirait exactement un tick plein ; 1.5 y ajoute une demi-marge pour le fait que le bloc
 * inclus/exclu ne s'aligne jamais exactement sur la frontière de tick (`sinceMs` est dérivé d'une
 * latence LISSÉE, voir ci-dessus). Volontairement pas davantage : une répulsion serveur réelle et
 * soutenue (voir le commentaire d'en-tête sur `applyRepulsion`) doit rester détectée dès qu'elle
 * dépasse ce bruit de fond, jamais masquée indéfiniment. */
const RECONCILE_JITTER_TOLERANCE_TICKS = 1.5;
/** Plafond (px) du terme de biais d'ACCÉLÉRATION ci-dessus (`accelerationBiasPx` dans
 * `reconcile`) — borne de sécurité pour éviter qu'un mod/test à l'accélération démesurée (voir
 * `MOVEMENT` dans prediction.test.ts, accelerationBase quasi infini pour simplifier le calcul à la
 * main) ne fasse s'envoler CE terme précis. Plafonné SÉPARÉMENT du terme de gigue ci-dessous (voir
 * `RECONCILE_JITTER_TOLERANCE_MAX_PX`) : les deux mécanismes sont indépendants, l'un ne doit pas
 * hériter du plafond, bien plus large, dimensionné pour l'autre. */
const RECONCILE_ACCEL_BIAS_MAX_PX = 3.0;
/** Plafond (px) du terme de tolérance à la gigue ci-dessus (`replayChunkJitterPx` dans
 * `reconcile`) — borne de sécurité, pas un usage normal en soi. Doit couvrir la vitesse RÉELLE la
 * plus élevée du jeu, pas seulement la vitesse de croisière : depuis que `replayChunkJitterPx` se
 * base sur `length(predicted.velocity)` (vitesse réelle, voir son commentaire) plutôt que sur la
 * seule masse, l'impulsion de Dash (4050px/s) produit un terme brut d'environ
 * `4050 × (1/20) × 1.5 ≈ 300px` (ou ~200px à 30Hz) — un ancien plafond de 60px l'écrêtait sévèrement,
 * laissant EXACTEMENT le bruit de découpage temporel normal pendant tout un Dash retomber dans la
 * branche "lissage visuel" (`visualOffset`) au lieu d'être ignoré comme le bruit qu'il est : une
 * micro-correction visible à CHAQUE `state` reçu tant que la vitesse reste élevée, perçue comme un
 * mini rollback continu (retour utilisateur : "mini roll back tout au long du dash", pas
 * seulement à son déclenchement). Relevé à 220px : couvre confortablement la vitesse de Dash la
 * plus élevée du jeu, avec une marge pour la latence/gigue réseau réelle (voir
 * `RECONCILE_JITTER_TOLERANCE_TICKS`) ; un mod/test futur à vitesse encore plus démesurée reste
 * borné par CETTE constante, jamais illimité. */
const RECONCILE_JITTER_TOLERANCE_MAX_PX = 220.0;
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

  /** À appeler à chaque `state` reçu, avec les entités BRUTES du message (pas interpolées) — met
   * à jour/crée/retire les morceaux prédits du joueur pour rester cohérent avec ce que le serveur
   * connaît réellement (nouveaux morceaux après un split, morceaux disparus après une fusion/mort/
   * absorption), puis ancre chaque morceau connu sur la vérité serveur et rejoue l'historique
   * d'inputs récent par-dessus (voir le commentaire d'en-tête).
   *
   * `estimatedLatencyMs` : estimation de la latence aller simple — détermine à partir de quel
   * instant du journal rejouer. Dérivée par l'appelant (GameView.tsx) de l'ancrage horloge de
   * `RenderEngine` (`serverTimeMsForTick`, voir renderEngine.ts et `estimatedLatencyMsFromAnchor`,
   * reconcileLatency.ts) — résolution ~20Hz, insensible à la gigue par paquet individuel — plutôt
   * que du ping mesuré (RTT/2, `GameView.tsx` `lastPingMs`/`smoothedLatencyMs`, 1Hz lissé), qui ne
   * sert plus que de repli avant le tout premier `state` de la session. Une estimation imprécise ne
   * casse rien (juste un peu plus/moins de rejeu que l'idéal), contrairement à l'ancienne approche
   * blend/snap qui accumulait une erreur systématique proportionnelle à la latence RÉELLE quelle
   * que soit la précision de l'estimation.
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
        // split OU une fusion, voir World.mergeEntities qui fait toujours naître un NOUVEL id) :
        // pas d'historique de CE morceau à rejouer, on part directement de la position serveur
        // (il rejoindra le rejeu normalement dès le `state` suivant). Vélocité autoritaire si
        // connue (voir le commentaire de `authoritativeVelocities` ci-dessus) plutôt que figée à
        // zéro : un morceau tout juste apparu peut déjà être lancé à pleine vitesse de croisière
        // (fusion de deux morceaux déjà en mouvement, éjection de split) — le forcer à zéro
        // faisait ensuite REPARTIR `step()` depuis l'arrêt (rampe d'accélération complète) pour
        // un morceau qui n'a en réalité jamais ralenti, un à-coup de décélération/ré-accélération
        // perceptible visible à chaque fusion (la caméra, qui suit la position prédite, hérite de
        // ce "lag"). `{0,0}` reste le repli pour un morceau sans vélocité connue (ancien serveur).
        this.pieces.set(entity.i, {
          position: authoritative,
          velocity: authoritativeVelocities?.get(entity.i) ?? { x: 0, y: 0 },
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
      if (knownVelocity) {
        predicted.velocity = { ...knownVelocity };
      }
      // Un Dash appliqué localement APRÈS l'instant serveur que cette vérité représente (`sinceMs`,
      // voir plus haut) n'a par construction pas encore pu être reçu/traité par le serveur —
      // `knownVelocity` (quand connue) reste alors celle d'AVANT le dash. Avant ce correctif,
      // l'impulsion n'était réappliquée que si `knownVelocity` était ABSENTE (branche `else`
      // désormais retirée) : dès que le serveur envoyait un `state` autoritaire (quasi toujours,
      // `authoritativeVelocities` est renseignée dès que `self.pieces` existe), ce `state` — même
      // produit par le serveur AVANT qu'il ait reçu l'input du dash — écrasait purement et
      // simplement la vélocité locale déjà boostée, sans jamais la restituer : le dash "revenait en
      // arrière" visuellement jusqu'au `state` suivant (retour utilisateur, Hardcore : rollback ~1
      // fois sur 2, selon qu'un tel `state` "en retard" arrivait ou non dans cette fenêtre). Réappliquée
      // ici dans TOUS les cas plutôt que seulement en l'absence de `knownVelocity` : un dash déjà
      // intégré par le serveur a `d.atMs < sinceMs`, donc filtré par `pendingDashes.filter` ci-dessous
      // — son impulsion (déjà présente dans `knownVelocity` reçue) n'est alors pas rajoutée une
      // seconde fois.
      const activeDashes = this.pendingDashes.filter((d) => d.atMs >= sinceMs);
      for (const dash of activeDashes) {
        predicted.velocity = add(predicted.velocity, dash.impulse);
      }

      for (const chunk of replayChunks) {
        this.integrate(predicted, chunk.dtSeconds, chunk.target, chunk.intensity, movement);
      }

      // Écart résiduel entre "où la prédiction en était déjà" et "où le rejeu vient de la
      // reconstruire" — le saut est absorbé dans `visualOffset`, résorbé à vitesse plafonnée par
      // `step()`, pour que l'AFFICHAGE reste continu sans désynchroniser la position simulée.
      const residual = sub(predicted.position, beforeReconcile);
      const residualDist = length(residual);
      // Seuil dynamique en-deçà duquel le résidu est pur bruit de DÉCOUPAGE TEMPOREL du rejeu,
      // jamais un vrai désaccord (voir le commentaire de RECONCILE_JITTER_TOLERANCE_TICKS) — le
      // plus grand des deux termes suivants :
      //  - biais de discrétisation pendant l'accélération (intégration fine côté client vs. un
      //    seul pas par tick côté serveur, voir `chunkHistoryForReplay`), proportionnel à
      //    l'accélération EFFECTIVE du morceau ;
      //  - bruit d'ARRONDI DE `sinceMs` À LA GRANULARITÉ DU TICK : `estimatedLatencyMs` n'est
      //    qu'une MOYENNE lissée (voir GameView.tsx `smoothedLatencyMs`), jamais exacte pour un
      //    message donné dès que la gigue réseau réelle varie — un écart de quelques ms sur
      //    `sinceMs` suffit à faire inclure/exclure un bloc ENTIER de rejeu (voir
      //    `chunkHistoryForReplay`), déplaçant le résidu d'un plein multiple de la distance
      //    parcourue en un tick à la vitesse de croisière EFFECTIVE du morceau.
      // En-dessous du plus grand des deux, on ignore purement et simplement : la position simulée
      // reprend `beforeReconcile` (aucun événement réel à refléter), sans quoi ce bruit résiduel,
      // non nul à quasiment chaque `state` reçu dès que la latence réseau varie, se traduirait en
      // une correction visuelle perceptible à la cadence du tick serveur — le tremblement du blob
      // du joueur (absent des robots/joueurs distants, jamais réconciliés).
      const tickSeconds = serverTickRateHz && serverTickRateHz > 0 ? 1 / serverTickRateHz : 1 / 30;
      const accelerationBiasPx = Math.min(
        RECONCILE_ACCEL_BIAS_MAX_PX,
        accelerationForMass(predicted.mass, movement) * tickSeconds * tickSeconds * 0.5 *
          RECONCILE_IGNORE_SAFETY_FACTOR,
      );
      // Vitesse RÉELLE du morceau (`predicted.velocity`, jusqu'à 4050px/s pendant un Dash), pas la
      // vitesse de croisière théorique dérivée de sa seule masse (`velocityForMass`) — le bruit de
      // découpage temporel du rejeu (voir le commentaire ci-dessus) est proportionnel à la distance
      // RÉELLEMENT parcourue par tick, qui explose pendant un Dash bien au-delà de cette vitesse de
      // croisière. Utiliser `velocityForMass` ici sous-estimait ce bruit d'un facteur ~15x pendant
      // un Dash (4050px/s contre ~245-300px/s de croisière) : une part de ce bruit, pourtant
      // parfaitement normal à cette vitesse, dépassait alors le seuil de tolérance ET parfois même
      // `RECONCILE_SNAP_THRESHOLD_PX` — un saut/téléportation visuelle plutôt qu'un lissage, surtout
      // sensible au tout début du Dash (vitesse au plus haut, voir retour utilisateur : "lag
      // persiste surtout à haute vitesse et au début de l'animation du dash").
      const currentSpeed = length(predicted.velocity);
      // Le plafond LARGE (`RECONCILE_JITTER_TOLERANCE_MAX_PX`, dimensionné pour la vitesse de Dash)
      // n'est accordé QU'EN régime réellement rapide — au-delà de 1.5x la vitesse de croisière du
      // morceau, donc jamais atteignable par un simple pilotage : seuls un Dash ou une éjection de
      // split y montent. Hors de ce régime, le plafond retombe sur le rayon du morceau lui-même :
      // un plafond de 220px accordé en permanence ferait ignorer, à vitesse normale, des écarts
      // bien plus grands que le blob n'est gros — c'est-à-dire de vraies corrections serveur, qui
      // ne seraient alors JAMAIS reflétées (la branche "ignorer" repose `predicted.position` sur
      // `beforeReconcile`, elle n'atténue pas, elle jette). Continu de part et d'autre du seuil :
      // le terme borné ci-dessous (`currentSpeed × tick × 1.5`) vaut lui-même moins que le rayon à
      // la vitesse de croisière, donc aucun des deux plafonds ne mord au moment de la bascule.
      const isDashing = currentSpeed > velocityForMass(predicted.mass, movement) * 1.5;
      const maxJitterPx = isDashing
        ? RECONCILE_JITTER_TOLERANCE_MAX_PX
        : Math.max(RECONCILE_IGNORE_FLOOR_PX, massToRadius(predicted.mass) * 2.5);

      const replayChunkJitterPx = Math.min(
        maxJitterPx,
        currentSpeed * tickSeconds * RECONCILE_JITTER_TOLERANCE_TICKS,
      );
      const dynamicIgnoreThresholdPx = Math.max(
        RECONCILE_IGNORE_FLOOR_PX,
        accelerationBiasPx,
        replayChunkJitterPx,
      );
      // Le seuil de lissage doit toujours rester AU-DESSUS du seuil d'ignorance dynamique
      // (`dynamicIgnoreThresholdPx`, jusqu'à ~220px pendant un Dash à pleine vitesse, voir
      // RECONCILE_JITTER_TOLERANCE_MAX_PX) — sans ce plancher dynamique, `RECONCILE_SNAP_THRESHOLD_PX`
      // (120px, dimensionné pour la vitesse de croisière hors Dash) se retrouvait EN-DESSOUS du
      // seuil d'ignorance pendant un Dash : toute correction réelle (répulsion contre un bot croisé
      // en pleine charge, typiquement) qui dépassait le bruit de découpage temporel tombait
      // directement dans la branche téléportation (aucun lissage), au lieu d'être absorbée en
      // douceur par `visualOffset` — un vrai saut/rollback visuel perceptible en dash, distinct du
      // tremblement déjà réglé par `dynamicIgnoreThresholdPx` lui-même (retour utilisateur : "lag
      // avec roll back" au dash, persistant malgré le réglage précédent de ce seuil d'ignorance).
      const snapThresholdPx = Math.max(RECONCILE_SNAP_THRESHOLD_PX, dynamicIgnoreThresholdPx * 2);
      if (residualDist <= dynamicIgnoreThresholdPx) {
        predicted.position = beforeReconcile;
      } else if (residualDist <= snapThresholdPx) {
        predicted.visualOffset = sub(predicted.visualOffset, residual);
      } else {
        // Téléportation importante (mort/respawn, bord de carte) : réinitialisation visuelle directe.
      }
    }
    this.applySelfRepulsion(movement);

    for (const id of [...this.pieces.keys()]) {
      if (!seenIds.has(id)) this.pieces.delete(id);
    }
  }

  /** Répulsion entre les propres morceaux du joueur (post-split) — miroir de la même règle
   * appliquée côté serveur (`applyRepulsion`/`onCollision`, server/src/mods/parametric/index.ts),
   * pour que les morceaux prédits localement ne s'inter-pénètrent jamais visuellement en attendant
   * le prochain `state` qui appliquerait la même correction. Appelée après `step()`/`reconcile()`,
   * jamais à l'intérieur de la boucle de sous-pas fixes de `step()` (correction géométrique
   * instantanée, pas une intégration temporelle).
   *
   * Distance de repos = CHEVAUCHEMENT PARTIEL (`restingDistanceForOverlap`,
   * `movement.mergeOverlapMinFraction`), jamais une séparation totale (`rA+rB`) : tant que deux
   * morceaux d'un même joueur coexistent, le serveur les laisse au repos partiellement superposés
   * (design voulu, pour permettre la fusion — voir `onCollision`, qui n'appelle
   * `applyRepulsion(..., restDist)` QUE quand `tryMerge` échoue, donc à chaque tick où les deux
   * morceaux coexistent encore). Viser à tort une séparation totale ici créait un residu constant
   * entre la prédiction locale (qui les repoussait à chaque frame) et l'état serveur reçu (qui les
   * laissait superposés) — perçu comme un comportement chaotique/des rebonds au lieu d'un contact
   * stable (voir l'historique de ce fichier). */
  private applySelfRepulsion(movement: MovementConfig): void {
    if (this.pieces.size <= 1) return;
    const pieceList = Array.from(this.pieces.values());
    for (let i = 0; i < pieceList.length; i++) {
      for (let j = i + 1; j < pieceList.length; j++) {
        const a = pieceList[i]!;
        const b = pieceList[j]!;
        const rA = massToRadius(a.mass);
        const rB = massToRadius(b.mass);
        const d = distance(a.position, b.position);
        const targetOverlapArea =
          Math.min(PI * rA * rA, PI * rB * rB) * movement.mergeOverlapMinFraction;
        const restDistance = restingDistanceForOverlap(rA, rB, targetOverlapArea);
        const penetration = restDistance - d;
        if (penetration > 0) {
          const dir = d > 0 ? scale(sub(a.position, b.position), 1 / d) : { x: 1, y: 0 };
          const totalMass = a.mass + b.mass;
          const moveA = penetration * 0.5 * (b.mass / totalMass);
          const moveB = penetration * 0.5 * (a.mass / totalMass);
          a.position = add(a.position, scale(dir, moveA));
          b.position = sub(b.position, scale(dir, moveB));
        }
      }
    }
  }

  /** À appeler à chaque frame de rendu (`requestAnimationFrame`), avec l'input LIVE de cette
   * frame — avance la simulation locale des morceaux du joueur à pas fixe (voir l'accumulateur
   * ci-dessous) exactement comme `onTick`/`onPlayerInput` du mod paramétrique
   * (server/src/mods/parametric/index.ts) le font côté serveur, et journalise chaque sous-pas
   * pour un rejeu ultérieur (voir `reconcile`). */
  step(dtSeconds: number, target: Vector2, intensity: number, movement: MovementConfig): void {
    if (dtSeconds <= 0) return;

    const effTarget = target;
    const effIntensity = intensity;
    // Accumulateur (voir le commentaire d'en-tête, "fix your timestep") : le `dt` réel de la frame
    // de rendu ne sert qu'à savoir COMBIEN de pas fixes exécuter, jamais comme pas d'intégration
    // lui-même — la simulation locale reste ainsi déterministe, indépendante du framerate réel.
    this.accumulatorSeconds = Math.min(this.accumulatorSeconds + dtSeconds, MAX_FRAME_SECONDS);
    // Un seul horodatage pour tous les sous-pas de CET appel — largement assez précis pour le
    // découpage `sinceMs` de `reconcile()` (granularité de plusieurs ms), et évite un appel
    // `performance.now()` par sous-pas (jusqu'à des dizaines par frame sur un gros ralentissement).
    const atMs = performance.now();
    const maxOffsetStep = VISUAL_CORRECTION_SPEED_PX_PER_S * FIXED_STEP_SECONDS;

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
    // Collisions/répulsion entre les propres morceaux du joueur (voir son commentaire) — une
    // correction géométrique de position, pas une intégration temporelle : appliquée une seule
    // fois par frame de rendu, après tous les sous-pas fixes, jamais à l'intérieur de la boucle.
    this.applySelfRepulsion(movement);
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
  applyDash(direction: Vector2, speedImpulse = 4050): void {
    for (const piece of this.pieces.values()) {
      piece.velocity = add(piece.velocity, scale(direction, speedImpulse));
    }
    this.pendingDashes.push({ atMs: performance.now(), impulse: scale(direction, speedImpulse) });
  }

  /** Indique si au moins un morceau du joueur satisfait les conditions de masse et de limite pour un split. */
  canSplit(movement?: MovementConfig): boolean {
    if (!movement || movement.splitEnabled === false) return false;
    const maxSplits = movement.maxSplits ?? 16;
    const minSplitMass = movement.minSplitMass ?? 36;
    if (this.pieces.size >= maxSplits) return false;
    for (const piece of this.pieces.values()) {
      if (piece.mass >= minSplitMass) return true;
    }
    return false;
  }

  /** Crédite immédiatement `addedMass` au morceau `pieceId` — appelé dès qu'une pastille est
   * détectée recouverte à l'écran (voir `partitionEatenFood`, client/src/render.ts), SANS attendre
   * le `state` serveur qui l'entérinera.
   *
   * Pourquoi : la pastille, elle, disparaît déjà instantanément (retrait optimiste côté client,
   * voir `RenderEngine.forgetFood`) — mais la MASSE ne l'était pas du tout, et c'est elle qui
   * porte la sensation de "manger". Avant ce correctif, la croissance du blob attendait le
   * cumul RTT/2 + un tick serveur + le buffer d'interpolation (`renderEngine.ts`) + le lissage
   * exponentiel du rayon + le lerp de zoom caméra (GameView.tsx) : ~230-280ms entre la pastille
   * qui s'efface et le blob qui grossit, perçu comme "manger n'est pas instantané" alors même que
   * la pastille disparaissait sans délai.
   *
   * Spéculatif SANS RISQUE de dérive, exactement comme la prédiction de position : `reconcile()`
   * ré-ancre `predicted.mass` sur la masse autoritaire à CHAQUE `state` reçu (voir plus haut) —
   * une pastille créditée à tort (mangée en réalité par un autre joueur au même instant, ou
   * refusée par la collision autoritaire) est donc corrigée au tick suivant, jamais accumulée.
   *
   * Ignore silencieusement un `pieceId` inconnu : `pieces` ne contient QUE les morceaux du joueur
   * local, alors que le filtrage d'affichage qui alimente cet appel vaut pour toutes les créatures
   * à l'écran (bots/adversaires compris) — leur masse reste, elle, purement serveur. */
  addPredictedMass(pieceId: string, addedMass: number): void {
    if (!(addedMass > 0)) return;
    const piece = this.pieces.get(pieceId);
    if (!piece) return;
    piece.mass += addedMass;
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
   * — soit en pilotage actif, en permanence — largement au-dessus du seuil dynamique d'ignorance
   * (voir `RECONCILE_IGNORE_MAX_PX`), corrigé en boucle par le lissage visuel (le tremblement
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
  /** Déduit immédiatement `ejectMass` du plus gros morceau du joueur local lors d'une éjection W
   * pour éviter tout décalage de masse/rayon et rollback visuel au state serveur suivant. */
  applyEject(ejectMass = 12): void {
    if (this.pieces.size === 0) return;
    let largestPiece: PredictedPiece | undefined;
    for (const piece of this.pieces.values()) {
      if (!largestPiece || piece.mass > largestPiece.mass) largestPiece = piece;
    }
    if (largestPiece && largestPiece.mass > ejectMass + 1) {
      largestPiece.mass -= ejectMass;
    }
  }

  /** Regroupe les échantillons fins de `step()` (pas `FIXED_STEP_SECONDS`, 1/240s) en blocs dont la
   * durée cumulée correspond au pas serveur (1/`serverTickRateHz`) avant rejeu — plutôt qu'un
   * `integrate()` par échantillon fin.
   *
   * TOUJOURS un seul bloc par tick, cible = DERNIER échantillon du bloc — y compris pendant un
   * virage, jamais un rejeu fin échantillon par échantillon. Une variante "préserve les sous-pas
   * pendant un virage" a été essayée (v10.1, "Smooth turn direction changes without rollback") :
   * rejouer un virage en sous-pas fins fait certes correspondre le résultat du rejeu à ce que
   * `step()` a déjà affiché EN DIRECT, mais viole exactement le principe qui justifie cette
   * fonction (voir le paragraphe suivant) — le SERVEUR, lui, n'applique jamais qu'UNE seule cible
   * par tick (celle du dernier `input` reçu), jamais un sous-pas par frame de rendu. Rejouer en
   * sous-pas fins pendant un virage compare donc `predicted.position` à une trajectoire que le
   * serveur n'a PHYSIQUEMENT JAMAIS calculée, réintroduisant précisément le biais que le
   * regroupement par tick est censé éliminer — perçu comme un tremblement/mini rollback CONTINU
   * pendant les virages (retour utilisateur, persistant malgré v10.1), pas seulement à leur
   * déclenchement. Aggravé par le fait que la détection "isTurning" d'origine comparait des
   * `target` en coordonnées MONDE ABSOLUES, qui dérivent en permanence avec la caméra (laquelle
   * suit le blob, voir `input.ts` `getTarget`, `target = camera + direction·portée`) — donc quasi
   * toujours "vraie" dès que le blob est simplement en mouvement en ligne droite, pas seulement
   * lors d'un vrai changement de cap.
   *
   * Le petit saut géométrique d'un virage mergé en un seul pas ("corde d'arc", jusqu'à 30-60px
   * selon l'ancien calibrage) reste largement dans la bande lissée par `visualOffset`
   * (`RECONCILE_SNAP_THRESHOLD_PX` >= 120px, voir `reconcile()`) — absorbé en douceur, jamais un
   * télétransport brut : exactement ce que ce lissage existe pour gérer, pas une raison de
   * sacrifier le matching du serveur, qui élimine le biais À LA SOURCE plutôt que de le maquiller
   * après coup.
   *
   * Le pas fin de `step()` lui-même n'a pas besoin de changer : c'est ce qui rend le rendu EN
   * DIRECT fluide et indépendant du framerate. Seul le REJEU doit matcher la discrétisation
   * serveur. */
  private chunkHistoryForReplay(
    samples: InputSample[],
    serverTickRateHz: number | undefined,
  ): Array<{ dtSeconds: number; target: Vector2; intensity: number }> {
    if (!serverTickRateHz || serverTickRateHz <= 0) {
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
    // Miroir exact du serveur (voir mods/parametric/index.ts `onTick`) : freinage vs mise en
    // mouvement utilisent des taux distincts (cahier des charges §4a) — sans ce miroir, la
    // prédiction locale divergerait du serveur dès qu'un gros blob relâche l'input, et
    // `reconcile()` la corrigerait en rollback visible à chaque `state` reçu.
    const isDecelerating = length(targetVelocity) < length(piece.velocity);
    const rate = isDecelerating
      ? decelerationForMass(piece.mass, movement)
      : accelerationForMass(piece.mass, movement);
    const maxChange = rate * accelIntensity * dtSeconds;
    piece.velocity = moveToward(piece.velocity, targetVelocity, maxChange);
    piece.position = add(piece.position, scale(piece.velocity, dtSeconds));

    if (movement.mapSize && movement.mapSize > 0) {
      if (movement.borderType === 'TOROIDAL') {
        const w = movement.mapSize;
        piece.position.x = ((piece.position.x % w) + w) % w;
        piece.position.y = ((piece.position.y % w) + w) % w;
      } else {
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

  /** Remplace, dans `entities` (déjà interpolées/cullées côté serveur-distant), la position ET la
   * masse/le rayon des morceaux du joueur par leurs valeurs PRÉDITES (position affichée =
   * simulation + `visualOffset`, voir le commentaire d'en-tête ; masse = dernière masse
   * autoritaire + les pastilles créditées localement depuis, voir `addPredictedMass`) — ne touche
   * à rien d'autre (couleur/propriétaire restent ceux du pipeline serveur habituel).
   *
   * La masse et le rayon DOIVENT passer par ici, sans quoi `addPredictedMass` n'aurait aucun effet
   * visible : sans cette substitution, la taille affichée du blob du joueur resterait celle du
   * pipeline serveur (interpolation + lissage exponentiel du rayon, voir renderEngine.ts), c'est-
   * à-dire précisément le retard que la prédiction de masse existe pour supprimer. Le rayon est
   * redérivé de la masse par la MÊME formule partagée que le serveur (`massToRadius`, comme
   * `applySelfRepulsion`/`integrate` ci-dessus) plutôt que mis à l'échelle à la main — aucune
   * seconde courbe à garder synchronisée. `m` est substituée en plus de `r` parce que la caméra
   * dérive son zoom de la masse (`computeCamera`/`computeScaleForMass`, render.ts) : ne corriger
   * que `r` ferait grossir le blob sans que le dézoom suive, un décalage visible entre la taille
   * du blob et le cadrage. */
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
        m: predicted.mass,
        r: massToRadius(predicted.mass),
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
  }
}
