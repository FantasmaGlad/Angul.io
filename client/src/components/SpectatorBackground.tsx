import type { ServerMessage } from '@angulio/shared';
import { useEffect, useRef, useState } from 'react';
import { GameConnection } from '../net.js';
import { renderFrame, type Camera } from '../render.js';
import { RenderEngine } from '../renderEngine.js';

import {
  loadFpsSliderIndex,
  loadVsyncEnabled,
  minFrameIntervalMs as computeMinFrameIntervalMs,
} from '../settings.js';

const NO_NICKNAMES = new Map<string, string>();
const ROOM_SWITCH_DEBOUNCE_MS = 10;

interface SpectatorState {
  mapSize: number;
  camera: Camera;
  renderEngine: RenderEngine;
}

function computeFitCamera(mapSize: number, canvas: HTMLCanvasElement): Camera {
  const fitScale = Math.min(canvas.width / mapSize, canvas.height / mapSize);
  return { x: mapSize / 2, y: mapSize / 2, scale: fitScale };
}

interface SpectatorBackgroundProps {
  roomId: string | undefined;
  zooming: boolean;
}

export default function SpectatorBackground({ roomId, zooming }: SpectatorBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const stateRef = useRef<SpectatorState>({
    mapSize: 15000,
    camera: { x: 7500, y: 7500, scale: 0.1 },
    renderEngine: new RenderEngine(),
  });

  // Boucle de rendu — montée une seule fois, indépendante de `roomId`
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    function resizeCanvas(): void {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      stateRef.current.camera = computeFitCamera(stateRef.current.mapSize, canvas!);
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let rafId = 0;
    let lastFrameAt = 0;

    function frame(now: number): void {
      const minInterval = computeMinFrameIntervalMs(loadVsyncEnabled(), loadFpsSliderIndex());
      if (now - lastFrameAt >= minInterval) {
        const frameDt = Math.min(50, lastFrameAt > 0 ? now - lastFrameAt : 16);
        lastFrameAt = now;

        const { camera, renderEngine } = stateRef.current;
        const entities = renderEngine.getInterpolatedEntities(
          frameDt,
          camera,
          canvas!.width,
          canvas!.height,
          undefined,
          true,
        );
        renderFrame(ctx!, canvas!, entities, camera, NO_NICKNAMES);
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafId);
    };
  }, []);

  // Feedback visuel de bascule
  const [isSwitching, setIsSwitching] = useState(false);

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const targetRoomId = roomId || '1';
    setIsSwitching(true);

    let connection: GameConnection | undefined;
    const timeoutId = window.setTimeout(() => {
      const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
      connection = new GameConnection(
        `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(targetRoomId)}&spectate=1`,
      );
      connection.onClose(() => {
        setIsSwitching(false);
      });
      let tickRateHz: number | undefined;
      connection.onMessage((message: ServerMessage) => {
        if (message.type === 'welcome') {
          tickRateHz = message.tickRateHz;
          stateRef.current.mapSize = message.mapSize;
          stateRef.current.renderEngine.reset();
          const canvas = canvasRef.current;
          if (canvas) stateRef.current.camera = computeFitCamera(message.mapSize, canvas);
          setIsSwitching(false);
        } else if (message.type === 'state') {
          stateRef.current.renderEngine.pushSnapshot(message.entities, tickRateHz);
        }
      });
    }, ROOM_SWITCH_DEBOUNCE_MS);

    return () => {
      window.clearTimeout(timeoutId);
      connection?.close();
    };
  }, [roomId]);

  return (
    <canvas
      ref={canvasRef}
      className={`spectator-background${zooming ? ' zooming' : ''}${isSwitching ? ' switching' : ''}`}
      aria-hidden="true"
    />
  );
}
