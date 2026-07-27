import type { Vector2 } from '@angulio/shared';
import type { Camera } from './render.js';

/** Rayon en pixels écran au-delà duquel l'intensité de déplacement est maximale (100%). En
 *-deçà, l'intensité (et donc la vitesse/accélération appliquées côté serveur) est
 * proportionnelle à la distance du curseur au centre — contrôle "analogique" plutôt que
 * tout-ou-rien. Indépendant de la cible visée (voir `getTarget`) : ne module que la vitesse. */
const CONTROL_RADIUS_PX = 300;

export interface InputTracker {
  /**
   * Position du curseur convertie en coordonnées monde (via la caméra courante) + intensité de
   * contrôle ∈ [0,1] (distance au centre de l'écran, plafonnée à `CONTROL_RADIUS_PX`). Envoyé
   * tel quel au serveur (`PlayerInput`) : chaque morceau du joueur calcule sa propre direction
   * vers cette cible plutôt que de partager une direction unique — un curseur positionné entre
   * plusieurs morceaux les fait donc converger (regroupement) au lieu de tous partir dans la
   * même direction relative.
   */
  getTarget(camera: Camera): { target: Vector2; intensity: number };
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
    getTarget(camera: Camera): { target: Vector2; intensity: number } {
      const dx = mouseX - canvas.width / 2;
      const dy = mouseY - canvas.height / 2;
      const intensity = Math.min(1, Math.hypot(dx, dy) / CONTROL_RADIUS_PX);
      // Écran -> monde : inverse de `toScreenX`/`toScreenY` (render.ts) — le curseur au centre
      // de l'écran correspond au centre de la caméra (grossièrement la position du joueur).
      const target: Vector2 = {
        x: camera.x + dx / camera.scale,
        y: camera.y + dy / camera.scale,
      };
      return { target, intensity };
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
