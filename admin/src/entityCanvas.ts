/** Rendu Canvas partagé par "Salons & Écrans" (POV) et l'Espace Créatif — Carte réactive haute
 * fidélité avec fond grille Onyx, bordures d'arène, textures de skins et curseurs de sélection. */
import { SKIN_IMAGE_MAP, type EntitySnapshot } from '@angulio/shared';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

const FOOD_PALETTE = [
  '#7dd88a',
  '#64b5f6',
  '#ba68c8',
  '#ffb74d',
  '#4dd0e1',
  '#e57373',
  '#aed581',
];

const skinImageCache = new Map<string, HTMLImageElement>();
function getSkinImage(skinName: string): HTMLImageElement | undefined {
  const url = SKIN_IMAGE_MAP[skinName];
  if (!url) return undefined;
  let img = skinImageCache.get(skinName);
  if (!img) {
    img = new Image();
    img.src = url;
    skinImageCache.set(skinName, img);
  }
  return img.complete && img.naturalWidth > 0 ? img : undefined;
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

export function drawEntities(
  ctx: CanvasRenderingContext2D,
  entities: EntitySnapshot[],
  camera: Camera,
  nicknames: Map<string, string>,
  skins: Map<string, string>,
  selectedPlayerId: string | undefined,
  mapSize = 3000,
): void {
  const { width, height } = ctx.canvas;

  // 1. Fond sombre Onyx Studio (#12141a)
  ctx.fillStyle = '#12141a';
  ctx.fillRect(0, 0, width, height);

  // 2. Dessiner la grille du monde de jeu (tous les 100px monde)
  const step = 100;
  const halfMap = mapSize / 2;

  const minX = Math.max(-halfMap, screenToWorld(camera, width, height, 0, 0).x);
  const maxX = Math.min(halfMap, screenToWorld(camera, width, height, width, 0).x);
  const minY = Math.max(-halfMap, screenToWorld(camera, width, height, 0, 0).y);
  const maxY = Math.min(halfMap, screenToWorld(camera, width, height, 0, height).y);

  const startGridX = Math.floor(minX / step) * step;
  const endGridX = Math.ceil(maxX / step) * step;
  const startGridY = Math.floor(minY / step) * step;
  const endGridY = Math.ceil(maxY / step) * step;

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let gx = startGridX; gx <= endGridX; gx += step) {
    const p1 = worldToScreen(camera, width, height, gx, minY);
    const p2 = worldToScreen(camera, width, height, gx, maxY);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  for (let gy = startGridY; gy <= endGridY; gy += step) {
    const p1 = worldToScreen(camera, width, height, minX, gy);
    const p2 = worldToScreen(camera, width, height, maxX, gy);
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
  }
  ctx.stroke();

  // 3. Bordures rouges lumineuses de la carte (Limites de l'arène)
  const topLeft = worldToScreen(camera, width, height, -halfMap, -halfMap);
  const bottomRight = worldToScreen(camera, width, height, halfMap, halfMap);
  const mapW = (bottomRight.x - topLeft.x);
  const mapH = (bottomRight.y - topLeft.y);

  ctx.strokeStyle = '#e53935';
  ctx.lineWidth = Math.max(2, 3 * camera.scale);
  ctx.shadowColor = 'rgba(229, 57, 53, 0.6)';
  ctx.shadowBlur = 10;
  ctx.strokeRect(topLeft.x, topLeft.y, mapW, mapH);
  ctx.shadowBlur = 0; // reset glow

  // Separate food and player pieces
  const food = entities.filter((e) => e.k === 'f');
  const pieces = entities.filter((e) => e.k === 'c');

  // 4. Dessin des pastilles de nourriture
  for (const entity of food) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(1.5, entity.r * camera.scale);
    if (x < -r || x > width + r || y < -r || y > height + r) continue;

    const colorIndex = Math.abs((Math.floor(entity.x) * 31 + Math.floor(entity.y) * 17)) % FOOD_PALETTE.length;
    ctx.fillStyle = FOOD_PALETTE[colorIndex]!;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Dessin des Blobs de Joueurs / Bots
  for (const entity of pieces) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(2, entity.r * camera.scale);
    if (x < -r || x > width + r || y < -r || y > height + r) continue;

    const pId = entity.p;
    const isGod = pId?.startsWith('admin-god-') ?? false;
    const isSelected = pId !== undefined && pId === selectedPlayerId;
    const skinName = pId ? skins.get(pId) : undefined;
    const skinImg = skinName ? getSkinImage(skinName) : undefined;

    // Ombre / Aura si sélectionné ou Dieu
    if (isSelected) {
      ctx.shadowColor = '#60a5fa';
      ctx.shadowBlur = 16;
    } else if (isGod) {
      ctx.shadowColor = '#fbbf24';
      ctx.shadowBlur = 14;
    }

    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.clip();

    // Rendu Image du Skin ou couleur uni
    if (skinImg) {
      ctx.drawImage(skinImg, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = isGod ? '#f59e0b' : '#3b82f6';
      ctx.fill();
    }
    ctx.restore();

    // Bordure circulaire du Blob
    ctx.strokeStyle = isSelected ? '#3b82f6' : isGod ? '#f59e0b' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.shadowBlur = 0; // reset

    // Ring de sélection autour du blob
    if (isSelected) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pseudos + Masse
    if (pId && r > 10) {
      const rawNick = nicknames.get(pId) ?? pId;
      const isBot = pId.startsWith('bot-');
      const nick = isBot ? `${rawNick}` : rawNick;
      const massText = `${Math.round(entity.m)}`;

      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';

      // Outline texte pour lisibilité
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.8)';
      ctx.lineWidth = 3;
      ctx.strokeText(nick, x, y - r - 8);

      ctx.fillStyle = isBot ? '#93c5fd' : '#ffffff';
      ctx.fillText(nick, x, y - r - 8);

      if (r > 20) {
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.strokeText(massText, x, y + 4);
        ctx.fillStyle = '#fde047';
        ctx.fillText(massText, x, y + 4);
      }
    }
  }
}

/** Trouve le morceau de plus grand rayon sous un point écran (clic). */
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
