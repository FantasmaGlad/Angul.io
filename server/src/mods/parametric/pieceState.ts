import type { Vector2 } from '@angulio/shared';
import type { Entity } from '../../engine/types.js';

/** État propre au mod paramétrique, attaché à `entity.data` (le moteur ne le lit jamais). */
export interface ParametricPieceState {
  /** Direction ET intensité de l'input : sa norme (∈ [0,1], garantie par le client) code
   * l'intensité, sa direction normalisée code l'angle visé (voir `inputVectorOf` dans
   * mods/parametric/index.ts). */
  inputDir: Vector2;
  /** Secondes écoulées depuis le split qui a créé ce morceau ; Infinity si jamais splitté. */
  splitElapsedS: number;
  /** Masse du morceau au moment de son dernier split — utilisée par la formule de cooldown de
   * fusion T(m) = Tbase + gamma_rec*m (config.merge.massFactor). */
  massAtSplit: number;
}

const KEY = 'parametric';

function defaultState(mass: number): ParametricPieceState {
  return {
    inputDir: { x: 0, y: 0 },
    splitElapsedS: Number.POSITIVE_INFINITY,
    massAtSplit: mass,
  };
}

/** Récupère (en l'initialisant si besoin) l'état paramétrique d'un morceau. */
export function pieceState(entity: Entity): ParametricPieceState {
  const existing = entity.data[KEY] as ParametricPieceState | undefined;
  if (existing) return existing;
  const created = defaultState(entity.mass);
  entity.data[KEY] = created;
  return created;
}
