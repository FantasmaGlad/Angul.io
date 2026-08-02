/** Aide au pointage souris du Studio — `Camera`/`worldToScreen`/`screenToWorld` viennent
 * désormais de `@angulio/shared/render` (P2, plan-implementation-admin.md §4.3) : ce fichier ne
 * garde que ce qui reste réellement spécifique à l'admin (hit-testing d'un morceau sous le
 * curseur, pas nécessaire au rendu joueur). `AdminSnapshotBuffer` a disparu, remplacé par le
 * `RenderEngine` partagé (mêmes import, `@angulio/shared/render`) — plus simple, correctif de
 * facto du "stutter" périodique (§2.3) puisque c'est le même moteur d'interpolation que le jeu. */
import type { EntitySnapshot } from '@angulio/shared';
import { worldToScreen, type Camera } from '@angulio/shared/render';

/** Trouve le morceau sous le point écran. */
export function pieceAtScreenPoint(
  entities: EntitySnapshot[],
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
): EntitySnapshot | undefined {
  let best: EntitySnapshot | undefined;
  for (const entity of entities) {
    if (entity.k !== 'c') continue;
    const { x, y } = worldToScreen(camera, canvasWidth, canvasHeight, entity.x, entity.y);
    const r = Math.max(4, entity.r * camera.scale);
    const dx = screenX - x;
    const dy = screenY - y;
    if (dx * dx + dy * dy <= r * r) {
      if (!best || entity.r > best.r) best = entity;
    }
  }
  return best;
}
