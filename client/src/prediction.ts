import {
  accelerationForMass,
  add,
  length,
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
 * c'est-à-dire précisément quand un événement non rejouable (répulsion, croissance) l'a produit. */

interface PredictedPiece {
  position: Vector2;
  velocity: Vector2;
  mass: number;
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
/** Fraction de l'écart résiduel comblée à chaque `state` reçu (~30Hz) en-dessous du seuil ci-dessus
 * — assez rapide pour rester imperceptible sur un nudge de répulsion typique (quelques px), assez
 * doux pour ne jamais recréer de micro-saut. */
const RECONCILE_BLEND_FACTOR = 0.35;

export class LocalPrediction {
  private readonly pieces = new Map<string, PredictedPiece>();
  private readonly history: InputSample[] = [];

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
   * latence RÉELLE quelle que soit la précision de l'estimation. */
  reconcile(
    entities: EntitySnapshot[],
    selfPlayerId: string,
    movement: MovementConfig,
    estimatedLatencyMs: number = DEFAULT_LATENCY_MS,
  ): void {
    const nowMs = performance.now();
    this.pruneHistory(nowMs);
    const sinceMs = nowMs - Math.max(0, estimatedLatencyMs);

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
        this.pieces.set(entity.i, { position: authoritative, velocity: { x: 0, y: 0 }, mass: entity.m });
        continue;
      }

      const beforeReconcile = predicted.position;
      predicted.mass = entity.m;
      predicted.position = authoritative;
      for (const sample of this.history) {
        if (sample.atMs <= sinceMs) continue;
        this.integrate(predicted, sample.dtSeconds, sample.target, sample.intensity, movement);
      }

      // Écart résiduel entre "où la prédiction en était déjà" et "où le rejeu vient de la
      // reconstruire" — nul dans le cas normal (rien à lisser), non nul seulement quand un
      // événement non rejoué (répulsion, croissance...) a réellement déplacé le morceau côté
      // serveur depuis le dernier `state` connu. Voir RECONCILE_SNAP_THRESHOLD_PX.
      const residual = sub(predicted.position, beforeReconcile);
      const residualDist = length(residual);
      if (residualDist > 0 && residualDist <= RECONCILE_SNAP_THRESHOLD_PX) {
        predicted.position = add(beforeReconcile, scale(residual, RECONCILE_BLEND_FACTOR));
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

    const atMs = performance.now();
    this.history.push({ atMs, dtSeconds, target, intensity });
    this.pruneHistory(atMs);

    if (this.pieces.size === 0) return;
    for (const piece of this.pieces.values()) {
      this.integrate(piece, dtSeconds, target, intensity, movement);
    }
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
    const effectiveIntensity = inDeadZone ? 0 : intensity;
    // `accelIntensity` reste à 1 dans la zone morte (au lieu de suivre `effectiveIntensity`) :
    // sinon `maxChange` tombe aussi à 0 et `moveToward` fige la vélocité résiduelle au lieu de la
    // laisser décélérer vers 0 — c'était le tremblotement du blob (dérive à vitesse constante,
    // ressort de la zone, y rentre, se fige à nouveau...). Voir le commentaire miroir côté serveur.
    const accelIntensity = inDeadZone ? 1 : intensity;

    const targetVelocity = scale(direction, velocityForMass(piece.mass, movement) * effectiveIntensity);
    const maxChange = accelerationForMass(piece.mass, movement) * accelIntensity * dtSeconds;
    piece.velocity = moveToward(piece.velocity, targetVelocity, maxChange);
    piece.position = add(piece.position, scale(piece.velocity, dtSeconds));
  }

  private pruneHistory(nowMs: number): void {
    const cutoff = nowMs - HISTORY_WINDOW_MS;
    while (this.history.length > 0 && this.history[0]!.atMs < cutoff) {
      this.history.shift();
    }
  }

  /** Remplace, dans `entities` (déjà interpolées/cullées côté serveur-distant), la position des
   * morceaux du joueur par leur position prédite — ne touche à rien d'autre (rayon/masse/couleur
   * restent ceux du pipeline serveur habituel, voir le commentaire d'en-tête). */
  applyTo(entities: EntitySnapshot[], selfPlayerId: string): EntitySnapshot[] {
    if (this.pieces.size === 0) return entities;
    return entities.map((entity) => {
      if (entity.k !== 'c' || entity.p !== selfPlayerId) return entity;
      const predicted = this.pieces.get(entity.i);
      if (!predicted) return entity;
      return { ...entity, x: predicted.position.x, y: predicted.position.y };
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
      x += piece.position.x * piece.mass;
      y += piece.position.y * piece.mass;
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
