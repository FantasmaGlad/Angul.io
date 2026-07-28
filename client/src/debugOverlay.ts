/** Écran de diagnostic façon F3 (Minecraft) : FPS, informations GPU/système/réseau du
 * navigateur. Purement client — aucune de ces informations ne transite vers le serveur.
 *
 * Règle de ce fichier (corrige un bug où l'écran affichait des valeurs inventées en repli) :
 * chaque métrique affichée doit être une mesure réelle. Une métrique non mesurable dans cette
 * architecture (ex. pas de Web Workers, pas de pipeline WebGL pour le rendu, pas de masse éjectée
 * dans la simulation) est omise plutôt que remplacée par un nombre plausible. */

export interface FrameStats {
  fps: number;
  frameTimeMs: number;
  p99Ms?: number;
}

/** Moyenne glissante du temps inter-frame sur les 60 dernières frames — assez pour lisser le
 * bruit d'une frame à l'autre sans masquer une vraie baisse de framerate soutenue. */
export function createFpsTracker(): { tick(now: number): FrameStats } {
  const MAX_SAMPLES = 60;
  const frameTimes: number[] = [];
  let lastFrameAt: number | undefined;

  return {
    tick(now: number): FrameStats {
      if (lastFrameAt !== undefined) {
        frameTimes.push(now - lastFrameAt);
        if (frameTimes.length > MAX_SAMPLES) frameTimes.shift();
      }
      lastFrameAt = now;

      if (frameTimes.length === 0) return { fps: 0, frameTimeMs: 0, p99Ms: 0 };
      const avg = frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length;

      const sorted = [...frameTimes].sort((a, b) => a - b);
      const p99Index = Math.min(sorted.length - 1, Math.floor(sorted.length * 0.99));
      const p99Ms = sorted[p99Index] ?? avg;

      return {
        fps: avg > 0 ? 1000 / avg : 0,
        frameTimeMs: avg,
        p99Ms,
      };
    },
  };
}

/** Cadence réelle d'arrivée des messages `state` du serveur, mesurée côté client sur une fenêtre
 * glissante d'1 seconde — sert de "Server TPS (current)" honnête (mesuré, pas juste la constante
 * annoncée par le serveur) : une vraie baisse de cadence (salon surchargé, réseau qui traîne) s'y
 * reflète, contrairement à une valeur fixe recopiée du `welcome`. */
export function createTickRateTracker(): { record(now: number): number } {
  const WINDOW_MS = 1000;
  const timestamps: number[] = [];

  return {
    record(now: number): number {
      timestamps.push(now);
      while (timestamps.length > 0 && now - timestamps[0]! > WINDOW_MS) timestamps.shift();
      return timestamps.length;
    },
  };
}

export interface GpuInfo {
  vendor: string;
  renderer: string;
}

export function detectGpuInfo(): GpuInfo | undefined {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ??
      canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return undefined;

    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return undefined;

    return {
      vendor: String(gl.getParameter(ext.UNMASKED_VENDOR_WEBGL)),
      renderer: String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)),
    };
  } catch {
    return undefined;
  }
}

export interface NetworkInfo {
  effectiveType?: string;
  downlinkMbps?: number;
  rttMs?: number;
}

export function detectNetworkInfo(): NetworkInfo | undefined {
  const connection = (
    navigator as unknown as {
      connection?: { effectiveType?: string; downlink?: number; rtt?: number };
    }
  ).connection;
  if (!connection) return undefined;
  return {
    effectiveType: connection.effectiveType,
    downlinkMbps: connection.downlink,
    rttMs: connection.rtt,
  };
}

export interface MemoryInfo {
  usedMb: number;
  totalMb: number;
  limitMb: number;
}

export function detectMemoryInfo(): MemoryInfo | undefined {
  const memory = (
    performance as unknown as {
      memory?: { usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number };
    }
  ).memory;
  if (!memory) return undefined;

  const toMb = (bytes: number) => Math.round(bytes / (1024 * 1024));
  return {
    usedMb: toMb(memory.usedJSHeapSize),
    totalMb: toMb(memory.totalJSHeapSize),
    limitMb: toMb(memory.jsHeapSizeLimit),
  };
}

export interface SystemInfo {
  hardwareConcurrency: number | undefined;
  deviceMemoryGb: number | undefined;
  screenWidth: number;
  screenHeight: number;
  devicePixelRatio: number;
}

export function detectSystemInfo(): SystemInfo {
  return {
    hardwareConcurrency:
      typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined,
    deviceMemoryGb:
      typeof navigator !== 'undefined'
        ? (navigator as unknown as { deviceMemory?: number }).deviceMemory
        : undefined,
    screenWidth: typeof window !== 'undefined' && window.screen ? window.screen.width : 1920,
    screenHeight: typeof window !== 'undefined' && window.screen ? window.screen.height : 1080,
    devicePixelRatio: typeof window !== 'undefined' ? window.devicePixelRatio : 1,
  };
}

export interface BatteryInfo {
  percent: number;
  charging: boolean;
}

