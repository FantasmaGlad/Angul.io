/** Moteur de rendu GPU (PixiJS) du canva admin — remplace `drawEntities` (Canvas2D, voir l'ancien
 * historique de `entityCanvas.ts`) : cahier_des_charges_admin.md §10.2, "rendu stable à 60 FPS
 * même avec plusieurs centaines d'entités, sans dégradation liée au nombre d'objets sur canvas".
 * D'autant plus nécessaire depuis §10.1 (voir `roomInstance.ts` `ADMIN_TICK_DIVISOR`) : le canal
 * admin reçoit désormais TOUTE la nourriture d'un salon sans sous-échantillonnage (jusqu'à
 * plusieurs milliers de particules en Hardcore) — redessiner ce volume avec `ctx.arc()+fill()`
 * par particule et par frame (Canvas2D) aurait été la charge dominante du canva, PixiJS batche en
 * un seul draw call GPU toutes les particules partageant la même texture.
 *
 * `worldToScreen`/`screenToWorld`/`pieceAtScreenPoint`/`AdminSnapshotBuffer` (entityCanvas.ts)
 * restent INCHANGÉS — fonctions pures indépendantes du moteur de rendu, réutilisées telles
 * quelles ici (migration incrémentale recommandée par le cahier des charges §10.2). */
import { Application, Assets, Container, Graphics, Sprite, Text, Texture, type Renderer } from 'pixi.js';
import { SKIN_IMAGE_MAP, type EntitySnapshot } from '@angulio/shared';
import { screenToWorld, worldToScreen, type Camera } from './entityCanvas.js';

const FOOD_COLORS_BY_MASS: Record<number, number> = {
  1: 0x7dd88a, // Vert
  2: 0x64b5f6, // Bleu
  3: 0xffd54f, // Jaune
  4: 0xba68c8, // Violet
  5: 0xe57373, // Rouge
  6: 0xffb74d, // Orange
  7: 0xf48fb1, // Rose
};
const FOOD_COLOR_FALLBACK = 0x7dd88a;

const BODY_FALLBACK_COLOR = 0x3b82f6;
const BODY_GOD_COLOR = 0xf59e0b;
const BORDER_DEFAULT = 0xffffff;
const BORDER_SELECTED = 0x60a5fa;
const NICKNAME_HUMAN_COLOR = 0xffffff;
const NICKNAME_BOT_COLOR = 0x93c5fd;
const MASS_TEXT_COLOR = 0xfde047;

const CIRCLE_TEXTURE_SIZE = 64;
const SKIN_SPRITE_SIZE = 160;
const GRID_STEP_WORLD_PX = 100;

interface PieceView {
  container: Container;
  body: Sprite;
  border: Graphics;
  selectionRing: Graphics;
  nickname: Text;
  massLabel: Text;
  lastNicknameText?: string;
  lastMassText?: string;
  lastSkinKey?: string;
}

/** Charge (et met en cache) la texture PixiJS brute d'un skin — `Assets.load` (API publique
 * documentée, contrairement à l'inspection de champs internes de `TextureSource`) retourne une
 * promesse résolue une fois l'image réellement décodée ; tant qu'elle ne l'est pas,
 * `getSkinTexture` renvoie `undefined` (repli couleur unie côté appelant, comme l'ancien
 * `getSkinImage`/`img.complete` du rendu Canvas2D) plutôt qu'une texture partiellement chargée. */
const skinTextureCache = new Map<string, Texture>();
const skinTextureLoading = new Set<string>();
function getSkinTexture(skinName: string): Texture | undefined {
  const url = SKIN_IMAGE_MAP[skinName];
  if (!url) return undefined;
  const cached = skinTextureCache.get(skinName);
  if (cached) return cached;
  if (!skinTextureLoading.has(skinName)) {
    skinTextureLoading.add(skinName);
    void Assets.load<Texture>(url).then((tex) => {
      skinTextureCache.set(skinName, tex);
      skinTextureLoading.delete(skinName);
    });
  }
  return undefined;
}

export class PixiEntityRenderer {
  private app = new Application();
  private initPromise: Promise<void>;
  private destroyed = false;
  private initialized = false;

