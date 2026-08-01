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
/** Réactivité de la moyenne mobile de gigue (voir `RenderEngine.jitterEmaMs`) — assez rapide pour
 * suivre une vraie dégradation en quelques secondes (à 30Hz, ~10 échantillons), assez lent pour ne
 * pas réagir au moindre pic isolé. */
const JITTER_SMOOTHING = 0.1;
/** Multiplicateur appliqué à la gigue mesurée pour dimensionner le buffer d'interpolation (voir
 * `getInterpolatedEntities`) — une marge généreuse plutôt qu'un ajustement au plus juste : sous-
 * dimensionner coûte des saccades visibles à chaque pic de gigue, sur-dimensionner ne coûte qu'un
 * peu de latence supplémentaire sur les entités distantes (jamais sur le blob du joueur, prédit
 * localement — voir prediction.ts). */
const JITTER_MARGIN_FACTOR = 3;
/** Fraction de pastilles de nourriture ('f') conservée en mode spectateur (fond animé de
 * l'accueil, voir SpectatorBackground.tsx) — sans culling viewport possible (la caméra spectateur
 * cadre TOUTE la carte, rien à exclure géométriquement), le coût d'interpolation/lissage était
 * sinon proportionnel au nombre d'entités du salon ENTIER (potentiellement plusieurs milliers de
 * pastilles, voir server/configs/*.json `food.density`), pour un simple décor d'arrière-plan
 * dézoomé où une pastille individuelle est de toute façon à peine visible (retour utilisateur :
 * lag du lobby). Les créatures (joueurs/bots, 'c') restent TOUJOURS toutes affichées — un plafond
 * générique type-agnostique (l'ancien `SPECTATOR_MAX_ENTITIES`) pouvait aussi bien sacrifier des
 * bots que de la nourriture, quand seule cette dernière est vraiment sacrifiable sans perte
 * perceptible. */
const SPECTATOR_FOOD_SAMPLE_RATE = 0.1;
const SPECTATOR_FOOD_SAMPLE_THRESHOLD = Math.floor(SPECTATOR_FOOD_SAMPLE_RATE * 0xffffffff);

/** Hash FNV-1a (32 bits) d'un id d'entité — permet un sous-échantillonnage DÉTERMINISTE (la même
 * pastille est gardée ou exclue d'un snapshot à l'autre tant qu'elle existe), contrairement à un
 * découpage par index de tableau qui changerait de sujet à chaque variation du nombre d'entités
 * (flicker constant, une nourriture différente "sampled" chaque frame).
 *
 * PAS un simple hash polynomial (`hash*31 + charCode`, essayé d'abord) : les id réels sont de
 * simples entiers décimaux séquentiels convertis en chaîne (`String(nextEntityId++)`, voir
 * World.spawnEntity côté serveur) — pour une chaîne aussi COURTE et régulière, ce hash polynomial
 * reste presque entièrement MONOTONE en la valeur numérique de l'id (jamais assez de caractères
 * pour vraiment déborder les 32 bits), donc PAS dispersé du tout par rapport au seuil de coupure :
 * mesuré, 100% des id "1".."1000000" passaient un seuil censé n'en garder que 10% (tout ou
 * quasiment rien selon la plage d'id en jeu, jamais réellement 10%) — la cause réelle du lobby
 * resté lent malgré le sous-échantillonnage (retour utilisateur). Le mélange XOR-puis-multiplication
 * de FNV-1a (constantes standard) reste bien dispersé même sur des chaînes courtes/séquentielles —
 * vérifié : ~10% ± quelques % sur toute plage d'id testée, du plus petit salon au plus peuplé. */
function hashEntityId(id: string): number {
  let hash = 0x811c9dc5; // FNV offset basis (32 bits)
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193); // FNV prime (32 bits)
  }
  return hash >>> 0;
}

