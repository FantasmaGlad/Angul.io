/** Rendu Canvas partagé par "Salons & Écrans" (POV) et l'Espace Créatif — Carte réactive haute
 * fidélité 60 FPS avec interpolation temps réel, fond grille Onyx et sprites circulaires mis en cache. */
import { SKIN_IMAGE_MAP, type EntitySnapshot } from '@angulio/shared';

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

const FOOD_COLORS_BY_MASS: Record<number, string> = {
  1: '#7dd88a', // Vert
  2: '#64b5f6', // Bleu
  3: '#ffd54f', // Jaune
  4: '#ba68c8', // Violet
  5: '#e57373', // Rouge
  6: '#ffb74d', // Orange
  7: '#f48fb1', // Rose
};

const skinImageCache = new Map<string, HTMLImageElement>();
const circularSkinCache = new Map<string, HTMLCanvasElement>();

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

/** Sprite circulaire pré-découpé sur un canvas hors-écran mis en cache (zéro ctx.clip() par frame) */
function getCircularSkinSprite(skinName: string): HTMLCanvasElement | undefined {
  const cached = circularSkinCache.get(skinName);
  if (cached) return cached;

  const img = getSkinImage(skinName);
  if (!img) return undefined;

  const size = 160;
  const sprite = document.createElement('canvas');
  sprite.width = size;
  sprite.height = size;
  const ctx = sprite.getContext('2d');
  if (!ctx) return undefined;

  const r = size / 2;
  ctx.beginPath();
  ctx.arc(r, r, r, 0, Math.PI * 2);
  ctx.clip();
  ctx.drawImage(img, 0, 0, size, size);

  circularSkinCache.set(skinName, sprite);
  return sprite;
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

/** Interpolateur d'entités léger pour 60 FPS sans saccades entre snapshots serveur (20Hz) */
export class AdminSnapshotBuffer {
  private prevEntities: EntitySnapshot[] = [];
  private currEntities: EntitySnapshot[] = [];
  private lastUpdateMs = performance.now();
  private readonly updateIntervalMs = 50; // ~20Hz serveur

  public pushSnapshot(snapshot: EntitySnapshot[]): void {
    this.prevEntities = this.currEntities.length > 0 ? this.currEntities : snapshot;
    this.currEntities = snapshot;
    this.lastUpdateMs = performance.now();
  }

  public getInterpolatedEntities(): EntitySnapshot[] {
    if (this.prevEntities.length === 0) return this.currEntities;
    const alpha = Math.min(1, Math.max(0, (performance.now() - this.lastUpdateMs) / this.updateIntervalMs));

    const prevMap = new Map<string, EntitySnapshot>();
    for (const e of this.prevEntities) prevMap.set(e.i, e);

    return this.currEntities.map((curr) => {
      const prev = prevMap.get(curr.i);
      if (!prev) return curr;

      return {
        ...curr,
        x: prev.x + (curr.x - prev.x) * alpha,
        y: prev.y + (curr.y - prev.y) * alpha,
        r: prev.r + (curr.r - prev.r) * alpha,
      };
    });
  }
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

  // 2. Grille Onyx fluide sur tout le viewport
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

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
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

  // (AUCUN RECTANGLE ROUGE BRUT)

  // 3. Séparation nourriture et créatures
  const food = entities.filter((e) => e.k === 'f');
  const pieces = entities.filter((e) => e.k === 'c');

  // 4. Rendu des pastilles de nourriture
  for (const entity of food) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(1.5, entity.r * camera.scale);
    if (x < -r || x > width + r || y < -r || y > height + r) continue;

    ctx.fillStyle = FOOD_COLORS_BY_MASS[Math.round(entity.m)] ?? '#7dd88a';
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  // 5. Rendu des Blobs de Joueurs / Bots (60 FPS avec Sprites Circulaires en Cache)
  for (const entity of pieces) {
    const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
    const r = Math.max(2, entity.r * camera.scale);
    if (x < -r || x > width + r || y < -r || y > height + r) continue;

    const pId = entity.p;
    const isGod = pId?.startsWith('admin-god-') ?? false;
    const isSelected = pId !== undefined && pId === selectedPlayerId;
    const skinName = pId ? skins.get(pId) : undefined;
    const skinSprite = skinName ? getCircularSkinSprite(skinName) : undefined;

    // Rendu du corps du blob avec sprite pré-découpé (instantané) ou couleur uni
    if (skinSprite) {
      ctx.drawImage(skinSprite, x - r, y - r, r * 2, r * 2);
    } else {
      ctx.fillStyle = isGod ? '#f59e0b' : '#3b82f6';
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bordure circulaire
    ctx.strokeStyle = isSelected ? '#60a5fa' : isGod ? '#f59e0b' : 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = isSelected ? 3 : 2;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.stroke();

    // Ring de sélection autour du blob sélectionné
    if (isSelected) {
      ctx.strokeStyle = '#60a5fa';
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(x, y, r + 6, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Pseudos + Masse
    if (pId && r > 9) {
      const rawNick = nicknames.get(pId) ?? pId;
      const isBot = pId.startsWith('bot-');
      const nick = rawNick;
      const massText = `${Math.round(entity.m)}`;

      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.textAlign = 'center';

      // Contour du texte
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.85)';
      ctx.lineWidth = 3;
      ctx.strokeText(nick, x, y - r - 8);

      ctx.fillStyle = isBot ? '#93c5fd' : '#ffffff';
      ctx.fillText(nick, x, y - r - 8);

      if (r > 18) {
        ctx.font = 'bold 11px Inter, sans-serif';
        ctx.strokeText(massText, x, y + 4);
        ctx.fillStyle = '#fde047';
        ctx.fillText(massText, x, y + 4);
      }
    }
  }
}

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