/** API Battery Status (Chromium uniquement, dépréciée hors de ce moteur mais toujours
 * fonctionnelle) — `undefined` sur les navigateurs qui ne l'exposent pas (Firefox, Safari) :
 * l'appelant doit alors omettre la ligne plutôt qu'afficher une batterie inventée. */
export async function detectBatteryInfo(): Promise<BatteryInfo | undefined> {
  if (typeof navigator === 'undefined') return undefined;
  const getBattery = (
    navigator as unknown as {
      getBattery?: () => Promise<{ level: number; charging: boolean }>;
    }
  ).getBattery;
  if (!getBattery) return undefined;
  try {
    const battery = await getBattery();
    return { percent: Math.round(battery.level * 100), charging: battery.charging };
  } catch {
    return undefined;
  }
}

export interface RenderStats {
  drawTimeMs?: number;
  drawCalls?: number;
  batches?: number;
  visibleEntities?: number;
  totalEntities?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  cameraScale?: number;
  dpiRatio?: number;
  p99Ms?: number;
  /** `undefined` = pas de plafond logiciel (Vsync ou palier "Illimité", voir settings.ts) : le
   * rendu suit alors le taux de rafraîchissement réel de l'écran, illisible depuis le JS — on
   * l'indique comme tel plutôt que d'inventer un chiffre (ex. 144Hz par défaut). */
  targetHz?: number;
}

export interface SimulationInfo {
  logicStepMs?: number;
  playersCount?: number;
  foodCount?: number;
  localX?: number;
  localY?: number;
  gridSector?: string;
}

export interface NetworkSyncInfo {
  rttMs?: number;
  serverTpsCurrent?: number;
  serverTpsTarget?: number;
  netInKbps?: number;
  netInPktSec?: number;
  netOutKbps?: number;
  interpBufferMs?: number;
  interpSnapshots?: number;
  /** Ticks serveur jamais reçus depuis la connexion (voir RenderEngine.missedTickCount) — signale
   * un décrochage réseau (drop de bufferedAmount côté serveur, Wi-Fi instable...) même quand
   * l'extrapolation locale masque le trou visuellement. */
  missedTicks?: number;
}

export interface HardwareInfo {
  state?: string;
  batteryPercent?: number;
  batteryCharging?: boolean;
  cpuCores?: number;
}

export interface DebugSnapshot {
  fps: FrameStats;
  pingMs?: number;
  visibleEntities?: number;
  totalEntities?: number;
  roomId?: string;
  cameraScale?: number;
  gpu?: GpuInfo;
  network?: NetworkInfo;
  memory?: MemoryInfo;
  system?: SystemInfo;

  render?: RenderStats;
  simulation?: SimulationInfo;
  networkSync?: NetworkSyncInfo;
  hardware?: HardwareInfo;
}

/** Calcule le secteur de carte façon Agar/Minecraft (ex: B3) selon la position X, Y et mapSize. */
export function calculateGridSector(x: number, y: number, mapSize: number = 15000): string {
  let normX = x;
  let normY = y;
  if (x < 0 || y < 0) {
    normX = x + mapSize / 2;
    normY = y + mapSize / 2;
  }
  const clampedX = Math.max(0, Math.min(mapSize - 1, normX));
  const clampedY = Math.max(0, Math.min(mapSize - 1, normY));

  const cols = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'];
  const colIndex = Math.min(cols.length - 1, Math.floor((clampedX / (mapSize || 1)) * cols.length));
  const rowIndex = Math.min(10, Math.floor((clampedY / (mapSize || 1)) * 10) + 1);
  return `${cols[colIndex] ?? 'A'}${rowIndex}`;
}

/** Formate le texte complet du diagnostic F3 — uniquement à partir de mesures réelles (voir
 * commentaire d'en-tête du fichier). Une valeur absente (non mesurable, ou pas encore reçue)
 * n'est jamais remplacée par un chiffre plausible : elle est omise (ligne entière) ou affichée
 * comme "—"/"Non disponible" selon le cas. */
