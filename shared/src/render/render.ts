import {
  BASE_SCALE,
  computeScaleForMass,
} from '../camera.js';
import { DEFAULT_SKIN, SKIN_IMAGE_MAP, skinForNickname } from '../avatarPalette.js';
import type { EntitySnapshot } from '../protocol.js';
import type { Camera } from './camera.js';
import { ownAggregate } from './stats.js';

export { BASE_SCALE };

const skinImageCache = new Map<string, HTMLImageElement>();

export function getSkinImage(skinId: string): HTMLImageElement | null {
  if (!skinId || skinId.startsWith('#') || skinId.startsWith('rgb') || skinId.includes('#')) {
    return null;
  }
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
    Baamix: '#FFE135',
    'La Mouche': '#9254DE',
    Monstera: '#2E8B57',
    Oli: '#FFC300',
    Pieuvrito: '#7A3FA0',
    Requin: '#40A9FF',
    Samouraï: '#E05A47',
    Scoobi: '#C9702E',
    Seigneur: '#9254DE',
    Skibidi: '#B23A2E',
  };
  return map[skinId] ?? '#3a6b35';
}

const VIRUS_IMAGE_CACHE: Record<number, HTMLImageElement> = {};

function getVirusImage(vId: 1 | 2 | 3): HTMLImageElement {
  if (VIRUS_IMAGE_CACHE[vId]) return VIRUS_IMAGE_CACHE[vId];
  const img = new Image();
  img.src =
    vId === 2
      ? '/assets/Virus/VirusRouge.png'
      : vId === 3
        ? '/assets/Virus/VirusBleu.png'
        : '/assets/Virus/VirusVert.png';
  VIRUS_IMAGE_CACHE[vId] = img;
  return img;
}

/** BASE_SCALE/MIN_SCALE/MAX_SCALE/REFERENCE_MASS (formule complète de zoom en fonction de la
 * masse) vivent dans `shared/src/camera.ts` — le serveur en a besoin pour dériver le rayon
 * d'intérêt réseau à partir de la même masse (filtrage par intérêt, voir
 * server/src/engine/worker/interestFilter.ts) : une seule formule des deux côtés élimine tout
 * risque de divergence entre "ce que le client affiche" et "ce que le serveur envoie". `BASE_SCALE`
 * reste ré-exporté d'ici (voir l'import ci-dessus) pour ne rien casser des appelants existants de
 * ce module. */

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
  1: '#0047ab',
  2: '#ffa500',
  3: '#8B008B',
  5: '#8B008B',
  8: '#44D7A8',
  10: '#ff2c2c',
  40: '#ffde21',
};
const FOOD_COLOR_FALLBACK = '#0047ab';
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

/** Centre la caméra sur le barycentre (pondéré par la masse) des morceaux du joueur, et
 * dézoome à mesure que sa masse totale augmente (comportement Agar.io classique). */
export function computeCamera(
  entities: EntitySnapshot[],
  selfPlayerId: string | undefined,
  fallback: { x: number; y: number },
): Camera {
  const own = ownAggregate(entities, selfPlayerId);
  if (!own) return { x: fallback.x, y: fallback.y, scale: BASE_SCALE };

  const scale = computeScaleForMass(own.mass);
  return { x: own.x, y: own.y, scale };
}

/** Une pastille considérée "mangée" ce cadre (voir `partitionEatenFood`). */
export interface EatenFood {
  /** Id de la pastille — à faire DÉFINITIVEMENT oublier via `RenderEngine.forgetFood`. */
  id: string;
  /** Masse de la pastille — créditée à la prédiction locale quand `eaterId` est un morceau du
   * joueur (voir GameView.tsx / `LocalPrediction.addPredictedMass`), pour que le blob GROSSISSE
   * aussi instantanément que la pastille disparaît. */
  mass: number;
  /** Id de l'entité (morceau) qui la recouvre — pas forcément un morceau du joueur local (ce
   * filtrage vaut pour toutes les créatures, voir `partitionEatenFood`). */
  eaterId: string;
}

