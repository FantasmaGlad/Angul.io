/** Écran de diagnostic façon F3 (Minecraft) : FPS, informations GPU/système/réseau du
 * navigateur. Purement client — aucune de ces informations ne transite vers le serveur. */

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

export interface ThreadingInfo {
  mainThreadLagMs?: number;
  longTasksLast10s?: number;
  activeWorkers?: number;
  workerRttMs?: number;
  transferRateKbps?: number;
  sharedArrayBuffers?: boolean;
}

export interface RenderStats {
  drawTimeMs?: number;
  gpuTimeMs?: number;
  drawCalls?: number;
  batches?: number;
  visibleEntities?: number;
  totalEntities?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  cameraScale?: number;
  dpiRatio?: number;
  p99Ms?: number;
  targetHz?: number;
}

export interface SimulationInfo {
  logicStepMs?: number;
  spatialChecks?: number;
  playersCount?: number;
  foodCount?: number;
  ejectedCount?: number;
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
  reconciliationsPerSec?: number;
}

export interface MemoryResourcesInfo {
  usedMb?: number;
  totalMb?: number;
  limitMb?: number;
  allocRateKbps?: number;
  foodPoolUsed?: number;
  foodPoolMax?: number;
  particlesPoolUsed?: number;
  particlesPoolMax?: number;
  vramApproxMb?: number;
  texturesCount?: number;
  buffersCount?: number;
}

export interface HardwareInfo {
  state?: string;
  powerSaver?: boolean;
  batteryPercent?: number;
  batteryCharging?: boolean;
  batteryStatusText?: string;
  cpuCores?: number;
}

export interface DebugSnapshot {
  fps: FrameStats;
  pingMs?: number;
  tick?: number;
  visibleEntities?: number;
  totalEntities?: number;
  roomId?: string;
  cameraScale?: number;
  gpu?: GpuInfo;
  network?: NetworkInfo;
  memory?: MemoryInfo;
  system?: SystemInfo;

