import { clamp, DEFAULT_SKIN, isBotId, SKIN_IMAGE_MAP, skinForNickname, type EntitySnapshot } from '@angulio/shared';
import { ownAggregate } from './stats.js';

const skinImageCache = new Map<string, HTMLImageElement>();

export function getSkinImage(skinId: string): HTMLImageElement | null {
  const url =
    SKIN_IMAGE_MAP[skinId] ??
    (skinId.startsWith('/') ? skinId : `/assets/Profil/${skinId}.png`);
  let img = skinImageCache.get(url);
  if (!img && typeof Image !== 'undefined') {
    img = new Image();
    img.src = url;
    skinImageCache.set(url, img);
  }
  return img && img.complete && img.naturalWidth !== 0 ? img : null;
}

/** Résolution du sprite pré-détouré (voir `getCircularSkinImage`) — fixe, indépendante du rayon
 * réellement affiché à l'écran (`drawImage` la redimensionne ensuite) : assez grande pour rester
 * nette même sur un très gros morceau plein écran, sans reconstruire le sprite à chaque
 * changement de zoom. */
const CIRCULAR_SPRITE_SIZE_PX = 160;
const circularSkinCache = new Map<string, HTMLCanvasElement>();

/** Version pré-détourée en cercle (canvas hors-écran, calculée une seule fois par skin puis mise
 * en cache) d'une image de skin — évite un `ctx.save()`/`ctx.clip()`/`ctx.restore()` par morceau
 * et par frame dans `renderFrame` : le clipping est l'une des opérations Canvas2D les plus
 * coûteuses, et avec ~50 joueurs + bots skinnés simultanément visibles, ce coût par-entité par
 * frame était la cause principale des saccades FPS observées en jeu (contrairement à l'accueil,
 * qui affiche surtout de la nourriture sans image). Le cercle occupe tout le carré du sprite
 * (bord à bord) : `drawImage` peut ensuite l'étirer à n'importe quel rayon écran sans reclipper,
 * le résultat reste visuellement un cercle plein. */
function getCircularSkinImage(skinId: string): HTMLCanvasElement | null {
  const cached = circularSkinCache.get(skinId);
  if (cached) return cached;

  const source = getSkinImage(skinId);
  if (!source) return null;

  const sprite = document.createElement('canvas');
  sprite.width = CIRCULAR_SPRITE_SIZE_PX;
  sprite.height = CIRCULAR_SPRITE_SIZE_PX;
  const spriteCtx = sprite.getContext('2d');
  if (!spriteCtx) return null;

  const radius = CIRCULAR_SPRITE_SIZE_PX / 2;
  spriteCtx.beginPath();
  spriteCtx.arc(radius, radius, radius, 0, Math.PI * 2);
  spriteCtx.clip();
  spriteCtx.drawImage(source, 0, 0, CIRCULAR_SPRITE_SIZE_PX, CIRCULAR_SPRITE_SIZE_PX);

  circularSkinCache.set(skinId, sprite);
  return sprite;
}

export function colorForSkinFallback(skinId: string): string {
  if (skinId.startsWith('#')) return skinId;
  const map: Record<string, string> = {
    'Baamix LSD': '#FFE135',
    'Banane Épic': '#FFC300',
    Calamoche: '#40A9FF',
    Monstera: '#2E8B57',
    'Mouche Moche': '#9254DE',
    'Pieuvre Défoncée': '#7A3FA0',
    Radiateur: '#9254DE',
    Robibou: '#E05A47',
    Scoobi: '#C9702E',
    Skibidi: '#B23A2E',
    'Souris Parapluis': '#73D13D',
  };
  return map[skinId] ?? '#3a6b35';
}

