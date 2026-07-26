/** Écran de diagnostic façon F3 (Minecraft) : FPS, informations GPU/système/réseau du
 * navigateur. Purement client — aucune de ces informations ne transite vers le serveur. */

export interface FrameStats {
  fps: number;
  frameTimeMs: number;
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

      if (frameTimes.length === 0) return { fps: 0, frameTimeMs: 0 };
      const avg = frameTimes.reduce((sum, t) => sum + t, 0) / frameTimes.length;
      return { fps: avg > 0 ? 1000 / avg : 0, frameTimeMs: avg };
    },
  };
}

export interface GpuInfo {
  vendor: string;
  renderer: string;
}

/** Interroge le "calculateur graphique" (GPU) via l'extension de debug WebGL — un canvas
 * jetable, jamais affiché, sert uniquement à l'introspection. Beaucoup de navigateurs
 * renvoient un nom générique (ex. "ANGLE (...)") plutôt que le modèle exact de carte
 * graphique, par protection contre le fingerprinting — c'est une limitation du navigateur,
 * pas un bug ici. `undefined` si WebGL ou l'extension sont indisponibles. */
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

/** Network Information API — non standard, Chrome/Edge/Android uniquement (absent de Firefox
 * et Safari) : `undefined` si non supportée par ce navigateur. */
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

/** `performance.memory` — non standard, Chrome/Edge uniquement : `undefined` sinon. */
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

/** Regroupe les lectures de globales navigateur (`navigator`/`window`) qui ne changent pas
 * pendant la session — à appeler une fois, pas à chaque frame. Séparé de `formatDebugText`
 * pour que celle-ci reste une fonction pure testable sans DOM. */
export function detectSystemInfo(): SystemInfo {
  return {
    hardwareConcurrency: navigator.hardwareConcurrency,
    deviceMemoryGb: (navigator as unknown as { deviceMemory?: number }).deviceMemory,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
    devicePixelRatio: window.devicePixelRatio,
  };
}

export interface DebugSnapshot {
  fps: FrameStats;
  pingMs: number | undefined;
  tick: number | undefined;
  visibleEntities: number;
  roomId: string | undefined;
  cameraScale: number;
  gpu: GpuInfo | undefined;
  network: NetworkInfo | undefined;
  memory: MemoryInfo | undefined;
  system: SystemInfo;
}

/** Formate le texte complet de l'écran F3 à partir d'un instantané de diagnostic — fonction
 * pure (testable), aucune lecture de `navigator`/`window` ici (voir `detectSystemInfo`) : rend
 * cette fonction indépendante du DOM, séparée de la mise à jour de l'écran (`index.ts`). */
export function formatDebugText(snapshot: DebugSnapshot): string {
  const lines: string[] = [];
  lines.push(`Angul.io — diagnostic (F3)`);
  lines.push(
    `FPS: ${snapshot.fps.fps.toFixed(0)} (${snapshot.fps.frameTimeMs.toFixed(1)} ms/frame)`,
  );
  lines.push(`Ping: ${snapshot.pingMs !== undefined ? `${snapshot.pingMs.toFixed(0)} ms` : '—'}`);
  lines.push(`Salon: ${snapshot.roomId ?? '—'} | Tick: ${snapshot.tick ?? '—'}`);
  lines.push(
    `Entités visibles: ${snapshot.visibleEntities} | Zoom: ${snapshot.cameraScale.toFixed(2)}×`,
  );
  lines.push('');
  lines.push('— Système —');
  lines.push(`Cœurs CPU (logiques): ${snapshot.system.hardwareConcurrency ?? '—'}`);
  lines.push(
    `RAM approx. (navigateur): ${snapshot.system.deviceMemoryGb !== undefined ? `${snapshot.system.deviceMemoryGb} Go` : '—'}`,
  );
  if (snapshot.memory) {
    lines.push(
      `Tas JS: ${snapshot.memory.usedMb}/${snapshot.memory.totalMb} Mo (limite ${snapshot.memory.limitMb} Mo)`,
    );
  } else {
    lines.push('Tas JS: — (non exposé par ce navigateur)');
  }
  lines.push(
    `Écran: ${snapshot.system.screenWidth}×${snapshot.system.screenHeight} (pixel ratio ${snapshot.system.devicePixelRatio})`,
  );
  lines.push('');
  lines.push('— Réseau —');
  if (snapshot.network) {
    lines.push(
      `Type: ${snapshot.network.effectiveType ?? '—'} | Débit: ${snapshot.network.downlinkMbps ?? '—'} Mb/s | RTT navigateur: ${snapshot.network.rttMs ?? '—'} ms`,
    );
  } else {
    lines.push('— (Network Information API non supportée par ce navigateur)');
  }
  lines.push('');
  lines.push('— Graphique —');
  if (snapshot.gpu) {
    lines.push(`Fournisseur: ${snapshot.gpu.vendor}`);
    lines.push(`Rendu: ${snapshot.gpu.renderer}`);
  } else {
    lines.push('— (WEBGL_debug_renderer_info non disponible)');
  }

  return lines.join('\n');
}
