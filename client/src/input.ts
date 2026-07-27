import type { Vector2 } from '@angulio/shared';

/** Rayon en pixels écran au-delà duquel l'intensité de déplacement est maximale (100%). En
 *-deçà, l'intensité (et donc la vitesse/accélération appliquées côté serveur) est
 * proportionnelle à la distance du curseur au centre — contrôle "analogique" plutôt que
 * tout-ou-rien. */
const CONTROL_RADIUS_PX = 300;

export interface InputTracker {
  /**
   * Vecteur de direction ET d'intensité vers le curseur : sa norme (∈ [0, 1]) encode
   * l'intensité (1 = curseur à CONTROL_RADIUS_PX ou plus du centre), sa direction encode
   * l'angle. {0,0} si le curseur est au centre de l'écran.
   */
  getInputVector(): Vector2;
  /** true une seule fois par pression de la barre espace (consommé après lecture). */
  consumeSplit(): boolean;
  /** Retire les écouteurs attachés par `attachInput` — à appeler quand le canvas associé est
   * démonté (ex. retour à l'accueil, GameView.tsx) pour ne pas accumuler d'écouteurs `keydown`
   * au fil des parties successives (chaque partie remonte un nouveau canvas). */
  detach(): void;
}

/** Le joueur vise toujours depuis le centre de son écran — cohérent avec une caméra centrée
 * sur son propre joueur (render.ts). */
export function attachInput(canvas: HTMLCanvasElement): InputTracker {
  let mouseX = canvas.width / 2;
  let mouseY = canvas.height / 2;
  let splitRequested = false;

  const onMouseMove = (event: MouseEvent): void => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') splitRequested = true;
  };

  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  return {
    getInputVector(): Vector2 {
      const dx = (mouseX - canvas.width / 2) / CONTROL_RADIUS_PX;
      const dy = (mouseY - canvas.height / 2) / CONTROL_RADIUS_PX;
      const len = Math.hypot(dx, dy);
      if (len <= 1) return { x: dx, y: dy };
      return { x: dx / len, y: dy / len }; // clampé à une norme de 1 (intensité 100%)
    },
    consumeSplit(): boolean {
      const value = splitRequested;
      splitRequested = false;
      return value;
    },
    detach(): void {
      canvas.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('keydown', onKeyDown);
    },
  };
}