export interface RenderFrameResult {
  drawCalls: number;
  batches: number;
  /** Pastilles considérées "mangées" ce cadre (voir `partitionEatenFood` ci-dessous) —
   * l'appelant (GameView.tsx) les fait DÉFINITIVEMENT oublier via `RenderEngine.forgetFood`,
   * plutôt que ce filtrage ne reste qu'une astuce d'affichage locale à la frame (voir son
   * commentaire). */
  eatenFood: EatenFood[];
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
  mapSize?: number,
  borderType?: string,
  hideNicknames?: boolean,
  hideEatFlash?: boolean,
  eatFlashIntensity?: number,
): RenderFrameResult {
  let drawCalls = 0;
  const canvasWidth = canvas.clientWidth;
  const canvasHeight = canvas.clientHeight;
  ctx.clearRect(0, 0, canvasWidth, canvasHeight);

  const toScreenX = (x: number) => (x - camera.x) * camera.scale + canvasWidth / 2;
  const toScreenY = (y: number) => (y - camera.y) * camera.scale + canvasHeight / 2;

  drawGrid(ctx, canvas, camera, toScreenX, toScreenY);
  drawCalls++;

  if (mapSize && mapSize > 0) {
    drawWorldBounds(ctx, camera, mapSize, borderType, toScreenX, toScreenY);
    drawCalls++;
  }

  const { visible: visibleEntities, eaten: eatenFood } = partitionEatenFood(entities);

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

  const renderCreature = (entity: typeof visibleEntities[0]) => {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvasWidth) return;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvasHeight) return;

    const skinId = colorFor(entity, nicknames, colors);
    const radius = Math.max(1, screenRadius);
    const circularImg = getCircularSkinImage(skinId);

    if (circularImg) {
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

    const nickname = hideNicknames ? undefined : (entity.p ? nicknames.get(entity.p) : undefined);
    const showNickname = Boolean(nickname) && entity.m >= 100;
    if (showNickname) {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      const fontSize = fitNicknameFontSizePx(ctx, nickname!, screenRadius);
      ctx.font = `bold ${fontSize}px sans-serif`;
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
  };

  const sortedCreatures = visibleEntities
    .filter((e) => e.k === 'c')
    .sort((a, b) => a.m - b.m);

  // Couche 1.5 : Morceaux de créatures plus petits qu'un virus (masse < 210) -> sous les virus
  const smallCreatures = sortedCreatures.filter((e) => e.m < 210);
  for (const entity of smallCreatures) {
    renderCreature(entity);
  }

  // Couche 1.8 : Rendu des virus
  const virusEntities = visibleEntities.filter((e) => e.k === 'v');
  for (const entity of virusEntities) {
    const screenX = toScreenX(entity.x);
    const screenY = toScreenY(entity.y);
    const screenRadius = entity.r * camera.scale;

    if (screenX + screenRadius < 0 || screenX - screenRadius > canvasWidth) continue;
    if (screenY + screenRadius < 0 || screenY - screenRadius > canvasHeight) continue;

    const radius = Math.max(1, screenRadius);
    const vId = (entity.vId ?? 1) as 1 | 2 | 3;
    const virusImg = getVirusImage(vId);

    if (virusImg && virusImg.complete && virusImg.naturalWidth > 0) {
      const drawCenterX = Math.round(screenX);
      const drawCenterY = Math.round(screenY);
      const drawRadius = Math.round(radius);
      ctx.drawImage(
        virusImg,
        drawCenterX - drawRadius,
        drawCenterY - drawRadius,
        drawRadius * 2,
        drawRadius * 2,
      );
    } else {
      ctx.beginPath();
      ctx.arc(screenX, screenY, radius, 0, Math.PI * 2);
      ctx.fillStyle = vId === 2 ? '#ff2c2c' : vId === 3 ? '#0047ab' : '#22c55e';
      ctx.fill();
    }
    drawCalls++;
  }

  // Couche 2 : Morceaux de créatures plus grands ou égaux au virus (masse >= 210) -> au-dessus des virus
  const largeCreatures = sortedCreatures.filter((e) => e.m >= 210);
  for (const entity of largeCreatures) {
    renderCreature(entity);
  }

  if (!hideEatFlash && eatFlashIntensity !== undefined && eatFlashIntensity > 0) {
    ctx.save();
    const alpha = Math.min(0.35, eatFlashIntensity * 0.35);
    ctx.fillStyle = `rgba(220, 38, 38, ${alpha.toFixed(3)})`;
    ctx.fillRect(0, 0, canvasWidth, canvasHeight);
    ctx.restore();
    drawCalls++;
  }

  return {
    drawCalls,
    batches: foodPathsByColor.size + 1,
    eatenFood,
  };
}

