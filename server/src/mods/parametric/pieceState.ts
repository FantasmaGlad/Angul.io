import type { Vector2 } from '@angulio/shared';
import type { Entity } from '../../engine/types.js';

/** État propre au mod paramétrique, attaché à `entity.data` (le moteur ne le lit jamais). */
export interface ParametricPieceState {
  /** Position monde visée par le joueur (le curseur, converti côté client — voir
   * `PlayerInput.target`). Chaque morceau calcule sa propre direction vers ce point
   * (`inputVectorOf` dans mods/parametric/index.ts) plutôt que de partager une direction unique
   * — permet le regroupement des morceaux quand le curseur est positionné entre eux. */
  inputTarget: Vector2;
  /** Intensité de contrôle ∈ [0,1] du dernier input reçu — voir `PlayerInput.intensity`. */
  inputIntensity: number;
  /** Secondes écoulées depuis le split qui a créé ce morceau ; Infinity si jamais splitté. */
  splitElapsedS: number;
  /** Masse du morceau au moment de son dernier split — utilisée par la formule de cooldown de
   * fusion T(m) = Tbase + gamma_rec*m (config.merge.massFactor). */
  massAtSplit: number;
  /** Secondes écoulées depuis la dernière masse ingurgitée (nourriture ou joueur mangé). */
  timeSinceLastEatenS: number;
  /** Cumul de masse de nourriture mangée durant le tick courant pour plafonner le gavage. */
  foodEatenThisTick?: number;
  /** Secondes restantes avant la prochaine éjection de masse possible pour CE morceau (demande
   * utilisateur) — anti-spam (une touche maintenue/répétition clavier OS ne doit pas vider la
   * masse instantanément), pas une vraie mécanique de jeu réglable par mode. */
  ejectCooldownS: number;
  /** Rempli une fois que ce morceau a franchi le seuil d'absorption (`eatOverlapFraction`) face à
   * un adversaire — voir `beginConsumption`/`advanceConsumptions`, mods/parametric/index.ts.
   * `attackerPieceId` : le morceau qui l'absorbe (peut avoir disparu entre-temps, voir
   * `advanceConsumptions`). `massAtStart` : masse de CE morceau au moment du déclenchement (fixe
   * le taux de drain constant sur `absorptionDurationSec`, indépendant de la masse restante).
   * `gainMultiplier` : fraction de chaque tranche drainée effectivement créditée à l'attaquant
   * (1 en Vanilla, `massGainMultiplier` en Hardcore). `undefined` tant qu'aucune absorption n'est
   * en cours. Une fois posé, ne peut plus être annulé — le morceau est condamné même s'il se
   * dégage du chevauchement entre-temps (comme un vrai agar.io : l'issue est scellée dès que le
   * seuil de recouvrement est atteint, pas re-évaluée en continu). */
  consumedBy?: { attackerPieceId: string; massAtStart: number; gainMultiplier: number };
}

const KEY = 'parametric';

function defaultState(mass: number): ParametricPieceState {
  return {
    // Intensité nulle avant le premier input reçu : la cible par défaut ({0,0}) n'a alors
    // aucune influence sur la vitesse (target * intensité 0), voir `onTick`.
    inputTarget: { x: 0, y: 0 },
    inputIntensity: 0,
    splitElapsedS: Number.POSITIVE_INFINITY,
    massAtSplit: mass,
    timeSinceLastEatenS: 0,
    ejectCooldownS: 0,
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
