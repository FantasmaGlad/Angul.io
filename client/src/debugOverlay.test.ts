import { describe, expect, it } from 'vitest';
import { calculateGridSector, createFpsTracker, createTickRateTracker, formatDebugText } from './debugOverlay.js';

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

describe('createTickRateTracker', () => {
  it('compte les messages reçus sur la fenêtre glissante d’1 seconde', () => {
    const tracker = createTickRateTracker();
    // 20 messages espacés de 50ms (20 Hz), sur 1 seconde.
    let count = 0;
    for (let i = 0; i < 20; i++) count = tracker.record(i * 50);
    expect(count).toBe(20);
  });

  it('oublie les messages sortis de la fenêtre glissante', () => {
    const tracker = createTickRateTracker();
    tracker.record(0);
    tracker.record(100);
    const count = tracker.record(2000); // loin après la fenêtre de 1000ms : les 2 précédents sortent
    expect(count).toBe(1);
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
  it('affiche uniquement des métriques réelles quand tout est fourni', () => {
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
      render: {
        drawTimeMs: 1.2,
        drawCalls: 12,
        batches: 3,
        visibleEntities: 715,
        totalEntities: 15000,
        viewportWidth: 1920,
        viewportHeight: 1080,
        cameraScale: 1.8,
        dpiRatio: 1.25,
        targetHz: 144,
      },
      simulation: {
        logicStepMs: 0.8,
        playersCount: 12,
        foodCount: 690,
        localX: 4821.5,
        localY: -1204.2,
        gridSector: 'B3',
      },
      networkSync: {
        rttMs: 18,
        serverTpsCurrent: 20,
        serverTpsTarget: 20,
        netInKbps: 24.5,
        netInPktSec: 20,
        netOutKbps: 2.1,
        interpBufferMs: 50,
        interpSnapshots: 2,
      },
      hardware: {
        cpuCores: 16,
        batteryPercent: 98,
        batteryCharging: false,
      },
    });

    expect(text).toContain('-- ENGINE & RENDER --');
    expect(text).toContain('FPS: 60.0 (16.6ms) | p99: 18.2ms | Target: 144Hz');
    expect(text).toContain('Draw Time: 1.2ms');
    expect(text).toContain(
      'Draw Calls: 12 | Batches: 3 | Visibles: 715 / Total: 15,000 (Culled: 95.2%)',
    );
    expect(text).toContain('Viewport: 1920x1080 (Zoom: 1.80x) | DPI Ratio: 1.25');

    expect(text).toContain('-- SIMULATION & LOGIC --');
    expect(text).toContain('Logic Step: 0.8ms');
    expect(text).toContain('Entities: 715 (Players: 12, Food: 690)');
    expect(text).toContain('Local Pos: X: 4821.5, Y: -1204.2 | Grid Sector: B3');

    expect(text).toContain('-- NETWORK & SYNC --');
    expect(text).toContain('RTT (Ping): 18 ms | Server TPS: 20/20');
    expect(text).toContain('Net In: 24.5 KB/s (20 pkt/s) | Net Out: 2.1 KB/s | Connexion: 4g');
    expect(text).toContain('Interp Buffer: 50 ms (2 snapshots)');

    expect(text).toContain('-- MEMORY --');
    expect(text).toContain('JS Heap: 11 / 43 MB');

    expect(text).toContain('-- HARDWARE & SYSTEM --');
    expect(text).toContain('State: Active | Battery: 98% (Discharging)');
    expect(text).toContain('CPU Cores: 16 | GPU: AMD Radeon 780M (ANGLE WebGL2)');

    // Aucune trace des anciennes sections/valeurs inventées.
    expect(text).not.toContain('THREADING');
    expect(text).not.toContain('Ejected');
    expect(text).not.toContain('Spatial Checks');
    expect(text).not.toContain('Reconciliations');
    expect(text).not.toContain('Object Pools');
    expect(text).not.toContain('VRAM');
    expect(text).not.toContain('Power Saver');
  });

  it('omet les lignes non mesurables plutôt que d’inventer une valeur, quand les données manquent', () => {
    const text = formatDebugText({
      fps: { fps: 0, frameTimeMs: 0, p99Ms: 0 },
    });

    // Pas de plafond FPS choisi (Vsync) : cible textuelle, pas un chiffre inventé.
    expect(text).toContain('Target: Illimité (Vsync)');
    // Pas de ping reçu, pas de TPS serveur connu : tirets plutôt que 0 ou une valeur plausible.
    expect(text).toContain('RTT (Ping): — | Server TPS: —');
    // Pas de `performance.memory` (ex. Firefox/Safari) : section entière omise.
    expect(text).not.toContain('-- MEMORY --');
    // Pas de GPU lisible (protection navigateur) : message explicite, pas un nom de carte inventé.
    expect(text).toContain('GPU: Non disponible (protection du navigateur)');
    // Pas de batterie détectée : pas de segment "Battery" du tout.
    expect(text).toContain('State: Active');
    expect(text).not.toContain('Battery');
  });
});