/** Échelle à la masse de référence : délibérément > 1 (zoomé par rapport à la taille "réelle"
 * du morceau) plutôt qu'un cadrage 1:1 — meilleur contrôle en début de partie (viser devient
 * plus précis avec un morceau qui occupe plus d'espace à l'écran), et laisse la place à la
 * sensation classique de dézoom progressif à mesure que la masse grossit (demande utilisateur).
 * Divisée par 1.5 (÷1.5 = dézoom de base +50%, demande utilisateur) par rapport à la valeur
 * d'origine (1.44) — combinée à la taille de départ des morceaux réduite de moitié
 * (shared/geometry.ts `massToRadius`), la carte perçue est plus vaste/spacieuse dès le début
 * d'une partie. */
export const BASE_SCALE = 1.44 / 2.25;
const MIN_SCALE = 0.1;
/** Légèrement au-dessus de `BASE_SCALE` : laisse un peu de marge de zoom supplémentaire pour
 * les morceaux plus petits que la référence (ex. juste après un split). */
const MAX_SCALE = 1.76 / 2.25;
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

/** Marge (en pixels *monde*) ajoutée autour du viewport pour le culling — évite qu'une entité en
 * bordure d'écran apparaisse/disparaisse brutalement (sans interpolation) au moindre mouvement de
 * caméra. */
const CULL_MARGIN_WORLD_PX = 800;

/**
 * Filtre les entités à celles réellement utiles à cette frame (les morceaux du joueur, toujours
 * gardés pour `computeCamera`/les stats, + tout ce qui retombe dans le viewport élargi d'une
 * marge) — appelé *avant* `interpolateEntities`, qui alloue un nouvel objet par entité à chaque
 * frame (jusqu'à ~60-240 fois/seconde selon le plafond FPS). Le serveur peut envoyer des milliers
 * d'entités dans le rayon d'intérêt réseau (bien plus large que ce qu'un écran zoomé affiche
 * réellement) ; sans ce filtre, tout ce volume est interpolé et parcouru à chaque frame de rendu
 * alors que `renderFrame` culle de toute façon avant de dessiner — un gaspillage de CPU/GC qui
 * contribue aux pics de lag observés (plus le nombre d'entités visibles par le serveur grossit,
 * ex. joueur de grosse masse ou zone dense en nourriture, plus le coût par frame grossit avec lui,
 * indépendamment de ce que l'écran peut effectivement montrer).
 */
