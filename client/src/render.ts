import { clamp, type EntitySnapshot } from '@angulio/shared';
import { ownAggregate } from './stats.js';

/** Échelle à la masse de référence : délibérément > 1 (zoomé par rapport à la taille "réelle"
 * du morceau) plutôt qu'un cadrage 1:1 — meilleur contrôle en début de partie (viser devient
 * plus précis avec un morceau qui occupe plus d'espace à l'écran), et laisse la place à la
 * sensation classique de dézoom progressif à mesure que la masse grossit (demande utilisateur). */
export const BASE_SCALE = 1.8;
const MIN_SCALE = 0.15;
/** Légèrement au-dessus de `BASE_SCALE` : laisse un peu de marge de zoom supplémentaire pour
 * les morceaux plus petits que la référence (ex. juste après un split). */
const MAX_SCALE = 2.2;
/** Le client n'a pas besoin de connaître M_START du mod actif : cette référence ne sert
 * qu'à calibrer le zoom, pas la simulation elle-même. */
const REFERENCE_MASS = 50;

/** Pas de couleur de fond opaque : le canvas est transparent (`clearRect`, voir `renderFrame`)
 * pour laisser voir le fond "labo premium" de la page (`index.html`, partagé avec le lobby,
 * demande utilisateur) plutôt qu'un blanc plein qui le masquerait. */
const GRID_COLOR = 'rgba(17, 17, 19, 0.1)';
const FOOD_COLOR = '#3a6b35';
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
  const own = ownAggregate(entities, selfPlayerId);
  if (!own) return { x: fallback.x, y: fallback.y, scale: BASE_SCALE };

  const scale = clamp(BASE_SCALE / Math.sqrt(own.mass / REFERENCE_MASS), MIN_SCALE, MAX_SCALE);
  return { x: own.x, y: own.y, scale };
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
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvas.width / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvas.height / 2;

  drawGrid(ctx, canvas, camera, toScreenX, toScreenY);

  // La nourriture partage toutes la même couleur de remplissage : un seul chemin/appel `fill`
  // pour l'ensemble plutôt qu'un `beginPath`/`fill` par particule — sur une carte dense (jusqu'à
  // plusieurs centaines de particules visibles même après l'interest management du Lot 1.8),
  // ça évite l'essentiel du coût CPU par frame qui limitait le framerate perçu.
  const foodPath = new Path2D();
  let hasFood = false;

  for (const entity of entities) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvas.width) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvas.height) continue;

    if (entity.k === 'f') {
      foodPath.moveTo(screenX + Math.max(1, screenRadius), screenY);
      foodPath.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
      hasFood = true;
      continue;
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
    ctx.fillStyle = colorFor(entity);
    ctx.fill();

    const nickname = entity.p && nicknames.get(entity.p);
    if (nickname) {
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

  if (hasFood) {
    ctx.fillStyle = FOOD_COLOR;
    ctx.fill(foodPath);
  }
}

/**
 * Interpole les positions/rayons entre deux snapshots successifs reçus du serveur (20 Hz par
 * défaut, voir Room), pour un rendu fluide au taux de rafraîchissement réel de l'écran (60,
 * 120 Hz…) au lieu d'un mouvement saccadé qui saute toutes les 50 ms. `t` ∈ [0,1] : 0 = position
 * du snapshot précédent, 1 = position du dernier snapshot reçu. Une entité absente du snapshot
 * précédent (venant d'apparaître) est rendue directement à sa position actuelle, sans historique
 * à interpoler ; une entité absente du dernier snapshot (mangée/despawn) disparaît immédiatement
 * plutôt que de s'estomper — suffisant pour le MVP, pas de justification à une animation de
 * sortie pour l'instant.
 */
export function interpolateEntities(
  previous: EntitySnapshot[] | undefined,
  latest: EntitySnapshot[],
  t: number,
): EntitySnapshot[] {
  if (!previous || previous.length === 0) return latest;

  const previousById = new Map(previous.map((entity) => [entity.i, entity]));
  return latest.map((entity) => {
    const before = previousById.get(entity.i);
    if (!before) return entity;
    return {
      ...entity,
      x: before.x + (entity.x - before.x) * t,
      y: before.y + (entity.y - before.y) * t,
      r: before.r + (entity.r - before.r) * t,
    };
  });
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
 * même joueur (utile après un split) sans avoir besoin d'un état côté client. Jamais appelée
 * pour de la nourriture : `renderFrame` la dessine à part (voir `FOOD_COLOR`), en un seul
 * appel `fill` groupé plutôt qu'un par particule. */
function colorFor(entity: EntitySnapshot): string {
  if (!entity.p) return '#888888';

  let hash = 0;
  for (let i = 0; i < entity.p.length; i++) {
    hash = (hash * 31 + entity.p.charCodeAt(i)) >>> 0;
  }
  return `hsl(${hash % 360}, 70%, 55%)`;
}
