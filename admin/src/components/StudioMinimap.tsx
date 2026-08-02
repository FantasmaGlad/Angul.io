import type { MouseEvent, RefObject } from 'react';
import { clamp, type EntitySnapshot } from '@angulio/shared';
import { sectorForPosition, type Camera } from '@angulio/shared/render';

const MINIMAP_SIZE_PX = 160;

/** Dessine la minimap du studio sur son propre `<canvas>` — appelé IMPÉRATIVEMENT depuis la
 * boucle de rendu du studio (voir `RoomStudio.tsx`), pas par React à chaque frame (un re-rendu
 * React à 60fps pour un simple canvas serait un gaspillage, même pattern que le canvas principal).
 * Secteurs A1-C3 mutualisés avec la minimap joueur (`sectorForPosition`,
 * plan-implementation-admin.md §4.5) ; points chauds = position réelle de chaque créature
 * (joueur/bot) — pas un calcul de densité séparé, la densité visuelle EST l'info recherchée. */
export function drawMinimap(
  canvas: HTMLCanvasElement,
  entities: EntitySnapshot[],
  camera: Camera,
  mapSize: number,
  studioWidthPx: number,
  studioHeightPx: number,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx || mapSize <= 0) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  ctx.fillStyle = 'rgba(18, 20, 26, 0.9)';
  ctx.fillRect(0, 0, w, h);

  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 1;
  for (let i = 1; i < 3; i++) {
    const x = (w / 3) * i;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, h);
    ctx.stroke();
    const y = (h / 3) * i;
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(w, y);
    ctx.stroke();
  }

  ctx.fillStyle = 'rgba(96, 165, 250, 0.85)';
  for (const entity of entities) {
    if (entity.k !== 'c') continue;
    const px = (entity.x / mapSize) * w;
    const py = (entity.y / mapSize) * h;
    ctx.beginPath();
    ctx.arc(px, py, 2, 0, Math.PI * 2);
    ctx.fill();
  }

  const halfWorldW = studioWidthPx / 2 / camera.scale;
  const halfWorldH = studioHeightPx / 2 / camera.scale;
  const left = ((camera.x - halfWorldW) / mapSize) * w;
  const right = ((camera.x + halfWorldW) / mapSize) * w;
  const top = ((camera.y - halfWorldH) / mapSize) * h;
  const bottom = ((camera.y + halfWorldH) / mapSize) * h;
  ctx.strokeStyle = '#60a5fa';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(
    Math.max(0, left),
    Math.max(0, top),
    Math.min(w, right) - Math.max(0, left),
    Math.min(h, bottom) - Math.max(0, top),
  );

  const sector = sectorForPosition(clamp(camera.x, 0, mapSize), clamp(camera.y, 0, mapSize), mapSize);
  ctx.font = 'bold 11px sans-serif';
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.shadowColor = 'rgba(0, 0, 0, 0.8)';
  ctx.shadowBlur = 3;
  ctx.fillText(sector, w - 6, 4);
  ctx.shadowBlur = 0;
}

interface StudioMinimapProps {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  mapSize: number;
  onJumpToWorld: (x: number, y: number) => void;
}

/** Coin du canvas du studio — clic pour recentrer la caméra sur le point visé (§8.3
 * cahier_des_charges_admin.md). */
export default function StudioMinimap({ canvasRef, mapSize, onJumpToWorld }: StudioMinimapProps) {
  const handleClick = (event: MouseEvent<HTMLCanvasElement>): void => {
    const canvas = canvasRef.current;
    if (!canvas || mapSize <= 0) return;
    const rect = canvas.getBoundingClientRect();
    const px = (event.clientX - rect.left) / rect.width;
    const py = (event.clientY - rect.top) / rect.height;
    onJumpToWorld(px * mapSize, py * mapSize);
  };

  return (
    <div
      style={{
        position: 'absolute',
        left: 12,
        bottom: 12,
        width: MINIMAP_SIZE_PX,
        borderRadius: 'var(--radius-md)',
        overflow: 'hidden',
        border: '1px solid rgba(255,255,255,0.15)',
        boxShadow: '0 2px 10px rgba(0,0,0,0.4)',
      }}
    >
      <canvas
        ref={canvasRef}
        width={MINIMAP_SIZE_PX}
        height={MINIMAP_SIZE_PX}
        onClick={handleClick}
        style={{ display: 'block', width: '100%', height: MINIMAP_SIZE_PX, cursor: 'pointer' }}
        title="Cliquer pour recentrer la caméra"
      />
    </div>
  );
}