export function cullEntitiesForViewport(
  entities: EntitySnapshot[],
  camera: Camera,
  viewportWidth: number,
  viewportHeight: number,
  selfPlayerId: string | undefined,
  marginWorldPx: number = CULL_MARGIN_WORLD_PX,
): EntitySnapshot[] {
  const halfWidthWorld = viewportWidth / 2 / camera.scale + marginWorldPx;
  const halfHeightWorld = viewportHeight / 2 / camera.scale + marginWorldPx;
  const left = camera.x - halfWidthWorld;
  const right = camera.x + halfWidthWorld;
  const top = camera.y - halfHeightWorld;
  const bottom = camera.y + halfHeightWorld;

  return entities.filter((entity) => {
    if (selfPlayerId !== undefined && entity.p === selfPlayerId) return true;
    return (
      entity.x + entity.r >= left &&
      entity.x - entity.r <= right &&
      entity.y + entity.r >= top &&
      entity.y - entity.r <= bottom
    );
  });
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
  selfPlayerId?: string,
): RenderFrameResult {
  let drawCalls = 0;
  // Taille CSS ("logique"), pas `canvas.width/height` (la résolution physique de dessin, voir
  // GameView.tsx `resizeCanvas` — peut valoir `dpr` fois plus sur un écran HiDPI/Retina) : tout
  // ce module raisonne en coordonnées CSS-pixel, compensées vers la résolution physique par
  // `ctx.setTransform(dpr, ...)` posé une fois au resize. `clientWidth`/`clientHeight` restent
  // corrects pour SpectatorBackground.tsx aussi (pas de traitement DPR là, donc identiques à
  // `canvas.width/height` dans ce cas).
  const canvasWidth = canvas.clientWidth;
  const canvasHeight = canvas.clientHeight;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvasWidth / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvasHeight / 2;

  drawGrid(ctx, canvas, camera, toScreenX, toScreenY);
  drawCalls++;

  // Récupération des créatures pour la disparition instantanée des pastilles dès la collision à 5%
  const creatures = entities.filter((e) => e.k === 'c');

  const visibleEntities = entities.filter((entity) => {
    if (entity.k !== 'f') return true;
    for (const c of creatures) {
      const dx = entity.x - c.x;
      const dy = entity.y - c.y;
      const hitRadius = c.r * 1.05 + entity.r;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        return false; // Disparition instantanée sans animation dès l'impact
      }
    }
    return true;
  });

  const foodEntities = visibleEntities.filter((e) => e.k === 'f');
  const foodPathsByColor = new Map<string, Path2D>();

  // Couche 1 : Rendu de la nourriture (sous les joueurs)
  for (const entity of foodEntities) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvasWidth) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvasHeight) continue;

    const foodRadius = Math.max(1, screenRadius);
    if (entity.m === MULTICOLOR_FOOD_MASS) {
      drawMulticolorFood(ctx, screenX, screenY, foodRadius);
      drawCalls++;
      continue;
    }
    const color = foodColorForMass(entity.m);
    let path = foodPathsByColor.get(color);
    if (!path) {
      path = new Path2D();
      foodPathsByColor.set(color, path);
    }
    path.moveTo(screenX + foodRadius, screenY);
    path.arc(screenX, screenY, foodRadius, 0, Math.PI * 2);
  }

  for (const [color, path] of foodPathsByColor) {
    ctx.fillStyle = color;
    ctx.fill(path);
    drawCalls++;
  }

  // Couche 2 : Rendu des créatures/joueurs triés par masse CROISSANTE (le plus gros au-dessus)
  const sortedCreatures = visibleEntities
    .filter((e) => e.k === 'c')
    .sort((a, b) => a.m - b.m);

  for (const entity of sortedCreatures) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvasWidth) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvasHeight) continue;

    const skinId = colorFor(entity, nicknames, colors);
    const radius = Math.max(1, screenRadius);
    const circularImg = getCircularSkinImage(skinId);

    if (circularImg) {
      // Position/rayon ARRONDIS au pixel entier, uniquement pour ce `drawImage` (le cercle de
      // contour et le texte juste en-dessous gardent leurs coordonnées sous-pixel intactes) —
      // `screenX`/`screenY`/`radius` sont des flottants qui varient légèrement à CHAQUE frame
      // (lerp de caméra, interpolation réseau), même pour un blob immobile en coordonnées monde.
      // Une image détaillée (avatar) rééchantillonnée par le filtrage bilinéaire du canvas à une
      // phase sous-pixel différente à chaque frame "grouille"/tremble visiblement, alors qu'un
      // simple aplat de couleur (cercle, texte) n'a pas ce problème (rien à rééchantillonner).
      // Ancrer le rectangle de destination sur des entiers stabilise cette phase d'une frame à
      // l'autre tant que la position/taille réelle n'a pas assez bougé pour changer de pixel —
      // le blob et sa croissance restent visuellement fluides, seul le grouillement disparaît.
      const drawCenterX = Math.round(screenX);
      const drawCenterY = Math.round(screenY);
      const drawRadius = Math.round(radius);
      ctx.drawImage(
        circularImg,
        drawCenterX - drawRadius,
        drawCenterY - drawRadius,
        drawRadius * 2,
        drawRadius * 2,
      );
    } else {
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = colorForSkinFallback(skinId);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
    ctx.lineWidth = Math.max(1, radius * 0.04);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.2)';
    ctx.stroke();
    drawCalls++;

    const nickname = entity.p && nicknames.get(entity.p);
    // Le pseudo n'est affiché qu'au-delà de 100 de masse (demande utilisateur) — un tout petit
    // morceau (juste après un split, ou en fin de vie) ne l'affiche plus, mais garde son label de
    // masse perso ci-dessous si c'est le morceau du joueur lui-même.
    const showNickname = Boolean(nickname) && entity.m >= 100;
    if (showNickname) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = isBotId(entity.p!)
        ? botNicknameFontSizePx(ctx, nickname!, screenRadius)
        : Math.max(10, screenRadius * 0.3);
      ctx.font = `normal ${fontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillText(nickname!, screenX, screenY);
      drawCalls++;

      if (selfPlayerId && entity.p === selfPlayerId) {
        const massFontSize = Math.max(9, fontSize * 0.7);
        ctx.font = `normal ${massFontSize}px sans-serif`;
        ctx.fillText(String(Math.floor(entity.m)), screenX, screenY + fontSize * 0.85);
        drawCalls++;
      }
    } else if (selfPlayerId && entity.p === selfPlayerId) {
      const massFontSize = Math.max(9, screenRadius * 0.3 * 0.7);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `normal ${massFontSize}px sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.shadowColor = 'transparent';
      ctx.shadowBlur = 0;
      ctx.fillText(String(Math.floor(entity.m)), screenX, screenY);
      drawCalls++;
    }
  }

  return {
    drawCalls,
    batches: foodPathsByColor.size + 1,
  };
}

