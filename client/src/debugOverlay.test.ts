import { describe, expect, it } from 'vitest';
import { calculateGridSector, createFpsTracker, formatDebugText } from './debugOverlay.js';

describe('createFpsTracker', () => {
  it('renvoie 0 sur le tout premier tick (pas encore de delta mesurable)', () => {
    const tracker = createFpsTracker();
    expect(tracker.tick(0)).toEqual({ fps: 0, frameTimeMs: 0, p99Ms: 0 });
  });

  it('calcule ~60fps pour des frames régulières à 16.67ms', () => {
    const tracker = createFpsTracker();
    tracker.tick(0);
    let last = { fps: 0, frameTimeMs: 0, p99Ms: 0 };
    for (let i = 1; i <= 10; i++) last = tracker.tick(i * 16.67);

    expect(last.fps).toBeCloseTo(60, 0);
    expect(last.frameTimeMs).toBeCloseTo(16.67, 1);
  });

  it('lisse sur une fenêtre glissante plutôt que de ne garder que la dernière frame', () => {
    const tracker = createFpsTracker();
    tracker.tick(0);
    tracker.tick(10); // 10ms (100fps)
    const result = tracker.tick(60); // 50ms (20fps) — moyenne des deux : ~33fps
    expect(result.fps).toBeGreaterThan(20);
    expect(result.fps).toBeLessThan(100);
  });
});

describe('calculateGridSector', () => {
  it('calcule correctement les secteurs de carte', () => {
    expect(calculateGridSector(0, 0, 15000)).toBe('A1');
    expect(calculateGridSector(2000, 3500, 15000)).toBe('B3');
    expect(calculateGridSector(14999, 14999, 15000)).toBe('J10');
  });
});

describe('formatDebugText', () => {
  it('inclut toutes les sections et métriques F3', () => {
    const text = formatDebugText({
      fps: { fps: 60.0, frameTimeMs: 16.6, p99Ms: 18.2 },
      pingMs: 18,
      visibleEntities: 715,
      totalEntities: 15000,
      cameraScale: 1.8,
      gpu: { vendor: 'AMD', renderer: 'AMD Radeon 780M (ANGLE WebGL2)' },
      network: { effectiveType: '4g', downlinkMbps: 10, rttMs: 18 },
      memory: { usedMb: 11, totalMb: 43, limitMb: 512 },
      system: {
        hardwareConcurrency: 16,
        deviceMemoryGb: 16,
        screenWidth: 1920,
        screenHeight: 1080,
        devicePixelRatio: 1.25,
      },
      threading: {
        mainThreadLagMs: 0.4,
        longTasksLast10s: 0,
        activeWorkers: 4,
        workerRttMs: 0.8,
        transferRateKbps: 450,
        sharedArrayBuffers: true,
      },
      render: {
        drawTimeMs: 1.2,
        gpuTimeMs: 2.1,
        drawCalls: 12,
        batches: 3,
        visibleEntities: 715,
        totalEntities: 15000,
        viewportWidth: 1920,
        viewportHeight: 1080,
        cameraScale: 1.8,
        dpiRatio: 1.25,
      },
      simulation: {
        logicStepMs: 0.8,
        spatialChecks: 184,
        playersCount: 12,
        foodCount: 690,
        ejectedCount: 13,
        localX: 4821.5,
        localY: -1204.2,
        gridSector: 'B3',
      },
      networkSync: {
        rttMs: 18,
        serverTpsCurrent: 60,
        serverTpsTarget: 60,
        netInKbps: 24.5,
        netInPktSec: 60,
        netOutKbps: 2.1,
        interpBufferMs: 32,
        interpSnapshots: 2,
        reconciliationsPerSec: 0,
      },
      memoryResources: {
        usedMb: 11,
        totalMb: 43,
        allocRateKbps: 120,
        foodPoolUsed: 690,
        foodPoolMax: 1000,
        particlesPoolUsed: 45,
        particlesPoolMax: 500,
        vramApproxMb: 14.2,
        texturesCount: 4,
        buffersCount: 8,
      },
      hardware: {
        state: 'Active',
        powerSaver: false,
        batteryStatusText: '98% (Charching)',
        cpuCores: 16,
      },
    });

    expect(text).toContain('-- THREADING & WORKERS --');
    expect(text).toContain('Main Thread Lag: 0.4 ms | Long Tasks (last 10s): 0');
    expect(text).toContain('Active Workers: 4 / 16 Cores | Worker RTT: 0.8 ms');
    expect(text).toContain('Transfer Rate: 450 KB/s (SharedArrayBuffers)');

    expect(text).toContain('-- ENGINE & RENDER --');
    expect(text).toContain('FPS: 60.0 (16.6ms) | p99: 18.2ms | Target: 144Hz');
    expect(text).toContain('Draw Time: 1.2ms | GPU Time: 2.1ms');
    expect(text).toContain(
      'Draw Calls: 12 | Batches: 3 | Visibles: 715 / Total: 15,000 (Culled: 95.2%)',
    );
    expect(text).toContain('Viewport: 1920x1080 (Zoom: 1.80x) | DPI Ratio: 1.25');

    expect(text).toContain('-- SIMULATION & LOGIC --');
    expect(text).toContain('Logic Step: 0.8ms | Spatial Checks: 184/frame');
    expect(text).toContain('Entities: 715 (Players: 12, Food: 690, Ejected: 13)');
    expect(text).toContain('Local Pos: X: 4821.5, Y: -1204.2 | Grid Sector: B3');

    expect(text).toContain('-- NETWORK & SYNC (WebRTC/WS) --');
    expect(text).toContain('RTT (Ping): 18 ms | Server TPS: 60/60');
    expect(text).toContain('Net In: 24.5 KB/s (60 pkt/s) | Net Out: 2.1 KB/s');
    expect(text).toContain('Interp Buffer: 32 ms (2 snapshots) | Reconciliations: 0/s');

    expect(text).toContain('-- MEMORY & RESOURCES --');
    expect(text).toContain('JS Heap: 11 / 43 MB (Alloc Rate: ~120 KB/s)');
    expect(text).toContain('Object Pools: Food (690/1000), Particles (45/500)');
    expect(text).toContain('VRAM Approx: 14.2 MB (Textures: 4, Buffers: 8)');

    expect(text).toContain('-- HARDWARE & SYSTEM --');
    expect(text).toContain('State: Active | Power Saver: Off | Battery: 98% (Charching)');
    expect(text).toContain('CPU Cores: 16 | GPU: AMD Radeon 780M (ANGLE WebGL2)');
  });
});
