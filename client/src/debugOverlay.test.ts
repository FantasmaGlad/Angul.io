import { describe, expect, it } from 'vitest';
import { createFpsTracker, formatDebugText } from './debugOverlay.js';

describe('createFpsTracker', () => {
  it('renvoie 0 sur le tout premier tick (pas encore de delta mesurable)', () => {
    const tracker = createFpsTracker();
    expect(tracker.tick(0)).toEqual({ fps: 0, frameTimeMs: 0 });
  });

  it('calcule ~60fps pour des frames régulières à 16.67ms', () => {
    const tracker = createFpsTracker();
    tracker.tick(0);
    let last: { fps: number; frameTimeMs: number } = { fps: 0, frameTimeMs: 0 };
    for (let i = 1; i <= 10; i++) last = tracker.tick(i * 16.67);

    expect(last.fps).toBeCloseTo(60, 0);
    expect(last.frameTimeMs).toBeCloseTo(16.67, 1);
  });

  it('lisse sur une fenêtre glissante plutôt que de ne garder que la dernière frame', () => {
    const tracker = createFpsTracker();
    tracker.tick(0);
    tracker.tick(10); // 10ms (100fps)
    const result = tracker.tick(60); // 50ms (20fps) — moyenne des deux : ~33fps, pas 20fps pile
    expect(result.fps).toBeGreaterThan(20);
    expect(result.fps).toBeLessThan(100);
  });
});

describe('formatDebugText', () => {
  it('inclut les informations essentielles quand tout est disponible', () => {
    const text = formatDebugText({
      fps: { fps: 59.6, frameTimeMs: 16.8 },
      pingMs: 42,
      tick: 123,
      visibleEntities: 87,
      roomId: '7',
      cameraScale: 1.25,
      gpu: { vendor: 'Test Vendor', renderer: 'Test Renderer' },
      network: { effectiveType: '4g', downlinkMbps: 10, rttMs: 50 },
      memory: { usedMb: 12, totalMb: 20, limitMb: 512 },
      system: {
        hardwareConcurrency: 8,
        deviceMemoryGb: 16,
        screenWidth: 1920,
        screenHeight: 1080,
        devicePixelRatio: 2,
      },
    });

    expect(text).toContain('FPS: 60');
    expect(text).toContain('Ping: 42 ms');
    expect(text).toContain('Salon: 7 | Tick: 123');
    expect(text).toContain('Entités visibles: 87');
    expect(text).toContain('Test Renderer');
    expect(text).toContain('4g');
    expect(text).toContain('12/20 Mo');
  });

  it('affiche des tirets plutôt que de planter quand une source est indisponible', () => {
    const text = formatDebugText({
      fps: { fps: 0, frameTimeMs: 0 },
      pingMs: undefined,
      tick: undefined,
      visibleEntities: 0,
      roomId: undefined,
      cameraScale: 1,
      gpu: undefined,
      network: undefined,
      memory: undefined,
      system: {
        hardwareConcurrency: undefined,
        deviceMemoryGb: undefined,
        screenWidth: 0,
        screenHeight: 0,
        devicePixelRatio: 1,
      },
    });

    expect(text).toContain('Ping: —');
    expect(text).toContain('non exposé par ce navigateur');
    expect(text).toContain('non supportée par ce navigateur');
    expect(text).toContain('non disponible');
  });
});
