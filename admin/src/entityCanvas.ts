/** Rendu Canvas partagé par "Salons & Écrans" (POV) et l'Espace Créatif — volontairement plus
 * simple que `client/src/render.ts` (pas d'interpolation entre snapshots, pas de culling
 * viewport élaboré) : un outil admin consulté ponctuellement n'a pas les mêmes exigences de
 * fluidité qu'une partie jouée en continu. */
import type { EntitySnapshot } from '@angulio/shared';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

const FOOD_COLOR = '#7dd88a';
const DEFAULT_BLOB_COLOR = '#484a6e';

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

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: EntitySnapshot[],
  camera: Camera,
  nicknames: Map<string, string>,
  colors: Map<string, string>,
  selectedPlayerId: string | undefined,
): void {
  const { width, height } = ctx.canvas;
  ctx.fillStyle = '#0e0f12';
  ctx.fillRect(0, 0, width, height);

  // Nourriture d'abord (sous les morceaux), puis morceaux — évite qu'un gros morceau soit
  // recouvert visuellement par une pastille au même endroit.
  const food = entities.filter((e) => e.k === 'f');
  const pieces = entities.filter((e) => e.k === 'c');

  for (const entity of food) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(1, entity.r * camera.scale);
    if (r < 0.5 || x < -r || x > width + r || y < -r || y > height + r) continue;
    ctx.fillStyle = FOOD_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  for (const entity of pieces) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(1, entity.r * camera.scale);
    if (x < -r || x > width + r || y < -r || y > height + r) continue;

    const isGod = entity.p?.startsWith('admin-god-') ?? false;
    const isSelected = entity.p !== undefined && entity.p === selectedPlayerId;
    ctx.fillStyle = isGod ? '#f2c94c' : (entity.p && colors.get(entity.p)) || DEFAULT_BLOB_COLOR;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    if (isSelected) {
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (entity.p && r > 8) {
      const nickname = nicknames.get(entity.p) ?? entity.p;
      ctx.fillStyle = '#ffffff';
      ctx.font = '12px sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText(nickname, x, y - r - 6);
    }
  }
}

/** Trouve le morceau de plus grand rayon sous un point écran (clic) — celui affiché "au-dessus"
 * visuellement en cas de chevauchement. `undefined` si rien sous le point. */
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
    const r = Math.max(3, entity.r * camera.scale);
    const dx = screenX - x;
    const dy = screenY - y;
    if (dx * dx + dy * dy <= r * r) {
      if (!best || entity.r > best.r) best = entity;
    }
  }
  return best;
}
