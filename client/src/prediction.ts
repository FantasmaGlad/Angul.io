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
 * nouveau — pas de logique de seuil/snap séparée nécessaire. */

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
/** Repli si aucune mesure de latence n'est encore disponible (avant le premier `pong`, voir
 * GameView.tsx) — plutôt conservateur (rejoue peu) qu'agressif (rejouerait trop et re-créerait de
 * l'avance non ancrée). */
const DEFAULT_LATENCY_MS = 60;

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

      predicted.mass = entity.m;
      predicted.position = authoritative;
      for (const sample of this.history) {
        if (sample.atMs <= sinceMs) continue;
        this.integrate(predicted, sample.dtSeconds, sample.target, sample.intensity, movement);
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
    const direction = dist > 0 ? scale(offset, 1 / dist) : { x: 1, y: 0 };

    const targetVelocity = scale(direction, velocityForMass(piece.mass, movement) * intensity);
    const maxChange = accelerationForMass(piece.mass, movement) * intensity * dtSeconds;
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