  private gridGraphics = new Graphics();
  private foodContainer = new Container();
  private pieceContainer = new Container();

  /** Texture "cercle blanc plein" partagée par TOUTES les pastilles, teintée par couleur
   * (`sprite.tint`) au lieu d'une texture par couleur — un seul batch GPU pour toute la
   * nourriture visible, quelle que soit sa diversité de couleurs. */
  private circleTexture: Texture | undefined;
  /** Sprite circulaire pré-découpé PAR SKIN (même principe que l'ancien cache Canvas2D
   * `circularSkinCache`) — généré une fois via `renderer.generateTexture`, jamais reclippé par
   * instance/par frame. */
  private circularSkinTextureCache = new Map<string, Texture>();

  private foodSpritesById = new Map<string, Sprite>();
  private pieceViewsById = new Map<string, PieceView>();

  constructor(canvas: HTMLCanvasElement) {
    // PAS de `resizeTo`/résolution HiDPI ici : les appelants (CreativeView.tsx/RoomsView.tsx)
    // pilotent `canvas.width`/`canvas.height` eux-mêmes et en dérivent leurs propres calculs
    // écran<->monde (`worldToScreen`/`screenToWorld`/`pieceAtScreenPoint`) comparés directement à
    // `event.offsetX/offsetY` (coordonnées CSS-pixel) — l'ancien rendu Canvas2D n'avait déjà
    // AUCUNE mise à l'échelle HiDPI (`resolution` implicite = 1). En introduire une ici sans
    // adapter tous ces appels casserait le pointage souris/clic (décalage proportionnel au DPR
    // de l'écran) : `resize()` ci-dessous reste la SEULE source de vérité sur la taille, appelée
    // explicitement par l'appelant, exactement comme avec l'ancien `ctx.canvas`.
    this.initPromise = this.app
      .init({ canvas, background: '#12141a', antialias: true, resolution: 1 })
      .then(() => {
        // Synchrone (pas de `.then()` supplémentaire ni d'`await` avant) : `destroy()` s'appuie
        // sur ce flag pour savoir si `this.app` possède déjà un contexte WebGL réel à libérer
        // IMMÉDIATEMENT plutôt qu'en microtâche (voir `destroy()`).
        this.initialized = true;
        if (this.destroyed) return; // démonté pendant l'init asynchrone
        this.circleTexture = this.bakeCircleTexture();
        this.app.stage.addChild(this.gridGraphics, this.foodContainer, this.pieceContainer);
        // Le plus gros au-dessus (même ordre que l'ancien rendu Canvas2D) — trie les enfants par
        // masse croissante via `zIndex` (`renderPieces`), une seule activation ici plutôt qu'à
        // chaque frame.
        this.pieceContainer.sortableChildren = true;
        // Applique la dernière taille demandée AVANT que l'init asynchrone n'ait résolu (voir
        // `resize()` ci-dessous — `app.init()` n'a pas encore créé `this.app.renderer` à ce
        // moment, un appel synchrone juste après `new PixiEntityRenderer(canvas)` y plantait).
        if (this.pendingSize) {
          this.app.renderer.resize(this.pendingSize.width, this.pendingSize.height);
          this.pendingSize = undefined;
        }
      });
  }

  public async ready(): Promise<void> {
    return this.initPromise;
  }

  private pendingSize: { width: number; height: number } | undefined;

  /** À appeler par l'appelant à chaque redimensionnement (même déclencheur que l'ancien
   * `canvas.width = canvas.clientWidth` du rendu Canvas2D) — voir le commentaire du constructeur.
   * Sans effet immédiat tant que `init()` (asynchrone) n'a pas résolu : la dernière taille demandée
   * est alors mémorisée et appliquée dès que possible (voir le `.then()` du constructeur) plutôt
   * que de planter sur `this.app.renderer` encore `undefined`. */
  public resize(width: number, height: number): void {
    if (this.destroyed || width <= 0 || height <= 0) return;
    if (!this.app.renderer) {
      this.pendingSize = { width, height };
      return;
    }
    this.app.renderer.resize(width, height);
  }

