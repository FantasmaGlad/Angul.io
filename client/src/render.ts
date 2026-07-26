import { clamp, type EntitySnapshot } from '@angulio/shared';

const BASE_SCALE = 1;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2;
/** Le client n'a pas besoin de connaître M_START du mod actif : cette référence ne sert
 * qu'à calibrer le zoom, pas la simulation elle-même. */
const REFERENCE_MASS = 50;

const BACKGROUND_COLOR = '#ffffff';
const GRID_COLOR = '#e3e3e3';
/** Espacement de la grille en pixels *monde* (donc fixe quel que soit le zoom, comme des
 * carreaux de papier millimétré vus de plus ou moins loin). */
const GRID_SPACING_WORLD_PX = 100;

export interface Camera {
  x: number;
  y: number;
  scale: number;
}

/** Centre la caméra sur le barycentre (pondéré par la masse) des morceaux du joueur, et
 * dézoome à mesure que sa masse totale augmente (comportement Agar.io classique). */
export function computeCamera(
  entities: EntitySnapshot[],
  selfPlayerId: string | undefined,
  fallback: { x: number; y: number },
): Camera {
  const ownPieces = entities.filter((entity) => entity.p === selfPlayerId);
  if (ownPieces.length === 0) {
    return { x: fallback.x, y: fallback.y, scale: BASE_SCALE };
  }

  let totalMass = 0;
  let x = 0;
  let y = 0;
  for (const piece of ownPieces) {
    totalMass += piece.m;
    x += piece.x * piece.m;
    y += piece.y * piece.m;
  }

  const scale = clamp(BASE_SCALE / Math.sqrt(totalMass / REFERENCE_MASS), MIN_SCALE, MAX_SCALE);
  return { x: x / totalMass, y: y / totalMass, scale };
}

/** `nicknames` : pseudo par id de joueur, appris via les messages `player` (envoyés une fois
 * par joueur plutôt que répétés sur chaque entité à chaque tick — voir plan Lot 1.8). */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  entities: EntitySnapshot[],
  camera: Camera,
  nicknames: ReadonlyMap<string, string>,
): void {
  ctx.fillStyle = BACKGROUND_COLOR;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvas.width / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvas.height / 2;

  drawGrid(ctx, canvas, camera, toScreenX, toScreenY);

  for (const entity of entities) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvas.width) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvas.height) continue;

    ctx.beginPath();
    ctx.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
    ctx.fillStyle = colorFor(entity);
    ctx.fill();

    const nickname = entity.p && nicknames.get(entity.p);
    if (entity.k === 'c' && nickname) {
      ctx.font = `${Math.max(10, screenRadius * 0.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      // Contour blanc + remplissage sombre : lisible sur fond blanc *et* sur les couleurs
      // vives des morceaux, sans avoir à connaître la couleur exacte du morceau au-dessous.
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(nickname, screenX, screenY);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(nickname, screenX, screenY);
    }
  }
}

/** Grille façon papier millimétré, en espace monde (donc fixe visuellement quel que soit le
 * zoom) — repère de déplacement et d'échelle sur le fond blanc. */
function drawGrid(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  camera: Camera,
  toScreenX: (x: number) => number,
  toScreenY: (y: number) => number,
): void {
  const worldLeft = camera.x - canvas.width / 2 / camera.scale;
  const worldRight = camera.x + canvas.width / 2 / camera.scale;
  const worldTop = camera.y - canvas.height / 2 / camera.scale;
  const worldBottom = camera.y + canvas.height / 2 / camera.scale;

  const firstX = Math.floor(worldLeft / GRID_SPACING_WORLD_PX) * GRID_SPACING_WORLD_PX;
  const firstY = Math.floor(worldTop / GRID_SPACING_WORLD_PX) * GRID_SPACING_WORLD_PX;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = firstX; x <= worldRight; x += GRID_SPACING_WORLD_PX) {
    const screenX = toScreenX(x);
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, canvas.height);
  }
  for (let y = firstY; y <= worldBottom; y += GRID_SPACING_WORLD_PX) {
    const screenY = toScreenY(y);
    ctx.moveTo(0, screenY);
    ctx.lineTo(canvas.width, screenY);
  }

  ctx.stroke();
}

/** Couleur déterministe à partir de l'id du propriétaire — stable entre les morceaux d'un
 * même joueur (utile après un split) sans avoir besoin d'un état côté client. */
function colorFor(entity: EntitySnapshot): string {
  if (entity.k === 'f') return '#3a6b35';
  if (!entity.p) return '#888888';

  let hash = 0;
  for (let i = 0; i < entity.p.length; i++) {
    hash = (hash * 31 + entity.p.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 70%, 55%)`;
}