/** Résultat mis en cache PAR RÉFÉRENCE de tableau brut (voir `subsampleForSpectator`) — le même
 * snapshot réseau (`SnapshotItem.entities`, poussé une fois par tick serveur, ~30Hz) est relu par
 * `getInterpolatedEntities` à CHAQUE frame de rendu (jusqu'à plusieurs centaines de fois/seconde
 * depuis la suppression du plafond FPS dédié du fond spectateur, voir SpectatorBackground.tsx) :
 * sans ce cache, le filtre ci-dessous (coût proportionnel au nombre d'entités du salon ENTIER)
 * s'exécutait en double (fromEntities + toEntities) à CHAQUE frame de rendu au lieu d'une seule
 * fois par tick réseau réellement reçu — la cause réelle du lag persistant après la seule
 * suppression du plafond FPS (retour utilisateur). Une `WeakMap` (pas de fuite mémoire : une
 * entrée disparaît automatiquement avec son tableau source une fois le snapshot expulsé de
 * `snapshotQueue`) plutôt qu'un champ sur `SnapshotItem` lui-même, pour ne pas coupler ce module
 * de rendu à la structure de `pushSnapshot`. */
const spectatorSampleCache = new WeakMap<EntitySnapshot[], EntitySnapshot[]>();

/** Ne sous-échantillonne QUE la nourriture ('f'), à taux fixe (voir `SPECTATOR_FOOD_SAMPLE_RATE`) —
 * les créatures ('c', joueurs/bots) sont toujours conservées intégralement. Mis en cache par
 * référence du tableau source (voir `spectatorSampleCache`). */