  private bakeCircleTexture(): Texture {
    const g = new Graphics();
    const r = CIRCLE_TEXTURE_SIZE / 2;
    g.circle(r, r, r).fill(0xffffff);
    const tex = this.app.renderer.generateTexture(g);
    g.destroy();
    return tex;
  }

  private getCircularSkinTexture(skinName: string): Texture | undefined {
    const cached = this.circularSkinTextureCache.get(skinName);
    if (cached) return cached;

    const raw = getSkinTexture(skinName);
    if (!raw) return undefined;

    const size = SKIN_SPRITE_SIZE;
    const sprite = new Sprite(raw);
    sprite.width = size;
    sprite.height = size;
    const mask = new Graphics().circle(size / 2, size / 2, size / 2).fill(0xffffff);
    sprite.mask = mask;
    const container = new Container();
    container.addChild(sprite, mask);

    const tex = this.app.renderer.generateTexture(container);
    container.destroy({ children: true });
    this.circularSkinTextureCache.set(skinName, tex);
    return tex;
  }

  /** Équivalent PixiJS de l'ancien `drawEntities` (Canvas2D) — même signature/sémantique, appelé
   * une fois par frame de rendu. No-op tant que `ready()` n'est pas résolue (init asynchrone). */
  public render(
    entities: EntitySnapshot[],
    camera: Camera,
    nicknames: Map<string, string>,
    skins: Map<string, string>,
    selectedPlayerId: string | undefined,
    mapSize = 3000,
  ): void {
    if (this.destroyed || !this.circleTexture) return;

    const width = this.app.screen.width;
    const height = this.app.screen.height;
    if (width === 0 || height === 0) return;

    this.drawGrid(camera, width, height, mapSize);

    const food = entities.filter((e) => e.k === 'f');
    const pieces = entities.filter((e) => e.k === 'c');

    this.renderFood(food, camera, width, height);
    this.renderPieces(pieces, camera, width, height, nicknames, skins, selectedPlayerId);
  }

  private drawGrid(camera: Camera, width: number, height: number, mapSize: number): void {
    const g = this.gridGraphics;
    g.clear();

    const halfMap = mapSize / 2;
    const minX = Math.max(-halfMap, screenToWorld(camera, width, height, 0, 0).x);
    const maxX = Math.min(halfMap, screenToWorld(camera, width, height, width, 0).x);
    const minY = Math.max(-halfMap, screenToWorld(camera, width, height, 0, 0).y);
    const maxY = Math.min(halfMap, screenToWorld(camera, width, height, 0, height).y);

    const startGridX = Math.floor(minX / GRID_STEP_WORLD_PX) * GRID_STEP_WORLD_PX;
    const endGridX = Math.ceil(maxX / GRID_STEP_WORLD_PX) * GRID_STEP_WORLD_PX;
    const startGridY = Math.floor(minY / GRID_STEP_WORLD_PX) * GRID_STEP_WORLD_PX;
    const endGridY = Math.ceil(maxY / GRID_STEP_WORLD_PX) * GRID_STEP_WORLD_PX;

    for (let gx = startGridX; gx <= endGridX; gx += GRID_STEP_WORLD_PX) {
      const p1 = worldToScreen(camera, width, height, gx, minY);
      const p2 = worldToScreen(camera, width, height, gx, maxY);
      g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
    }
    for (let gy = startGridY; gy <= endGridY; gy += GRID_STEP_WORLD_PX) {
      const p1 = worldToScreen(camera, width, height, minX, gy);
      const p2 = worldToScreen(camera, width, height, maxX, gy);
      g.moveTo(p1.x, p1.y).lineTo(p2.x, p2.y);
    }
    g.stroke({ width: 1, color: 0xffffff, alpha: 0.05 });
  }