/** Sépare `entities` en (pastilles visibles, ids de pastilles "mangées" ce cadre) — une pastille
 * est considérée mangée dès qu'elle chevauche une créature (joueur/bot) à 5% de marge, quel que
 * soit le propriétaire de cette créature (repli approximatif : une pastille mangée par un AUTRE
 * joueur disparaît aussi de mon écran dès qu'elle touche son morceau, cohérent avec l'autorité
 * serveur). Extrait en fonction pure (plutôt qu'inline dans `renderFrame`) pour que l'appelant
 * (RenderEngine.forgetFood, voir renderEngine.ts) puisse purger ces ids DÉFINITIVEMENT de l'état
 * de delta réseau (`knownFood`) — sans ça, ce filtrage ne masquait la pastille que pour LE CADRE
 * COURANT (elle réapparaît dès que le blob s'en éloigne, la nourriture mangée n'étant retirée du
 * delta serveur qu'à la prochaine resynchronisation périodique, jusqu'à ~5s plus tard — voir
 * cahier_des_charges_perf_reseau_grande_carte.md §3.5, correctif "pastilles mangées qui mettent
 * plusieurs secondes à disparaître"). */
function partitionEatenFood(entities: EntitySnapshot[]): { visible: EntitySnapshot[]; eaten: EatenFood[] } {
  const creatures = entities.filter((e) => e.k === 'c');
  const eaten: EatenFood[] = [];
  const visible = entities.filter((entity) => {
    if (entity.k !== 'f') return true;
    // Ne pas masquer artificiellement les particules de nourriture en vol (éjection W) —
    // elles suivent la trajectoire autoritaire du serveur et ne doivent pas clignoter
    // ni faire de rollback visuel lors du survol d'un morceau.
    if (entity.vx || entity.vy) return true;
    for (const c of creatures) {
      const dx = entity.x - c.x;
      const dy = entity.y - c.y;
      const hitRadius = c.r * 1.05 + entity.r;
      if (dx * dx + dy * dy <= hitRadius * hitRadius) {
        eaten.push({ id: entity.i, mass: entity.m, eaterId: c.i });
        return false; // Disparition instantanée sans animation dès l'impact
      }
    }
    return true;
  });
  return { visible, eaten };
}

/** Taille de police plancher pour un pseudo (bot ou joueur humain) — en-deçà, le texte devient
 * illisible ; sur un tout petit morceau on accepte alors un léger débordement plutôt qu'un texte
 * invisible. */
const NICKNAME_MIN_FONT_PX = 6;
/** Point de départ avant ajustement à la largeur réelle du pseudo (`ctx.measureText`) — un
 * multiplicateur fixe du rayon ne suffit pas : un pseudo va de 2 caractères (bot le plus court,
 * voir BOT_IDENTITIES) à 20 (longueur max d'un pseudo humain, voir `maxLength` PlayPanel.tsx), un
 * pseudo long déborderait du cercle à taille fixe (retour utilisateur, pseudos humains). */
const NICKNAME_START_FONT_RATIO = 0.32;