function subsampleForSpectator(entities: EntitySnapshot[]): EntitySnapshot[] {
  const cached = spectatorSampleCache.get(entities);
  if (cached) return cached;
  const sampled = entities.filter(
    (entity) => entity.k === 'c' || hashEntityId(entity.i) <= SPECTATOR_FOOD_SAMPLE_THRESHOLD,
  );
  spectatorSampleCache.set(entities, sampled);
  return sampled;
}

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
  /** Moyenne mobile (EMA) de l'écart entre l'intervalle d'ARRIVÉE réel de deux `state` consécutifs
   * et l'intervalle de tick nominal — pure mesure de gigue réseau, jamais utilisée pour la ligne
   * de temps de lecture elle-même (voir `epochTick`/`epochClientMs`) : sert uniquement à calibrer
   * `interpDelayMs` (voir `getInterpolatedEntities`). Sur une bonne connexion (gigue proche de 0),
   * le buffer de lecture reste au plancher — latence perçue minimale ; sur une connexion agitée
   * (gigue mesurée en production : ~30ms), il s'élargit automatiquement pour rester à l'abri des
   * saccades, sans imposer ce coût à tout le monde par défaut. */
  private jitterEmaMs = 0;
  private lastArrivalMs: number | undefined;
  /** Dernier délai d'interpolation effectivement appliqué (ms) — pur diagnostic (écran F3),
   * calculé à chaque `getInterpolatedEntities`. */
  public currentInterpDelayMs = 0;

  public reset(): void {
    this.snapshotQueue = [];
    this.missedTickCount = 0;
    this.lastKnownTick = undefined;
    this.epochTick = undefined;
    this.epochClientMs = undefined;
    this.jitterEmaMs = 0;
    this.lastArrivalMs = undefined;
    this.smoothMap.clear();
    this.knownFood.clear();
  }

  /** Nourriture accumulée persistante — le serveur ne réenvoie une pastille ('f') QUE si elle est
   * nouvellement entrée dans l'intérêt du joueur depuis son dernier envoi (delta réseau, voir
   * server/src/engine/worker/roomInstance.ts, cahier_des_charges_perf_reseau_grande_carte.md
   * §3.5) ; une pastille omise reste donc valable (elle ne bouge jamais après son spawn) tant
   * qu'elle n'a pas été explicitement retirée par une resynchronisation complète. Sans cette
   * couche, `pushSnapshot` ferait disparaître toute pastille omise dès le tick suivant : le reste
   * du pipeline (`getInterpolatedEntities`/`interpolateEntities`) travaille sur EXACTEMENT les
   * `entities` du dernier `SnapshotItem` reçu, jamais un historique cumulé — voir leur commentaire
   * respectif, inchangés par ce correctif. */
  private knownFood = new Map<string, EntitySnapshot>();

  /** `entitiesFull` — voir `WorldStateMessage.entitiesFull` (shared/src/protocol.ts) : `true`
   * (défaut, comportement historique) si `entities` est la liste COMPLÈTE et autoritaire de la
   * nourriture actuellement pertinente (spectateur/vue admin, resynchronisation périodique, repli
   * salon entier) — `knownFood` est alors REMPLACÉ, purgeant toute pastille mangée/quittée
   * l'intérêt ailleurs pendant la fenêtre de delta. `false` : `entities` ne contient QUE de la
   * nourriture nouvellement visible depuis le dernier envoi à CE joueur — fusionnée (upsert) dans
   * `knownFood` sans jamais rien retirer. Tradeoff assumé : une pastille mangée par un AUTRE
   * joueur pendant que je suis hors de portée de mise à jour peut rester affichée jusqu'à ma
   * prochaine resynchro (≤5s, voir interestFilter.ts `RESYNC_INTERVAL_SEC`) — sans conséquence de
   * gameplay, la collision reste autoritaire serveur, et elle disparaît de toute façon
   * instantanément si je m'en approche (voir render.ts, disparition instantanée à la collision). */
  public pushSnapshot(
    entities: EntitySnapshot[],
    tick: number,
    serverTickRateHz?: number,
    entitiesFull: boolean = true,
  ): void {
    if (serverTickRateHz && serverTickRateHz > 0) {
      this.serverTickRateHz = serverTickRateHz;
    }
    if (this.lastKnownTick !== undefined && tick > this.lastKnownTick + 1) {
      this.missedTickCount += tick - this.lastKnownTick - 1;
    }
    this.lastKnownTick = tick;

    const nowMs = performance.now();
    const tickIntervalMs = 1000 / this.serverTickRateHz;

    if (this.epochTick === undefined || this.epochClientMs === undefined) {
      this.epochTick = tick;
      this.epochClientMs = nowMs;
    } else {
      // Ajustement doux de l'ancrage d'horloge pour éviter la dérive temporelle post-gigue
      const expectedEpochMs = nowMs - (tick - this.epochTick) * tickIntervalMs;
      this.epochClientMs += (expectedEpochMs - this.epochClientMs) * 0.05;
    }
    if (this.lastArrivalMs !== undefined) {
      const deviationMs = Math.abs(nowMs - this.lastArrivalMs - tickIntervalMs);
      this.jitterEmaMs += (deviationMs - this.jitterEmaMs) * JITTER_SMOOTHING;
    }
    this.lastArrivalMs = nowMs;

    const serverTimeMs = this.epochClientMs! + (tick - this.epochTick) * tickIntervalMs;

    const pieces: EntitySnapshot[] = [];
    const receivedFood: EntitySnapshot[] = [];
    for (const entity of entities) {
      if (entity.k === 'f') receivedFood.push(entity);
      else pieces.push(entity);
    }
    if (entitiesFull) {
      this.knownFood.clear();
    }
    for (const food of receivedFood) this.knownFood.set(food.i, food);
    const mergedEntities =
      this.knownFood.size === 0 ? pieces : pieces.concat(Array.from(this.knownFood.values()));

    this.snapshotQueue.push({ tick, serverTimeMs, entities: mergedEntities });
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
    const minDelayMs = Math.max(70, stateIntervalMs * 2.1);
    const maxDelayMs = stateIntervalMs * 6;
    const interpDelayMs = clamp(
      stateIntervalMs * 2.1 + this.jitterEmaMs * JITTER_MARGIN_FACTOR,
      minDelayMs,
      maxDelayMs,
    );
    this.currentInterpDelayMs = interpDelayMs;
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

    const rawFromEntities = snapA ? snapA.entities : (this.snapshotQueue[0]?.entities ?? []);
    const rawToEntities = snapB ? snapB.entities : (this.snapshotQueue[this.snapshotQueue.length - 1]?.entities ?? []);

    // Culling AVANT interpolation/lissage, pas après (contrairement à l'ancien pipeline) :
    // `interpolateEntities` (juste en dessous) et le lissage exponentiel (`smoothed` plus bas)
    // allouent chacun un objet PAR ENTITÉ à CHAQUE FRAME DE RENDU (jusqu'à 240 fois/seconde), et
    // le second entretient en plus une `Map` persistante par entité (`smoothMap`) — un coût
    // proportionnel au nombre d'entités de `rawFromEntities`/`rawToEntities`. Même filtrées par
    // intérêt côté serveur (voir server/src/engine/worker/roomInstance.ts), ces listes restent
    // volontairement plus larges que ce que l'écran affiche réellement (marge de sécurité du
    // rayon d'intérêt, `INTEREST_SAFETY_MARGIN_WORLD_PX`, shared/src/camera.ts — couvre la
    // latence/le Dash/un grand écran) : culler d'abord réduit ce travail à ce que l'écran affiche
    // réellement, sans changer le résultat visuel — une entité cullée ici n'aurait de toute façon
    // jamais été dessinée par `renderFrame` (qui culle lui-même une seconde fois, bon marché,
    // juste avant de dessiner). Un spectateur (fond d'accueil dézoomé, voir
    // SpectatorBackground.tsx) voit tout le salon SANS filtrage par intérêt (voir §1.3
    // cahier_des_charges_perf_reseau_grande_carte.md) — culler n'y changerait rien, seulement
    // gaspillerait le calcul du viewport.
    const fromEntities = isSpectator
      ? subsampleForSpectator(rawFromEntities)
      : cullEntitiesForViewport(rawFromEntities, camera, viewportWidth, viewportHeight, selfPlayerId);
    const toEntities = isSpectator
      ? subsampleForSpectator(rawToEntities)
      : cullEntitiesForViewport(rawToEntities, camera, viewportWidth, viewportHeight, selfPlayerId);

    // Pour éviter tout pop visuel d'entité entre snapA et snapB, l'interpolation se fait d'abord
    const interpolated = interpolateEntities(fromEntities, toEntities, t);

    // Lissage exponentiel APPLIQUÉ AUSSI en mode spectateur (retour utilisateur : "les robots vus
    // depuis le lobby sont légèrement tremblotants, alors qu'en partie ils sont fluides") — une
    // ancienne optimisation sautait ce lissage pour le fond décoratif de l'accueil, en supposant
    // qu'un fond dézoomé n'en avait pas besoin ; ce n'est pas le cas en pratique : le tick réseau
    // réduit des spectateurs (SPECTATOR_TICK_DIVISOR, voir snapshotBuilder.ts) rend au contraire CE
    // lissage encore plus utile qu'en partie (intervalle entre deux points d'interpolation ~4x plus
    // long, donc tout micro-écart de découpage temporel proportionnellement plus visible). Le coût
    // (une allocation + un lookup Map par entité visible et par frame) reste négligeable : les
    // créatures sont peu nombreuses et la nourriture déjà sous-échantillonnée (voir
    // `subsampleForSpectator`).

    // Lissage exponentiel style Agar.io officiel : élimine le tressautement à 60/144/240 FPS
    const dtSec = Math.min(0.05, Math.max(0.001, frameDt / 1000));
    const lerpPosFactor = 1 - Math.exp(-24 * dtSec);
    const lerpRadiusFactor = 1 - Math.exp(-18 * dtSec);

    const seenIds = new Set<string>();
    const smoothed = interpolated.map((e) => {
      seenIds.add(e.i);
      let curr = this.smoothMap.get(e.i);
      if (!curr) {
        curr = { x: e.x, y: e.y, r: e.r };
        this.smoothMap.set(e.i, curr);
      } else {
        const dx = e.x - curr.x;
        const dy = e.y - curr.y;
        if (dx * dx + dy * dy > 40000) {
          curr.x = e.x;
          curr.y = e.y;
          curr.r = e.r;
        } else {
          curr.x += dx * lerpPosFactor;
          curr.y += dy * lerpPosFactor;
          curr.r += (e.r - curr.r) * lerpRadiusFactor;
        }
      }
      return {
        ...e,
        x: curr.x,
        y: curr.y,
        r: curr.r,
      };
    });

    if (this.smoothMap.size > seenIds.size + 100) {
      for (const id of this.smoothMap.keys()) {
        if (!seenIds.has(id)) this.smoothMap.delete(id);
      }
    }

    // Le culling a déjà eu lieu en amont (voir `fromEntities`/`toEntities` ci-dessus) — inutile de
    // le refaire ici sur le résultat interpolé/lissé.
    return smoothed;
  }

  private smoothMap = new Map<string, { x: number; y: number; r: number }>();
}