  private renderFood(food: EntitySnapshot[], camera: Camera, width: number, height: number): void {
    const seenIds = new Set<string>();

    for (const entity of food) {
      seenIds.add(entity.i);
      const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
      const r = Math.max(1.5, entity.r * camera.scale);

      let sprite = this.foodSpritesById.get(entity.i);
      if (!sprite) {
        sprite = new Sprite(this.circleTexture);
        sprite.anchor.set(0.5);
        this.foodContainer.addChild(sprite);
        this.foodSpritesById.set(entity.i, sprite);
      }
      sprite.position.set(x, y);
      sprite.width = r * 2;
      sprite.height = r * 2;
      sprite.tint = FOOD_COLORS_BY_MASS[Math.round(entity.m)] ?? FOOD_COLOR_FALLBACK;
      // Culling automatique PixiJS (viewport GPU) — visible à false évite en plus le coût de
      // traversée de la passe de rendu pour ce qui est loin hors écran (marge d'un rayon).
      sprite.visible = x + r >= 0 && x - r <= width && y + r >= 0 && y - r <= height;
    }

    this.prune(this.foodSpritesById, seenIds, (sprite) => sprite.destroy());
  }

  private renderPieces(
    pieces: EntitySnapshot[],
    camera: Camera,
    width: number,
    height: number,
    nicknames: Map<string, string>,
    skins: Map<string, string>,
    selectedPlayerId: string | undefined,
  ): void {
    const seenIds = new Set<string>();

    for (const entity of pieces) {
      seenIds.add(entity.i);
      const { x, y } = worldToScreen(camera, width, height, entity.x, entity.y);
      const r = Math.max(2, entity.r * camera.scale);

      let view = this.pieceViewsById.get(entity.i);
      if (!view) {
        view = this.createPieceView();
        this.pieceContainer.addChild(view.container);
        this.pieceViewsById.set(entity.i, view);
      }

      view.container.position.set(x, y);
      view.container.zIndex = entity.m;
      view.container.visible = x + r >= 0 && x - r <= width && y + r >= 0 && y - r <= height;
      if (!view.container.visible) continue;

      const pId = entity.p;
      const isGod = pId?.startsWith('admin-god-') ?? false;
      const isSelected = pId !== undefined && pId === selectedPlayerId;
      const skinName = pId ? skins.get(pId) : undefined;
      const skinTexture = skinName ? this.getCircularSkinTexture(skinName) : undefined;
      const skinKey = skinTexture ? skinName : undefined;

      if (skinKey !== view.lastSkinKey) {
        view.body.texture = skinTexture ?? this.circleTexture!;
        view.body.tint = skinTexture ? 0xffffff : isGod ? BODY_GOD_COLOR : BODY_FALLBACK_COLOR;
        view.lastSkinKey = skinKey;
      } else if (!skinTexture) {
        // Pas de skin connu : la couleur de repli peut changer (Dieu <-> normal) même sans
        // changement de "clé skin" (toujours `undefined`).
        view.body.tint = isGod ? BODY_GOD_COLOR : BODY_FALLBACK_COLOR;
      }
      view.body.width = r * 2;
      view.body.height = r * 2;

      view.border.clear();
      view.border
        .circle(0, 0, r)
        .stroke({ width: isSelected ? 3 : 2, color: isSelected ? BORDER_SELECTED : isGod ? BODY_GOD_COLOR : BORDER_DEFAULT, alpha: isSelected || isGod ? 1 : 0.4 });

      if (isSelected) {
        view.selectionRing.visible = true;
        view.selectionRing.clear();
        view.selectionRing.circle(0, 0, r + 6).stroke({ width: 2, color: BORDER_SELECTED, alpha: 1 });
      } else {
        view.selectionRing.visible = false;
      }

      const showLabels = Boolean(pId) && r > 9;
      view.nickname.visible = showLabels;
      view.massLabel.visible = showLabels && r > 18;
      if (showLabels && pId) {
        const nick = nicknames.get(pId) ?? pId;
        const isBot = pId.startsWith('bot-');
        if (nick !== view.lastNicknameText) {
          view.nickname.text = nick;
          view.lastNicknameText = nick;
        }
        view.nickname.tint = isBot ? NICKNAME_BOT_COLOR : NICKNAME_HUMAN_COLOR;
        view.nickname.position.set(0, -r - 8);

        if (view.massLabel.visible) {
          const massText = String(Math.round(entity.m));
          if (massText !== view.lastMassText) {
            view.massLabel.text = massText;
            view.lastMassText = massText;
          }
          view.massLabel.tint = MASS_TEXT_COLOR;
          view.massLabel.position.set(0, 4);
        }
      }
    }

    this.prune(this.pieceViewsById, seenIds, (view) => view.container.destroy({ children: true }));
  }

