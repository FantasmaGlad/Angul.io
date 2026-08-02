/** Module caméra du rendu de jeu (P2, plan-implementation-admin.md §4.1) — jusqu'ici, ni le type
 * `Camera` ni les transforms écran↔monde n'avaient de source unique : `Camera{x,y,scale}` était
 * déclaré en double (inline dans `render.ts` et dans `admin/src/entityCanvas.ts`, deux interfaces
 * distinctes bien qu'identiques), et `computeFitCamera` vivait non-exportée et couplée au DOM dans
 * `SpectatorBackground.tsx`. Ce fichier ne remplace PAS `shared/src/camera.ts` (formule masse→zoom
 * `computeScaleForMass`, rayon d'intérêt réseau) : responsabilité différente, fichier différent. */

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

export function worldToScreen(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  worldX: number,
  worldY: number,
): { x: number; y: number } {
  return {
    x: canvasWidth / 2 + (worldX - camera.x) * camera.scale,
    y: canvasHeight / 2 + (worldY - camera.y) * camera.scale,
  };
}

export function screenToWorld(
  camera: Camera,
  canvasWidth: number,
  canvasHeight: number,
  screenX: number,
  screenY: number,
): { x: number; y: number } {
  return {
    x: camera.x + (screenX - canvasWidth / 2) / camera.scale,
    y: camera.y + (screenY - canvasHeight / 2) / camera.scale,
  };
}

/**
 * Cadre `mapSize` entier dans la bande verticale RÉELLEMENT disponible du viewport, pas le
 * viewport entier — `safeAreaTopPx`/`safeAreaBottomPx` couvrent tout ce qui recouvre visuellement
 * le canvas par-dessus (nav/footer du lobby, en-tête du studio admin...). Fonction PURE (aucune
 * lecture DOM) : chaque appelant mesure lui-même sa propre zone sûre et la passe en paramètre —
 * extrait de `SpectatorBackground.tsx` (`computeFitCamera`, qui interrogeait `.top-nav`/
 * `.bottom-bar` directement, la couplant à la mise en page du lobby joueur, inutilisable telle
 * quelle par le studio admin) sans changer le calcul lui-même.
 */
export function computeFitCamera(
  mapSize: number,
  viewportWidthPx: number,
  viewportHeightPx: number,
  safeAreaTopPx = 0,
  safeAreaBottomPx = 0,
): Camera {
  const safeHeight = Math.max(1, viewportHeightPx - safeAreaTopPx - safeAreaBottomPx);
  const fitScale = Math.min(viewportWidthPx / mapSize, safeHeight / mapSize);

  const safeCenterScreenY = safeAreaTopPx + safeHeight / 2;
  const screenCenterOffset = safeCenterScreenY - viewportHeightPx / 2;
  const cameraY = mapSize / 2 - screenCenterOffset / fitScale;

  return { x: mapSize / 2, y: cameraY, scale: fitScale };
}
