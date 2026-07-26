import type { Vector2 } from '@angulio/shared';
import type { Entity } from '../../engine/types.js';

/** État propre au mod Vanilla, attaché à `entity.data` (le moteur ne le lit jamais). */
export interface VanillaPieceState {
  inputDir: Vector2;
  /** Secondes écoulées depuis le split qui a créé ce morceau ; Infinity si jamais splitté. */
  splitElapsedS: number;
  boostRemainingS: number;
  boostDir: Vector2;
}

const KEY = 'vanilla';

function defaultState(): VanillaPieceState {
  return {
    inputDir: { x: 0, y: 0 },
    splitElapsedS: Number.POSITIVE_INFINITY,
    boostRemainingS: 0,
    boostDir: { x: 0, y: 0 },
  };
}

/** Récupère (en l'initialisant si besoin) l'état Vanilla d'un morceau. */
export function pieceState(entity: Entity): VanillaPieceState {
  const existing = entity.data[KEY] as VanillaPieceState | undefined;
  if (existing) return existing;
  const created = defaultState();
  entity.data[KEY] = created;
  return created;
}
