import { BOT_COLORS, clamp, type EntitySnapshot } from '@angulio/shared';
import { ownAggregate } from './stats.js';

/** Échelle à la masse de référence : délibérément > 1 (zoomé par rapport à la taille "réelle"
 * du morceau) plutôt qu'un cadrage 1:1 — meilleur contrôle en début de partie (viser devient
 * plus précis avec un morceau qui occupe plus d'espace à l'écran), et laisse la place à la
 * sensation classique de dézoom progressif à mesure que la masse grossit (demande utilisateur). */
export const BASE_SCALE = 1.2;
const MIN_SCALE = 0.1;
/** Légèrement au-dessus de `BASE_SCALE` : laisse un peu de marge de zoom supplémentaire pour
 * les morceaux plus petits que la référence (ex. juste après un split). */
const MAX_SCALE = 1.4667;
/** Le client n'a pas besoin de connaître M_START du mod actif : cette référence ne sert
 * qu'à calibrer le zoom, pas la simulation elle-même. */
const REFERENCE_MASS = 50;

/** Pas de couleur de fond opaque : le canvas est transparent (`clearRect`, voir `renderFrame`)
 * pour laisser voir le fond "labo premium" de la page (`index.html`, partagé avec le lobby,
 * demande utilisateur) plutôt qu'un blanc plein qui le masquerait. */
const GRID_COLOR = 'rgba(17, 17, 19, 0.1)';
/** Couleur d'une particule de nourriture selon sa masse — la masse *est* le type de pellet
 * (Vert/Bleu/Jaune/Violet/Rouge/Orange/Rose, valeurs 1 à 7), transmise telle quelle par le
 * protocole existant (`EntitySnapshot.m`) : aucun champ supplémentaire nécessaire, cohérent
 * avec l'économie de bande passante du Lot 1.8 (le poids de spawn de chaque type diffère par
 * mode côté serveur, voir server/configs/*.json, mais la correspondance masse→couleur est la
 * même pour tous les modes). Couleur de repli pour toute masse qu'aucun mode connu n'utilise
 * (mod futur) plutôt que de dessiner du noir invisible. */
const FOOD_COLORS_BY_MASS: Record<number, string> = {
  1: '#3a6b35', // Vert
  2: '#3266a8', // Bleu
  3: '#c9a227', // Jaune
  4: '#7a3fa0', // Violet
  5: '#b23a2e', // Rouge
  6: '#c9702e', // Orange
  7: '#c94f8a', // Rose
};
const FOOD_COLOR_FALLBACK = '#3a6b35';
/** Masse du pellet "Multicolor" (le plus rare et le plus gros, valeur 12) — rendu à part avec
 * un dégradé plutôt qu'une couleur plate, dessiné individuellement (pas dans le chemin groupé
 * ci-dessous) : assez rare (1 à 15% selon le mode) pour ne jamais peser sur le budget de dessin
 * par frame. */
const MULTICOLOR_FOOD_MASS = 12;

/** Couleur plate d'un pellet de nourriture selon sa masse — extrait en fonction pure (plutôt que
 * de rester en ligne dans `renderFrame`) pour rester testable sans canvas/DOM. Jamais appelée
 * pour le pellet Multicolor (voir `MULTICOLOR_FOOD_MASS`, dégradé dédié). */
export function foodColorForMass(mass: number): string {
  return FOOD_COLORS_BY_MASS[mass] ?? FOOD_COLOR_FALLBACK;
}
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

export interface RenderFrameResult {
  drawCalls: number;
  batches: number;
}

/** `nicknames` : pseudo par id de joueur, appris via les messages `player` (envoyés une fois
 * par joueur plutôt que répétés sur chaque entité à chaque tick — voir plan Lot 1.8). `colors` :
 * couleur d'avatar par id de joueur (refonte UI/UX), appris de la même façon — absent pour un
 * appelant qui ne s'en sert pas (SpectatorBackground.tsx, fond décoratif anonyme). */
