import type { Vector2 } from '@angulio/shared';

export interface InputTracker {
  /** Direction normalisée vers le curseur, {0,0} si le curseur est au centre de l'écran. */
  getDirection(): Vector2;
  /** true une seule fois par pression de la barre espace (consommé après lecture). */
  consumeSplit(): boolean;
}

/** Le joueur vise toujours depuis le centre de son écran — cohérent avec une caméra centrée
 * sur son propre joueur (render.ts). */
export function attachInput(canvas: HTMLCanvasElement): InputTracker {
  let mouseX = canvas.width / 2;
  let mouseY = canvas.height / 2;
  let splitRequested = false;

  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });

  window.addEventListener('keydown', (event: KeyboardEvent) => {
    if (event.code === 'Space') splitRequested = true;
  });

  return {
    getDirection(): Vector2 {
      const dx = mouseX - canvas.width / 2;
      const dy = mouseY - canvas.height / 2;
      const len = Math.hypot(dx, dy);
      if (len < 1) return { x: 0, y: 0 };
      return { x: dx / len, y: dy / len };
    },
    consumeSplit(): boolean {
      const value = splitRequested;
      splitRequested = false;
      return value;
    },
  };
}
