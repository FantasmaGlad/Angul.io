import { clamp, type EntitySnapshot } from '@angulio/shared';

const BASE_SCALE = 1;
const MIN_SCALE = 0.15;
const MAX_SCALE = 2;
/** Le client n'a pas besoin de connaître M_START du mod actif : cette référence ne sert
 * qu'à calibrer le zoom, pas la simulation elle-même. */
const REFERENCE_MASS = 50;

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
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvas.width / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvas.height / 2;

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
      ctx.fillStyle = '#ffffff';
      ctx.font = `${Math.max(10, screenRadius * 0.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(nickname, screenX, screenY);
    }
  }
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
