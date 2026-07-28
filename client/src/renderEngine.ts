import type { EntitySnapshot } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { cullEntitiesForViewport, interpolateEntities, type Camera } from './render.js';

export interface SnapshotItem {
  time: number;
  entities: EntitySnapshot[];
}

export class RenderEngine {
  public snapshotQueue: SnapshotItem[] = [];
  public clientRenderTime = 0;
  public serverTickRateHz = 30;

  public reset(): void {
    this.snapshotQueue = [];
    this.clientRenderTime = 0;
  }

  public pushSnapshot(entities: EntitySnapshot[], serverTickRateHz?: number): void {
    if (serverTickRateHz && serverTickRateHz > 0) {
      this.serverTickRateHz = serverTickRateHz;
    }
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
      t = clamp((renderTime - snapA.time) / (snapB.time - snapA.time), 0, 1.0);
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
