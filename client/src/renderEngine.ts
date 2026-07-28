import type { EntitySnapshot } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { cullEntitiesForViewport, interpolateEntities, type Camera } from './render.js';

export interface SnapshotItem {
  time: number;
  entities: EntitySnapshot[];
}

/** Fenêtre maximale (ms) d'extrapolation par vélocité déduite au-delà du dernier snapshot connu
 * (voir `getInterpolatedEntities`) — au-delà, le décrochage réseau est trop long pour qu'une
 * vélocité déduite de deux points déjà anciens reste représentative ; mieux vaut alors rester
 * proche du dernier point connu que de continuer à extrapoler à l'aveugle. Voir
 * plan_performance_reseau.md §4.3/Phase 4.2. */
const MAX_EXTRAPOLATION_MS = 250;

export class RenderEngine {
  public snapshotQueue: SnapshotItem[] = [];
  public clientRenderTime = 0;
  public serverTickRateHz = 30;
  /** Nombre cumulé de ticks serveur jamais reçus (message `state` manquant entre deux `tick`
   * consécutifs) depuis le dernier `reset()` — pur diagnostic (écran F3), incrémenté par
   * `pushSnapshot`. Un décrochage réseau (drop de bufferedAmount côté serveur, coupure Wi-Fi...)
   * s'y reflète directement. */
  public missedTickCount = 0;
  private lastKnownTick: number | undefined;

  public reset(): void {
    this.snapshotQueue = [];
    this.clientRenderTime = 0;
    this.missedTickCount = 0;
    this.lastKnownTick = undefined;
  }

  public pushSnapshot(entities: EntitySnapshot[], tick: number, serverTickRateHz?: number): void {
    if (serverTickRateHz && serverTickRateHz > 0) {
      this.serverTickRateHz = serverTickRateHz;
    }
    if (this.lastKnownTick !== undefined && tick > this.lastKnownTick + 1) {
      this.missedTickCount += tick - this.lastKnownTick - 1;
    }
    this.lastKnownTick = tick;
    const now = performance.now();
    this.snapshotQueue.push({ time: now, entities });
    if (this.snapshotQueue.length > 20) {
      this.snapshotQueue.shift();
    }
  }

  public getInterpolatedEntities(
    frameDt: number,
    camera: Camera,
    viewportWidth: number,
    viewportHeight: number,
    selfPlayerId?: string,
    isSpectator = false,
  ): EntitySnapshot[] {
    const stateIntervalMs = 1000 / (this.serverTickRateHz || 30);
    const interpDelayMs = Math.max(50, stateIntervalMs * 1.75);
    const now = performance.now();
    const renderTime = now - interpDelayMs;

    let snapA: SnapshotItem | undefined;
    let snapB: SnapshotItem | undefined;

    if (this.snapshotQueue.length >= 2) {
      for (let i = 0; i < this.snapshotQueue.length - 1; i++) {
        const itemA = this.snapshotQueue[i];
        const itemB = this.snapshotQueue[i + 1];
        if (itemA && itemB && itemA.time <= renderTime && renderTime <= itemB.time) {
          snapA = itemA;
          snapB = itemB;
          break;
        }
      }
      if (!snapA) {
        const first = this.snapshotQueue[0];
        const second = this.snapshotQueue[1];
        const lastPrev = this.snapshotQueue[this.snapshotQueue.length - 2];
        const lastCurr = this.snapshotQueue[this.snapshotQueue.length - 1];
        if (first && second && renderTime < first.time) {
          snapA = first;
          snapB = second;
        } else if (lastPrev && lastCurr) {
          snapA = lastPrev;
          snapB = lastCurr;
        }
      }
    }

    let t = 0;
    if (snapA && snapB && snapB.time > snapA.time) {
      const intervalMs = snapB.time - snapA.time;
      // Au-delà de t=1 (buffer à sec, aucun nouveau snapshot depuis `snapB`) : extrapoler
      // linéairement au-delà du dernier point connu (déduit de son propre delta avec le
      // précédent) plutôt que geler net puis sauter d'un coup au prochain snapshot reçu — c'est
      // exactement le "arrêt puis saut" ressenti comme un petit lag/avant-arrière. Plafonné à
      // MAX_EXTRAPOLATION_MS d'extrapolation pour ne pas dériver indéfiniment sur une coupure
      // longue (voir son commentaire).
      const maxT = 1 + MAX_EXTRAPOLATION_MS / intervalMs;
      t = clamp((renderTime - snapA.time) / intervalMs, 0, maxT);
    }

    const fromEntities = snapA ? snapA.entities : (this.snapshotQueue[0]?.entities ?? []);
    const toEntities = snapB ? snapB.entities : (this.snapshotQueue[this.snapshotQueue.length - 1]?.entities ?? []);

    // Pour éviter tout pop visuel d'entité entre snapA et snapB, l'interpolation se fait d'abord
    const interpolated = interpolateEntities(fromEntities, toEntities, t);

    // Puis le culling de viewport (ou conservation de tout si spectateur)
    if (isSpectator) {
      return interpolated;
    }

    return cullEntitiesForViewport(
      interpolated,
      camera,
      viewportWidth,
      viewportHeight,
      selfPlayerId,
    );
  }
}
