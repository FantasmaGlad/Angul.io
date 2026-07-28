import type { EntitySnapshot } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { cullEntitiesForViewport, interpolateEntities, type Camera } from './render.js';

/** Un snapshot reçu, positionné sur une ligne de temps "serveur" ancrée localement (voir
 * `RenderEngine.pushSnapshot`) plutôt que sur l'heure d'arrivée réseau brute. */
export interface SnapshotItem {
  tick: number;
  serverTimeMs: number;
  entities: EntitySnapshot[];
}

/** Fenêtre maximale (ms) d'extrapolation par vélocité déduite au-delà du dernier snapshot connu
 * (voir `getInterpolatedEntities`) — au-delà, le décrochage réseau est trop long pour qu'une
 * vélocité déduite de deux points déjà anciens reste représentative ; mieux vaut alors rester
 * proche du dernier point connu que de continuer à extrapoler à l'aveugle. */
const MAX_EXTRAPOLATION_MS = 250;

export class RenderEngine {
  public snapshotQueue: SnapshotItem[] = [];
  public serverTickRateHz = 30;
  /** Nombre cumulé de ticks serveur jamais reçus (message `state` manquant entre deux `tick`
   * consécutifs) depuis le dernier `reset()` — pur diagnostic (écran F3), incrémenté par
   * `pushSnapshot`. Un décrochage réseau (drop de bufferedAmount côté serveur, coupure Wi-Fi...)
   * s'y reflète directement. */
  public missedTickCount = 0;
  private lastKnownTick: number | undefined;
  /** Ancrage entre le numéro de tick serveur et l'horloge client (`performance.now()`), posé une
   * fois au premier snapshot reçu après un `reset()` — voir `pushSnapshot`. Toute la ligne de
   * temps de lecture (`serverTimeMs` de chaque snapshot, et `renderTime` dans
   * `getInterpolatedEntities`) est ensuite dérivée de cet ancrage + du numéro de tick, jamais de
   * l'heure d'ARRIVÉE réseau de chaque message individuel.
   *
   * Pourquoi : sur une connexion avec de la gigue/perte de paquets réelle (mesuré en production —
   * ~50ms de RTT avec ~30ms de gigue, des dizaines de retransmissions TCP par session, voir
   * plan_performance_reseau.md), les messages `state` arrivent souvent groupés en rafale après un
   * micro-décrochage au lieu d'un par tick à intervalle régulier. Baser l'interpolation sur l'heure
   * d'arrivée rendait alors le rythme de lecture directement dépendant de cette gigue réseau — la
   * cause du tressautement perceptible malgré un intervalle de lecture (`interpDelayMs`) déjà
   * confortable. En ancrant une seule fois sur un couple (tick, horloge client) puis en dérivant
   * tout le reste uniquement du numéro de tick (fixe, jamais affecté par le réseau), la cadence de
   * lecture réelle ne dépend plus QUE de la cadence de simulation du serveur (parfaitement
   * régulière, voir Room.tick()) — le réseau ne peut plus qu'introduire un petit décalage constant
   * (si le tout premier échantillon d'ancrage a eu une latence atypique), jamais une gigue
   * continue. */
  private epochTick: number | undefined;
  private epochClientMs: number | undefined;

  public reset(): void {
    this.snapshotQueue = [];
    this.missedTickCount = 0;
    this.lastKnownTick = undefined;
    this.epochTick = undefined;
    this.epochClientMs = undefined;
  }

  public pushSnapshot(entities: EntitySnapshot[], tick: number, serverTickRateHz?: number): void {
    if (serverTickRateHz && serverTickRateHz > 0) {
      this.serverTickRateHz = serverTickRateHz;
    }
    if (this.lastKnownTick !== undefined && tick > this.lastKnownTick + 1) {
      this.missedTickCount += tick - this.lastKnownTick - 1;
    }
    this.lastKnownTick = tick;

    const nowMs = performance.now();
    if (this.epochTick === undefined) {
      this.epochTick = tick;
      this.epochClientMs = nowMs;
    }
    const tickIntervalMs = 1000 / this.serverTickRateHz;
    const serverTimeMs = this.epochClientMs! + (tick - this.epochTick) * tickIntervalMs;

    this.snapshotQueue.push({ tick, serverTimeMs, entities });
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
    // Buffer confortable au regard de la gigue réseau réelle mesurée (~30ms d'écart-type sur une
    // connexion résidentielle typique) — un multiple de l'intervalle de tick plutôt qu'un delta
    // fixe, pour rester cohérent si la cadence serveur change (mode différent, futur réglage).
    const interpDelayMs = Math.max(80, stateIntervalMs * 3);
    const renderTime = performance.now() - interpDelayMs;

    let snapA: SnapshotItem | undefined;
    let snapB: SnapshotItem | undefined;

    if (this.snapshotQueue.length >= 2) {
      for (let i = 0; i < this.snapshotQueue.length - 1; i++) {
        const itemA = this.snapshotQueue[i];
        const itemB = this.snapshotQueue[i + 1];
        if (itemA && itemB && itemA.serverTimeMs <= renderTime && renderTime <= itemB.serverTimeMs) {
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
        if (first && second && renderTime < first.serverTimeMs) {
          snapA = first;
          snapB = second;
        } else if (lastPrev && lastCurr) {
          snapA = lastPrev;
          snapB = lastCurr;
        }
      }
    }

    let t = 0;
    if (snapA && snapB && snapB.serverTimeMs > snapA.serverTimeMs) {
      // `intervalMs` est ici TOUJOURS un multiple exact de l'intervalle de tick nominal (dérivé
      // du numéro de tick, jamais de l'heure d'arrivée) — contrairement à une approche basée sur
      // l'heure d'arrivée, une rafale réseau ne peut plus le rendre artificiellement petit. Au-delà
      // de t=1 (buffer à sec), l'extrapolation par vélocité déduite est donc fiable par
      // construction, plafonnée à MAX_EXTRAPOLATION_MS pour ne pas dériver sur une coupure longue.
      const intervalMs = snapB.serverTimeMs - snapA.serverTimeMs;
      const maxT = 1 + MAX_EXTRAPOLATION_MS / intervalMs;
      t = clamp((renderTime - snapA.serverTimeMs) / intervalMs, 0, maxT);
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