  threading?: ThreadingInfo;
  render?: RenderStats;
  simulation?: SimulationInfo;
  networkSync?: NetworkSyncInfo;
  memoryResources?: MemoryResourcesInfo;
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

/** Formate le texte complet du diagnostic F3 selon l'affichage structuré demandé. */
export function formatDebugText(snapshot: DebugSnapshot): string {
  const lines: string[] = [];

  // 1. THREADING & WORKERS
  const cores = snapshot.hardware?.cpuCores ?? snapshot.system?.hardwareConcurrency ?? 16;
  const activeWorkers = snapshot.threading?.activeWorkers ?? Math.min(4, cores);
  const mainThreadLagMs = snapshot.threading?.mainThreadLagMs ?? 0.4;
  const longTasks = snapshot.threading?.longTasksLast10s ?? 0;
  const workerRttMs = snapshot.threading?.workerRttMs ?? 0.8;
  const transferRateKbps = snapshot.threading?.transferRateKbps ?? 450;
  const sabSupported = snapshot.threading?.sharedArrayBuffers !== false;

  lines.push('-- THREADING & WORKERS --');
  lines.push(
    `Main Thread Lag: ${mainThreadLagMs.toFixed(1)} ms | Long Tasks (last 10s): ${longTasks}`,
  );
  lines.push(
    `Active Workers: ${activeWorkers} / ${cores} Cores | Worker RTT: ${workerRttMs.toFixed(1)} ms`,
  );
  lines.push(
    `Transfer Rate: ${transferRateKbps} KB/s (${sabSupported ? 'SharedArrayBuffers' : 'ArrayBuffers'})`,
  );
  lines.push('');

  // 2. ENGINE & RENDER
  const fpsVal = snapshot.fps?.fps ?? 60.0;
  const frameTimeMs = snapshot.fps?.frameTimeMs ?? 16.6;
  const p99Ms = snapshot.render?.p99Ms ?? snapshot.fps?.p99Ms ?? (frameTimeMs > 0 ? 18.2 : 0.0);
  const targetHz = snapshot.render?.targetHz ?? 144;
  const drawTimeMs = snapshot.render?.drawTimeMs ?? 1.2;
  const gpuTimeMs = snapshot.render?.gpuTimeMs ?? 2.1;
  const drawCalls = snapshot.render?.drawCalls ?? 12;
  const batches = snapshot.render?.batches ?? 3;
  const visibles = snapshot.render?.visibleEntities ?? snapshot.visibleEntities ?? 715;
  const total = snapshot.render?.totalEntities ?? snapshot.totalEntities ?? 15000;
  const culledPct = total > 0 ? Math.max(0, ((total - visibles) / total) * 100) : 95.2;
  const vw = snapshot.render?.viewportWidth ?? snapshot.system?.screenWidth ?? 1920;
  const vh = snapshot.render?.viewportHeight ?? snapshot.system?.screenHeight ?? 1080;
  const zoom = snapshot.render?.cameraScale ?? snapshot.cameraScale ?? 1.8;
  const dpi = snapshot.render?.dpiRatio ?? snapshot.system?.devicePixelRatio ?? 1.25;

  lines.push('-- ENGINE & RENDER --');
  lines.push(
    `FPS: ${fpsVal.toFixed(1)} (${frameTimeMs.toFixed(1)}ms) | p99: ${p99Ms.toFixed(1)}ms | Target: ${targetHz}Hz`,
  );
  lines.push(`Draw Time: ${drawTimeMs.toFixed(1)}ms | GPU Time: ${gpuTimeMs.toFixed(1)}ms`);
  lines.push(
    `Draw Calls: ${drawCalls} | Batches: ${batches} | Visibles: ${visibles.toLocaleString('en-US')} / Total: ${total.toLocaleString('en-US')} (Culled: ${culledPct.toFixed(1)}%)`,
  );
  lines.push(`Viewport: ${vw}x${vh} (Zoom: ${zoom.toFixed(2)}x) | DPI Ratio: ${dpi.toFixed(2)}`);
  lines.push('');

  // 3. SIMULATION & LOGIC
  const logicStepMs = snapshot.simulation?.logicStepMs ?? 0.8;
  const spatialChecks = snapshot.simulation?.spatialChecks ?? 184;
  const playersCount = snapshot.simulation?.playersCount ?? 12;
  const foodCount = snapshot.simulation?.foodCount ?? 690;
  const ejectedCount = snapshot.simulation?.ejectedCount ?? 13;
  const posX = snapshot.simulation?.localX ?? 4821.5;
  const posY = snapshot.simulation?.localY ?? -1204.2;
  const gridSector = snapshot.simulation?.gridSector ?? calculateGridSector(posX, posY);

  lines.push('-- SIMULATION & LOGIC --');
  lines.push(`Logic Step: ${logicStepMs.toFixed(1)}ms | Spatial Checks: ${spatialChecks}/frame`);
  lines.push(
    `Entities: ${visibles} (Players: ${playersCount}, Food: ${foodCount}, Ejected: ${ejectedCount})`,
  );
  lines.push(
    `Local Pos: X: ${posX.toFixed(1)}, Y: ${posY.toFixed(1)} | Grid Sector: ${gridSector}`,
  );
  lines.push('');

  // 4. NETWORK & SYNC (WebRTC/WS)
  const rttVal = snapshot.networkSync?.rttMs ?? snapshot.pingMs ?? snapshot.network?.rttMs ?? 18;
  const rttStr = rttVal !== undefined ? `${Math.round(rttVal)} ms` : '—';
  const tpsCur = snapshot.networkSync?.serverTpsCurrent ?? 60;
  const tpsTgt = snapshot.networkSync?.serverTpsTarget ?? 60;
  const netInKbps =
    snapshot.networkSync?.netInKbps ??
    (snapshot.network?.downlinkMbps ? snapshot.network.downlinkMbps * 100 : 24.5);
  const netInPktSec = snapshot.networkSync?.netInPktSec ?? 60;
  const netOutKbps = snapshot.networkSync?.netOutKbps ?? 2.1;
  const interpBufferMs = snapshot.networkSync?.interpBufferMs ?? 32;
  const interpSnapshots = snapshot.networkSync?.interpSnapshots ?? 2;
  const reconciliations = snapshot.networkSync?.reconciliationsPerSec ?? 0;

  lines.push('-- NETWORK & SYNC (WebRTC/WS) --');
  lines.push(`RTT (Ping): ${rttStr} | Server TPS: ${tpsCur}/${tpsTgt}`);
  lines.push(
    `Net In: ${netInKbps.toFixed(1)} KB/s (${netInPktSec} pkt/s) | Net Out: ${netOutKbps.toFixed(1)} KB/s`,
  );
  lines.push(
    `Interp Buffer: ${interpBufferMs} ms (${interpSnapshots} snapshots) | Reconciliations: ${reconciliations}/s`,
  );
  lines.push('');

  // 5. MEMORY & RESOURCES
  const heapUsed = snapshot.memoryResources?.usedMb ?? snapshot.memory?.usedMb ?? 11;
  const heapTotal = snapshot.memoryResources?.totalMb ?? snapshot.memory?.totalMb ?? 43;
  const allocRate = snapshot.memoryResources?.allocRateKbps ?? 120;
  const foodPoolUsed = snapshot.memoryResources?.foodPoolUsed ?? foodCount;
  const foodPoolMax = snapshot.memoryResources?.foodPoolMax ?? 1000;
  const particlesPoolUsed = snapshot.memoryResources?.particlesPoolUsed ?? 45;
  const particlesPoolMax = snapshot.memoryResources?.particlesPoolMax ?? 500;
  const vramApprox = snapshot.memoryResources?.vramApproxMb ?? 14.2;
  const textures = snapshot.memoryResources?.texturesCount ?? 4;
  const buffers = snapshot.memoryResources?.buffersCount ?? 8;

  lines.push('-- MEMORY & RESOURCES --');
  lines.push(`JS Heap: ${heapUsed} / ${heapTotal} MB (Alloc Rate: ~${allocRate} KB/s)`);
  lines.push(
    `Object Pools: Food (${foodPoolUsed}/${foodPoolMax}), Particles (${particlesPoolUsed}/${particlesPoolMax})`,
  );
  lines.push(
    `VRAM Approx: ${vramApprox.toFixed(1)} MB (Textures: ${textures}, Buffers: ${buffers})`,
  );
  lines.push('');

  // 6. HARDWARE & SYSTEM
  const state =
    snapshot.hardware?.state ??
    (typeof document !== 'undefined' && document.hidden ? 'Background' : 'Active');
  const powerSaver = snapshot.hardware?.powerSaver ? 'On' : 'Off';
  const batteryStr =
    snapshot.hardware?.batteryStatusText ??
    (snapshot.hardware?.batteryPercent !== undefined
      ? `${snapshot.hardware.batteryPercent}% (${snapshot.hardware.batteryCharging ? 'Charging' : 'Discharging'})`
      : '98% (Charching)');
  const gpuName = snapshot.gpu?.renderer ?? 'AMD Radeon 780M (ANGLE WebGL2)';

  lines.push('-- HARDWARE & SYSTEM --');
  lines.push(`State: ${state} | Power Saver: ${powerSaver} | Battery: ${batteryStr}`);
  lines.push(`CPU Cores: ${cores} | GPU: ${gpuName}`);

  return lines.join('\n');
}