  private createPieceView(): PieceView {
    const container = new Container();

    const body = new Sprite(this.circleTexture);
    body.anchor.set(0.5);

    const border = new Graphics();
    const selectionRing = new Graphics();
    selectionRing.visible = false;

    // `Text` PixiJS : contour simulé par un `dropShadow` fin plutôt qu'un double-texte
    // stroke+fill (Canvas2D `strokeText`/`fillText`) — moins coûteux à mettre à jour ici,
    // lisibilité équivalente par-dessus un skin/fond coloré.
    const textStyle = {
      fontFamily: 'Inter, sans-serif',
      fontWeight: 'bold' as const,
      fontSize: 12,
      dropShadow: { color: 0x000000, alpha: 0.85, blur: 2, distance: 0 },
    };
    const nickname = new Text({ text: '', style: textStyle });
    nickname.anchor.set(0.5);
    const massLabel = new Text({ text: '', style: { ...textStyle, fontSize: 11 } });
    massLabel.anchor.set(0.5);

    container.addChild(body, border, selectionRing, nickname, massLabel);
    return { container, body, border, selectionRing, nickname, massLabel };
  }

  /** Ids présents dans `map` mais plus dans `seenIds` (entités disparues ce cadre) sont d'abord
   * COLLECTÉS puis retirés/détruits APRÈS la boucle — jamais `map.delete()` pendant l'itération de
   * `map` elle-même (fonctionnellement sûr en JS/Map, mais volontairement évité ici par prudence
   * plutôt que de s'appuyer sur ce comportement lors d'un appel à `destroy()` qui pourrait, selon
   * l'implémentation PixiJS, déclencher des effets de bord réentrants sur `map`). */
  private prune<T>(map: Map<string, T>, seenIds: Set<string>, destroy: (value: T) => void): void {
    const staleIds: string[] = [];
    for (const id of map.keys()) {
      if (!seenIds.has(id)) staleIds.push(id);
    }
    for (const id of staleIds) {
      const value = map.get(id);
      map.delete(id);
      if (value !== undefined) destroy(value);
    }
  }

  /** `destroy()` SYNCHRONE dès que possible (voir `this.initialized`) — pas juste par souci de
   * propreté : l'appelant (CreativeView.tsx/RoomsView.tsx) recrée immédiatement un NOUVEAU
   * `PixiEntityRenderer` sur le MÊME `<canvas>` juste après avoir appelé `destroy()` (React
   * exécute le nettoyage de l'ancien effet puis la mise en place du nouveau dans le même commit,
   * synchrone). Différer la vraie destruction (`app.destroy()`, qui libère le contexte WebGL) en
   * microtâche via `.then()` laissait une fenêtre où DEUX `Application` PixiJS se disputaient le
   * même contexte WebGL du même canvas — reproduit en test : geste "changer de salon" figeant
   * l'onglet entier (plus aucun JS exécutable, y compris hors de React) pendant plusieurs minutes.
   * Une fois initialisée, la destruction n'a plus besoin d'attendre quoi que ce soit d'asynchrone. */
  public destroy(): void {
    this.destroyed = true;
    if (this.initialized) {
      // `false` pour le canvas : géré par React (le `<canvas>` reste dans le DOM, seul le
      // contexte/les ressources GPU PixiJS doivent être libérés à ce démontage).
      this.app.destroy({ removeView: false }, { children: true, texture: true });
      return;
    }
    // Pas encore initialisée (démontage très rapide après montage, cas rare) : le `.then()` du
    // constructeur voit `this.destroyed=true` et saute la mise en place de la scène, mais
    // `app.init()` lui-même a déjà réservé le contexte WebGL — il faut donc encore le libérer une
    // fois cette init terminée, pas d'alternative synchrone possible dans ce cas précis.
    void this.initPromise.then(() => {
      this.app.destroy({ removeView: false }, { children: true, texture: true });
    });
  }
}

/** Ré-exporté pour compat des appelants existants (`Camera`/`Renderer` restent utiles côté
 * appelant sans avoir à importer directement `pixi.js`). */
export type { Camera, Renderer };