export function renderFrame(
  ctx: CanvasRenderingContext2D,
  canvas: HTMLCanvasElement,
  entities: EntitySnapshot[],
  camera: Camera,
  nicknames: ReadonlyMap<string, string>,
  colors?: ReadonlyMap<string, string>,
): RenderFrameResult {
  let drawCalls = 0;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvas.width / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvas.height / 2;

  drawGrid(ctx, canvas, camera, toScreenX, toScreenY);
  drawCalls++;

  const foodPathsByColor = new Map<string, Path2D>();

  for (const entity of entities) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvas.width) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvas.height) continue;

    if (entity.k === 'f') {
      if (entity.m === MULTICOLOR_FOOD_MASS) {
        drawMulticolorFood(ctx, screenX, screenY, Math.max(1, screenRadius));
        drawCalls++;
        continue;
      }
      const color = foodColorForMass(entity.m);
      let path = foodPathsByColor.get(color);
      if (!path) {
        path = new Path2D();
        foodPathsByColor.set(color, path);
      }
      path.moveTo(screenX + Math.max(1, screenRadius), screenY);
      path.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
      continue;
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, Math.max(1, screenRadius), 0, Math.PI * 2);
    ctx.fillStyle = colorFor(entity, nicknames, colors);
    ctx.fill();
    drawCalls++;

    const nickname = entity.p && nicknames.get(entity.p);
    if (nickname) {
      ctx.font = `${Math.max(10, screenRadius * 0.3)}px sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = '#ffffff';
      ctx.strokeText(nickname, screenX, screenY);
      ctx.fillStyle = '#1a1a1a';
      ctx.fillText(nickname, screenX, screenY);
      drawCalls += 2;
    }
  }

  for (const [color, path] of foodPathsByColor) {
    ctx.fillStyle = color;
    ctx.fill(path);
    drawCalls++;
  }

  return {
    drawCalls,
    batches: foodPathsByColor.size + 1,
  };
}

/** Dégradé radial arc-en-ciel pour le pellet "Multicolor" (masse 12, le plus rare et le plus
 * gros) — dessiné individuellement (chaque dégradé est lié à une position écran, impossible à
 * regrouper dans un seul `Path2D` comme les couleurs plates ci-dessus), ce qui reste sans
 * impact perceptible vu sa rareté (1 à 15% des pellets selon le mode). */
function drawMulticolorFood(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenRadius: number,
): void {
  const gradient = ctx.createRadialGradient(screenX, screenY, 0, screenX, screenY, screenRadius);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, '#ffd23a');
  gradient.addColorStop(0.6, '#ff5ca8');
  gradient.addColorStop(0.8, '#5ca8ff');
  gradient.addColorStop(1, '#7a3fa0');

  ctx.beginPath();
  ctx.arc(screenX, screenY, screenRadius, 0, Math.PI * 2);
  ctx.fillStyle = gradient;
  ctx.fill();
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

/** Couleur de repli si ni `colors` (avatar procédural, refonte UI/UX) ni `nicknames` (bot connu)
 * ne donnent de réponse — ne devrait plus arriver en pratique pour un joueur humain (le serveur
 * assigne toujours une couleur explicite à la connexion, voir connectionHandler.ts), gardé comme
 * filet de sécurité plutôt que de dessiner du noir invisible. Toujours utilisée telle quelle dans
 * le fond spectateur de l'accueil (SpectatorBackground.tsx), qui n'a jamais d'identité de joueur
 * par choix (fond décoratif anonyme, voir commentaire de ce composant). */
export const DEFAULT_BLOB_COLOR = '#253D2C';

/** Jamais appelée pour de la nourriture : `renderFrame` la dessine à part (voir `FOOD_COLOR`),
 * en un seul appel `fill` groupé plutôt qu'un par particule. Priorité : couleur d'avatar
 * explicite (compte ou pseudo, `colors`) > couleur de bot connue (`nicknames` + `BOT_COLORS`) >
 * repli fixe. */
export function colorFor(
  entity: EntitySnapshot,
  nicknames?: ReadonlyMap<string, string>,
  colors?: ReadonlyMap<string, string>,
): string {
  if (!entity.p) return '#888888';
  const explicitColor = colors?.get(entity.p);
  if (explicitColor) return explicitColor;
  const name = nicknames?.get(entity.p);
  if (name) {
    if (BOT_COLORS[name]) return BOT_COLORS[name];
    const baseName = name.split('_')[0];
    if (baseName && BOT_COLORS[baseName]) return BOT_COLORS[baseName];
  }
  return DEFAULT_BLOB_COLOR;
}
