import type { Vector2 } from '@angulio/shared';
import type { Camera } from './render.js';

/** Rayon en pixels écran au-delà duquel l'intensité de déplacement est maximale (100%). En
 *-deçà, l'intensité (et donc la vitesse/accélération appliquées côté serveur) est
 * proportionnelle à la distance du curseur au centre — contrôle "analogique" plutôt que
 * tout-ou-rien. Indépendant de la cible visée (voir `getTarget`) : ne module que la vitesse. */
const CONTROL_RADIUS_PX = 300;
/** Magnitude minimale du stick gauche (Gamepad API) en-deçà de laquelle on l'ignore et traite
 * comme "aucune commande" (zone morte matérielle : un vrai stick n'est presque jamais à
 * exactement 0 au repos). */
const GAMEPAD_STICK_DEAD_ZONE = 0.15;
/** Bouton "split" manette — index 0 = A (Xbox) / Croix (PlayStation) dans le mapping standard
 * Gamepad API, accessible au pouce droit pendant que le gauche tient le stick de direction. */
const GAMEPAD_SPLIT_BUTTON_INDEX = 0;
/** Décalage (unités monde) simulé pour la déflexion du stick, indépendant du zoom caméra —
 * seule la DIRECTION du vecteur cible sert au-delà de la zone morte de pilotage
 * (`TARGET_DEAD_ZONE_PX`, prediction.ts) ; l'intensité (vitesse) est un scalaire séparé dérivé
 * directement de la magnitude du stick. Valeur arbitraire, juste assez grande pour ne jamais
 * retomber dans cette zone morte. */
const GAMEPAD_TARGET_OFFSET_WORLD_PX = 500;

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
 * sur son propre joueur (render.ts).
 *
 * `onSplitRequested` (optionnel) : appelé IMMÉDIATEMENT à chaque vraie pression de split (front
 * montant clavier/manette), en plus de — jamais à la place de — `consumeSplit()` (qui reste le
 * seul canal vers le réseau, lu au rythme de `scheduleInput`, voir GameView.tsx). Sert uniquement
 * de retour visuel local instantané (effet de zoom au split, demande utilisateur) : attendre le
 * prochain envoi réseau planifié (jusqu'à ~33ms à 30Hz) pour déclencher l'animation la ferait
 * démarrer perceptiblement en retard sur la pression réelle. */
export function attachInput(canvas: HTMLCanvasElement, onSplitRequested?: () => void): InputTracker {
  let mouseX = canvas.width / 2;
  let mouseY = canvas.height / 2;
  let splitRequested = false;
  /** Détection du front montant du bouton "split" manette — l'API Gamepad n'a pas d'événement,
   * seulement un état interrogé à chaque frame (voir `pollGamepad`), donc le front doit être
   * calculé nous-mêmes en comparant à l'état précédent. */
  let gamepadSplitWasPressed = false;
  let gamepadRafId: number | undefined;

  const onMouseMove = (event: MouseEvent): void => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  };
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.code === 'Space') {
      splitRequested = true;
      onSplitRequested?.();
    }
  };

  // Interrogé indépendamment de `getTarget` (potentiellement appelé plusieurs fois par frame, à
  // des cadences différentes — rendu vs envoi réseau, voir GameView.tsx) pour ne détecter le
  // front montant du bouton split qu'une seule fois par vraie pression, comme `onKeyDown`.
  function pollGamepad(): void {
    const pad = navigator.getGamepads?.().find((p) => p !== null) ?? null;
    const pressed = pad?.buttons[GAMEPAD_SPLIT_BUTTON_INDEX]?.pressed ?? false;
    if (pressed && !gamepadSplitWasPressed) {
      splitRequested = true;
      onSplitRequested?.();
    }
    gamepadSplitWasPressed = pressed;
    gamepadRafId = requestAnimationFrame(pollGamepad);
  }
  gamepadRafId = requestAnimationFrame(pollGamepad);

  canvas.addEventListener('mousemove', onMouseMove);
  window.addEventListener('keydown', onKeyDown);

  return {
    getTarget(camera: Camera): { target: Vector2; intensity: number } {
      // Manette connectée (détectée par le navigateur dès qu'un bouton/axe a été actionné une
      // première fois) : priorité totale sur la souris, y compris au repos (stick centré ->
      // cible = position actuelle, zone morte de pilotage) — un retour silencieux sur la souris
      // laisserait le curseur, potentiellement resté loin du centre ou hors canvas, imposer une
      // commande parasite dès que le stick se recentre.
      const pad = navigator.getGamepads?.().find((p) => p !== null) ?? null;
      if (pad) {
        const stickX = pad.axes[0] ?? 0;
        const stickY = pad.axes[1] ?? 0;
        const magnitude = Math.hypot(stickX, stickY);
        const intensity = magnitude >= GAMEPAD_STICK_DEAD_ZONE ? Math.min(1, magnitude) : 0;
        const direction: Vector2 =
          magnitude > 0 ? { x: stickX / magnitude, y: stickY / magnitude } : { x: 1, y: 0 };
        return {
          target: {
            x: camera.x + direction.x * GAMEPAD_TARGET_OFFSET_WORLD_PX,
            y: camera.y + direction.y * GAMEPAD_TARGET_OFFSET_WORLD_PX,
          },
          intensity,
        };
      }

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
      if (gamepadRafId !== undefined) cancelAnimationFrame(gamepadRafId);
    },
  };
}