/** Calcule la taille de police (px) qui fait tenir `nickname` ENTIÈREMENT dans le cercle du
 * morceau (diamètre `screenRadius * 2`, avec une marge pour ne pas toucher le bord) — mesuré via
 * `ctx.measureText` plutôt qu'un ratio fixe, pour rester correct quelle que soit la longueur du
 * pseudo, bot ou humain (demande utilisateur : un ratio fixe non mesuré, utilisé auparavant pour
 * les pseudos humains seulement, laissait déborder tout pseudo un peu long sur un petit morceau). */
function fitNicknameFontSizePx(
  ctx: CanvasRenderingContext2D,
  nickname: string,
  screenRadius: number,
): number {
  const availableWidth = screenRadius * 1.7;
  let fontSize = Math.max(NICKNAME_MIN_FONT_PX, screenRadius * NICKNAME_START_FONT_RATIO);
  // `bold` ici aussi (voir l'appelant) : mesurer en `normal` sous-estimerait la largeur réelle du
  // texte en gras effectivement dessiné, laissant déborder légèrement les pseudos longs.
  ctx.font = `bold ${fontSize}px sans-serif`;
  const textWidth = ctx.measureText(nickname).width;
  if (textWidth > availableWidth && textWidth > 0) {
    fontSize = Math.max(NICKNAME_MIN_FONT_PX, fontSize * (availableWidth / textWidth));
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
  mapSize?: number,
): EntitySnapshot[] {
  if (!previous || previous.length === 0) return latest;

  const previousById = new Map(previous.map((entity) => [entity.i, entity]));
  return latest.map((entity) => {
    const before = previousById.get(entity.i);
    if (!before) return entity;
    let dx = entity.x - before.x;
    let dy = entity.y - before.y;
    if (mapSize && mapSize > 0) {
      const half = mapSize / 2;
      if (Math.abs(dx) > half) {
        dx = dx > 0 ? dx - mapSize : dx + mapSize;
      }
      if (Math.abs(dy) > half) {
        dy = dy > 0 ? dy - mapSize : dy + mapSize;
      }
    }
    let interpX = before.x + dx * t;
    let interpY = before.y + dy * t;
    if (mapSize && mapSize > 0) {
      interpX = ((interpX % mapSize) + mapSize) % mapSize;
      interpY = ((interpY % mapSize) + mapSize) % mapSize;
    }
    return {
      ...entity,
      x: interpX,
      y: interpY,
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

/** Surbrillance visuelle des bordures de la carte selon le type de bordure (ex: lueur jaune toroïdale pour Infini, néon cyan pour Mega Split). */
function drawWorldBounds(
  ctx: CanvasRenderingContext2D,
  camera: Camera,
  mapSize: number,
  borderType: string | undefined,
  toScreenX: (x: number) => number,
  toScreenY: (y: number) => number,
): void {
  const x0 = toScreenX(0);
  const y0 = toScreenY(0);
  const x1 = toScreenX(mapSize);
  const y1 = toScreenY(mapSize);

  ctx.save();
  if (borderType === 'TOROIDAL' || borderType === 'infini') {
    // Surbrillance jaune subtile avec lueur pour signaler la bordure toroïdale du mod Infini
    ctx.strokeStyle = 'rgba(255, 215, 0, 0.85)';
    ctx.lineWidth = Math.max(2, 3 * camera.scale);
    ctx.shadowColor = 'rgba(255, 235, 59, 0.9)';
    ctx.shadowBlur = 15;
    ctx.setLineDash([12 * camera.scale, 8 * camera.scale]);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else if (borderType === 'ELASTIC_BOUNCE' || borderType === 'mega-split') {
    // Effet néon jaune (même couleur que le pellet #ffde21) pour la bordure rebondissante de Mega Split
    ctx.strokeStyle = 'rgba(255, 222, 33, 0.85)';
    ctx.lineWidth = Math.max(3, 4 * camera.scale);
    ctx.shadowColor = 'rgba(255, 222, 33, 0.9)';
    ctx.shadowBlur = 18;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  } else {
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
    ctx.lineWidth = Math.max(1, 2 * camera.scale);
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }
  ctx.restore();
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