/** Taille de police plancher pour un pseudo de bot — en-deçà, le texte devient illisible ; sur un
 * tout petit morceau on accepte alors un léger débordement plutôt qu'un texte invisible. */
const BOT_NICKNAME_MIN_FONT_PX = 6;
/** Point de départ avant ajustement à la largeur réelle du pseudo (`ctx.measureText`) — un
 * multiplicateur fixe du rayon ne suffit pas : les pseudos de robots vont de 2 à ~12 caractères
 * (voir BOT_IDENTITIES, ex. "Or" contre "Lapis-Lazuli"), un pseudo long déborderait du cercle à
 * taille fixe. */
const BOT_NICKNAME_START_FONT_RATIO = 0.32;

/** Calcule la taille de police (px) qui fait tenir `nickname` dans le cercle du bot (diamètre
 * `screenRadius * 2`, avec une marge pour ne pas toucher le bord) — mesuré via `ctx.measureText`
 * plutôt qu'un ratio fixe, pour rester correct quelle que soit la longueur du pseudo. */
function botNicknameFontSizePx(
  ctx: CanvasRenderingContext2D,
  nickname: string,
  screenRadius: number,
): number {
  const availableWidth = screenRadius * 1.7;
  let fontSize = Math.max(BOT_NICKNAME_MIN_FONT_PX, screenRadius * BOT_NICKNAME_START_FONT_RATIO);
  ctx.font = `${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(nickname).width;
  if (textWidth > availableWidth && textWidth > 0) {
    fontSize = Math.max(BOT_NICKNAME_MIN_FONT_PX, fontSize * (availableWidth / textWidth));
  }
  return fontSize;
}

/** Dégradé radial arc-en-ciel pour le pellet "Multicolor" (masse 12, le plus rare et le plus
 * gros) — dessiné individuellement (chaque dégradé est lié à une position écran, impossible à
 * regrouper dans un seul `Path2D` comme les couleurs plates ci-dessus), ce qui reste sans
 * impact perceptible vu sa rareté (1 à 15% des pellets selon le mode). */
/** Résolution du sprite pré-rendu du pellet Multicolor (voir `getMulticolorFoodSprite`) — même
 * convention que `CIRCULAR_SPRITE_SIZE_PX` ci-dessus. */
const MULTICOLOR_SPRITE_SIZE_PX = 160;
let multicolorFoodSprite: HTMLCanvasElement | null | undefined;

/** Sprite du pellet Multicolor, dessiné une seule fois (canvas hors-écran) puis réutilisé via
 * `drawImage` — `createRadialGradient` était sinon reconstruit à CHAQUE frame où le pellet est
 * visible (rare, mais WebKit/Safari est réputé plus lent à recréer des dégradés qu'à faire un
 * `drawImage`, voir audit Safari/macOS). Même principe que `getCircularSkinImage` pour les skins :
 * un dégradé ne peut pas être repositionné une fois créé, donc on le fige dans un sprite carré
 * fixe et on laisse `drawImage` l'étirer à la position/au rayon réels. */
function getMulticolorFoodSprite(): HTMLCanvasElement | null {
  if (multicolorFoodSprite !== undefined) return multicolorFoodSprite;

  const sprite = document.createElement('canvas');
  sprite.width = MULTICOLOR_SPRITE_SIZE_PX;
  sprite.height = MULTICOLOR_SPRITE_SIZE_PX;
  const spriteCtx = sprite.getContext('2d');
  if (!spriteCtx) {
    multicolorFoodSprite = null;
    return null;
  }

  const center = MULTICOLOR_SPRITE_SIZE_PX / 2;
  const gradient = spriteCtx.createRadialGradient(center, center, 0, center, center, center);
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.35, '#ffd23a');
  gradient.addColorStop(0.6, '#ff5ca8');
  gradient.addColorStop(0.8, '#5ca8ff');
  gradient.addColorStop(1, '#7a3fa0');

  spriteCtx.beginPath();
  spriteCtx.arc(center, center, center, 0, Math.PI * 2);
  spriteCtx.fillStyle = gradient;
  spriteCtx.fill();

  multicolorFoodSprite = sprite;
  return sprite;
}

function drawMulticolorFood(
  ctx: CanvasRenderingContext2D,
  screenX: number,
  screenY: number,
  screenRadius: number,
): void {
  const sprite = getMulticolorFoodSprite();
  if (!sprite) return;
  ctx.drawImage(sprite, screenX - screenRadius, screenY - screenRadius, screenRadius * 2, screenRadius * 2);
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
 *
 * `m` (masse) est interpolée comme le reste : `computeCamera`/`ownAggregate` s'en servent pour le
 * zoom caméra, lui-même utilisé (GameView) pour convertir la position souris en coordonnées monde
 * à chaque frame — une masse qui saute par palier à chaque `state` (au lieu des ~60-240 frames de
 * rendu interpolées) y crée un micro-saut de zoom, donc un micro-saut de la cible de direction du
 * joueur, perceptible comme un tressautement à chaque gain de masse (nourriture/absorption).
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
      m: before.m + (entity.m - before.m) * t,
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
  // Taille CSS ("logique"), voir le commentaire équivalent dans `renderFrame`.
  const canvasWidth = canvas.clientWidth;
  const canvasHeight = canvas.clientHeight;
  const worldLeft = camera.x - canvasWidth / 2 / camera.scale;
  const worldRight = camera.x + canvasWidth / 2 / camera.scale;
  const worldTop = camera.y - canvasHeight / 2 / camera.scale;
  const worldBottom = camera.y + canvasHeight / 2 / camera.scale;

  const firstX = Math.floor(worldLeft / GRID_SPACING_WORLD_PX) * GRID_SPACING_WORLD_PX;
  const firstY = Math.floor(worldTop / GRID_SPACING_WORLD_PX) * GRID_SPACING_WORLD_PX;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1;
  ctx.beginPath();

  for (let x = firstX; x <= worldRight; x += GRID_SPACING_WORLD_PX) {
    const screenX = toScreenX(x);
    ctx.moveTo(screenX, 0);
    ctx.lineTo(screenX, canvasHeight);
  }
  for (let y = firstY; y <= worldBottom; y += GRID_SPACING_WORLD_PX) {
    const screenY = toScreenY(y);
    ctx.moveTo(0, screenY);
    ctx.lineTo(canvasWidth, screenY);
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
  if (!entity.p) return DEFAULT_SKIN;
  const explicitColor = colors?.get(entity.p);
  if (explicitColor) return explicitColor;
  const name = nicknames?.get(entity.p);
  if (name) {
    return skinForNickname(name);
  }
  return skinForNickname(entity.p);
}
