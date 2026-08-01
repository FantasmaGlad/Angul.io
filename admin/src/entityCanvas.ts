/** Géométrie/interpolation partagées par "Salons & Écrans" (POV) et l'Espace Créatif —
 * indépendantes du moteur de rendu (voir `pixiEntityRenderer.ts`, PixiJS, cahier des charges
 * §10.2) : ces fonctions PURES restent réutilisées telles quelles après la migration Canvas2D ->
 * PixiJS, comme recommandé par le cahier des charges ("migration incrémentale ... seule la couche
 * de dessin change"). */
import type { EntitySnapshot } from '@angulio/shared';

export interface Camera {
  x: number;
  y: number;
  scale: number;
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

/** Interpolateur d'entités léger pour 60 FPS sans saccades entre snapshots serveur.
 *
 * `updateIntervalMs` (cahier_des_charges_admin.md §10.1) N'EST PLUS une constante figée — elle
 * doit être dérivée de la cadence RÉELLEMENT annoncée par le serveur (`welcome.tickRateHz`, voir
 * `setServerTickRateHz`), jamais d'une valeur supposée. Avant ce correctif, `updateIntervalMs`
 * codé en dur à 50ms (soit une hypothèse de 20Hz) restait fixe même quand la cadence réelle du
 * canal admin différait — l'interpolation atteignait alors `alpha=1` avant l'arrivée du prochain
 * snapshot, figeant les entités à leur dernière position jusqu'à ce prochain paquet (le "stutter"
 * périodique diagnostiqué en §2.3). Valeur de repli (50ms) conservée UNIQUEMENT le temps très bref
 * entre la connexion du WebSocket et la réception du tout premier `welcome`. */
export class AdminSnapshotBuffer {
  private prevEntities: EntitySnapshot[] = [];
  private currEntities: EntitySnapshot[] = [];
  private lastUpdateMs = performance.now();
  private updateIntervalMs = 50;

  /** À appeler dès la réception de `welcome` (voir `AdminSocketCallbacks.onWelcome`) — dérive
   * `updateIntervalMs` de la cadence réelle annoncée, une fois par connexion (une reconnexion
   * renvoie un nouveau `welcome`, potentiellement avec une cadence différente si `TICK_RATE_HZ`/
   * `ADMIN_TICK_DIVISOR` a changé côté serveur entre-temps — reste donc correct après un
   * déploiement). */
  public setServerTickRateHz(tickRateHz: number): void {
    if (tickRateHz > 0) this.updateIntervalMs = 1000 / tickRateHz;
  }

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