export function formatDebugText(snapshot: DebugSnapshot): string {
  const lines: string[] = [];

  // 1. ENGINE & RENDER
  const fpsVal = snapshot.fps.fps;
  const frameTimeMs = snapshot.fps.frameTimeMs;
  const p99Ms = snapshot.render?.p99Ms ?? snapshot.fps.p99Ms ?? 0;
  const targetHz = snapshot.render?.targetHz;
  const drawTimeMs = snapshot.render?.drawTimeMs ?? 0;
  const drawCalls = snapshot.render?.drawCalls ?? 0;
  const batches = snapshot.render?.batches ?? 0;
  const visibles = snapshot.render?.visibleEntities ?? snapshot.visibleEntities ?? 0;
  const total = snapshot.render?.totalEntities ?? snapshot.totalEntities ?? 0;
  const culledPct = total > 0 ? Math.max(0, ((total - visibles) / total) * 100) : 0;
  const vw = snapshot.render?.viewportWidth ?? snapshot.system?.screenWidth ?? 0;
  const vh = snapshot.render?.viewportHeight ?? snapshot.system?.screenHeight ?? 0;
  const zoom = snapshot.render?.cameraScale ?? snapshot.cameraScale ?? 0;
  const dpi = snapshot.render?.dpiRatio ?? snapshot.system?.devicePixelRatio ?? 1;

  lines.push('-- ENGINE & RENDER --');
  lines.push(
    `FPS: ${fpsVal.toFixed(1)} (${frameTimeMs.toFixed(1)}ms) | p99: ${p99Ms.toFixed(1)}ms | ` +
      `Target: ${targetHz !== undefined ? `${targetHz}Hz` : 'Illimité (Vsync)'}`,
  );
  lines.push(`Draw Time: ${drawTimeMs.toFixed(1)}ms`);
  lines.push(
    `Draw Calls: ${drawCalls} | Batches: ${batches} | ` +
      `Visibles: ${visibles.toLocaleString('en-US')} / Total: ${total.toLocaleString('en-US')} ` +
      `(Culled: ${culledPct.toFixed(1)}%)`,
  );
  lines.push(`Viewport: ${vw}x${vh} (Zoom: ${zoom.toFixed(2)}x) | DPI Ratio: ${dpi.toFixed(2)}`);
  lines.push('');

  // 2. SIMULATION & LOGIC
  const logicStepMs = snapshot.simulation?.logicStepMs ?? 0;
  const playersCount = snapshot.simulation?.playersCount ?? 0;
  const foodCount = snapshot.simulation?.foodCount ?? 0;
  const posX = snapshot.simulation?.localX ?? 0;
  const posY = snapshot.simulation?.localY ?? 0;
  const gridSector = snapshot.simulation?.gridSector ?? calculateGridSector(posX, posY);

  lines.push('-- SIMULATION & LOGIC --');
  lines.push(`Logic Step: ${logicStepMs.toFixed(1)}ms`);
  lines.push(`Entities: ${visibles} (Players: ${playersCount}, Food: ${foodCount})`);
  lines.push(
    `Local Pos: X: ${posX.toFixed(1)}, Y: ${posY.toFixed(1)} | Grid Sector: ${gridSector}`,
  );
  lines.push('');

  // 3. NETWORK & SYNC
  const rttMs = snapshot.networkSync?.rttMs ?? snapshot.pingMs;
  const rttStr = rttMs !== undefined ? `${Math.round(rttMs)} ms` : '—';
  const tpsCur = snapshot.networkSync?.serverTpsCurrent;
  const tpsTgt = snapshot.networkSync?.serverTpsTarget;
  const tpsStr = tpsCur !== undefined && tpsTgt !== undefined ? `${tpsCur}/${tpsTgt}` : '—';
  const netInKbps = snapshot.networkSync?.netInKbps ?? 0;
  const netInPktSec = snapshot.networkSync?.netInPktSec ?? 0;
  const netOutKbps = snapshot.networkSync?.netOutKbps ?? 0;
  const connectionType = snapshot.network?.effectiveType;

  lines.push('-- NETWORK & SYNC --');
  lines.push(`RTT (Ping): ${rttStr} | Server TPS: ${tpsStr}`);
  lines.push(
    `Net In: ${netInKbps.toFixed(1)} KB/s (${netInPktSec} pkt/s) | Net Out: ${netOutKbps.toFixed(1)} KB/s` +
      (connectionType ? ` | Connexion: ${connectionType}` : ''),
  );
  if (snapshot.networkSync?.interpBufferMs !== undefined) {
    lines.push(
      `Interp Buffer: ${snapshot.networkSync.interpBufferMs} ms ` +
        `(${snapshot.networkSync.interpSnapshots ?? 1} snapshots)`,
    );
  }
  if (snapshot.networkSync?.missedTicks !== undefined) {
    lines.push(`Missed Ticks: ${snapshot.networkSync.missedTicks}`);
  }
  lines.push('');

  // 4. MEMORY — omise entièrement sur les navigateurs sans `performance.memory` (Firefox,
  // Safari) plutôt que d'inventer des Mo, contrairement à l'ancien comportement.
  if (snapshot.memory) {
    lines.push('-- MEMORY --');
    lines.push(`JS Heap: ${snapshot.memory.usedMb} / ${snapshot.memory.totalMb} MB`);
    lines.push('');
  }

  // 5. HARDWARE & SYSTEM
  const state =
    snapshot.hardware?.state ??
    (typeof document !== 'undefined' && document.hidden ? 'Background' : 'Active');
  const batteryStr =
    snapshot.hardware?.batteryPercent !== undefined
      ? `${snapshot.hardware.batteryPercent}% (${snapshot.hardware.batteryCharging ? 'Charging' : 'Discharging'})`
      : undefined;
  const cores = snapshot.hardware?.cpuCores ?? snapshot.system?.hardwareConcurrency;
  const gpuName = snapshot.gpu?.renderer ?? 'Non disponible (protection du navigateur)';

  lines.push('-- HARDWARE & SYSTEM --');
  lines.push(`State: ${state}` + (batteryStr ? ` | Battery: ${batteryStr}` : ''));
  lines.push(`CPU Cores: ${cores ?? '—'} | GPU: ${gpuName}`);

  return lines.join('\n');
}
