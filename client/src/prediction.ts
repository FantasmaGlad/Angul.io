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

/** Prédiction locale du blob du joueur + réconciliation douce avec l'état autoritaire du serveur
 * (plan_performance_reseau.md Phase 1). Sans ce module, le blob du joueur suit le même pipeline
 * retardé que les entités distantes (buffer d'interpolation, voir renderEngine.ts) : ~100-150ms
 * de latence structurelle entre "je bouge la souris" et "je vois le blob réagir", même en LAN.
 *
 * Principe (identique au netcode agar.io/FPS/MOBA) : le client rejoue localement, à chaque frame,
 * exactement la même formule de mouvement que le serveur (`moveToward` + accélération/vitesse
 * dépendantes de la masse, voir shared/src/movement.ts) pour chacun de ses PROPRES morceaux —
 * donc réagit à l'input sans attendre l'aller-retour réseau. Quand un `state` autoritaire arrive,
 * l'écart entre position prédite et position réelle est comblé progressivement (léger correctif
 * étalé sur quelques frames) plutôt que par un saut — sauf écart important (split, fusion,
 * collision, mangé…), où un recalage immédiat est moins visible qu'une correction lente sur un
 * événement réellement discontinu.
 *
 * Volontairement limité au déplacement en vol libre : ni les collisions/répulsions entre
 * morceaux, ni le split lui-même (nouvelle pièce, vitesse d'éjection), ni la perte passive de
 * masse ne sont prédits ici — ces événements restent entièrement dictés par le serveur et
 * n'apparaissent qu'à la réception du `state` qui les contient (comme avant ce module). C'est un
 * compromis délibéré : l'essentiel de la sensation de latence vient du pilotage (diriger vers le
 * curseur), pas de ces événements ponctuels, et les prédire fidèlement dupliquerait des règles de
 * jeu (avantage de masse, cooldown de fusion, bords de carte…) avec un vrai risque de désync
 * silencieuse. */

interface PredictedPiece {
  position: Vector2;
  velocity: Vector2;
  mass: number;
}

/** Écart (px) au-delà duquel la position prédite est recalée immédiatement plutôt que corrigée en
 * douceur — au-delà de ce seuil, l'écart vient presque certainement d'un événement discontinu
 * (split, fusion, collision, bord de carte) que ce module ne prédit pas, pas d'une simple dérive
 * de trajectoire. */
const RECONCILE_SNAP_THRESHOLD_PX = 120;
/** Fraction de l'écart comblée à chaque `state` reçu (~toutes les 33ms à 30Hz) en-dessous du seuil
 * ci-dessus — assez rapide pour rester imperceptible, assez doux pour ne jamais créer de
 * micro-saut visible. */
const RECONCILE_BLEND_FACTOR = 0.25;

export class LocalPrediction {
  private readonly pieces = new Map<string, PredictedPiece>();

  /** À appeler à chaque `state` reçu, avec les entités BRUTES du message (pas interpolées) — met
   * à jour/crée/retire les morceaux prédits du joueur pour rester cohérent avec ce que le serveur
   * connaît réellement (nouveaux morceaux après un split, morceaux disparus après une fusion/mort/
   * absorption). */
  reconcile(entities: EntitySnapshot[], selfPlayerId: string): void {
    const seenIds = new Set<string>();
    for (const entity of entities) {
      if (entity.k !== 'c' || entity.p !== selfPlayerId) continue;
      seenIds.add(entity.i);

      const authoritative: Vector2 = { x: entity.x, y: entity.y };
      const predicted = this.pieces.get(entity.i);
      if (!predicted) {
        // Morceau inconnu (premier `state` de la vie, ou apparu ce tick — ex. juste après un
        // split) : pas d'historique à corriger, on part directement de la position serveur.
        this.pieces.set(entity.i, { position: authoritative, velocity: { x: 0, y: 0 }, mass: entity.m });
        continue;
      }

      predicted.mass = entity.m;
      const error = sub(authoritative, predicted.position);
      if (length(error) > RECONCILE_SNAP_THRESHOLD_PX) {
        predicted.position = authoritative;
      } else {
        predicted.position = add(predicted.position, scale(error, RECONCILE_BLEND_FACTOR));
      }
    }

    for (const id of [...this.pieces.keys()]) {
      if (!seenIds.has(id)) this.pieces.delete(id);
    }
  }

  /** À appeler à chaque frame de rendu (`requestAnimationFrame`), avec l'input courant — avance
   * la simulation locale des morceaux du joueur exactement comme `onTick`/`onPlayerInput` du mod
   * paramétrique (server/src/mods/parametric/index.ts) le font côté serveur. */
  step(dtSeconds: number, target: Vector2, intensity: number, movement: MovementConfig): void {
    if (dtSeconds <= 0 || this.pieces.size === 0) return;

    for (const piece of this.pieces.values()) {
      const offset = sub(target, piece.position);
      const dist = length(offset);
      const direction = dist > 0 ? scale(offset, 1 / dist) : { x: 1, y: 0 };

      const targetVelocity = scale(direction, velocityForMass(piece.mass, movement) * intensity);
      const maxChange = accelerationForMass(piece.mass, movement) * intensity * dtSeconds;
      piece.velocity = moveToward(piece.velocity, targetVelocity, maxChange);
      piece.position = add(piece.position, scale(piece.velocity, dtSeconds));
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
   * pendant l'écran de mort. */
  reset(): void {
    this.pieces.clear();
  }
}
