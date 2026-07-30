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

/** Ajuste la carte à l'espace RÉELLEMENT visible du viewport, pas au viewport entier — la nav du
 * haut (`.top-nav`, quasi opaque) et le pied de page (`.bottom-bar`) sont en position statique
 * PAR-DESSUS ce fond `position: fixed`, et recouvrent donc une bande en haut et en bas quel que
 * soit le calcul de caméra. Avant ce correctif, `computeFitCamera` ajustait la carte au viewport
 * ENTIER (`canvas.height`) : la carte "tenait" bien dans le canvas, mais ses bords haut/bas
 * tombaient sous la nav/le footer et semblaient "coupés" (demande utilisateur) — la carte ENTIÈRE
 * n'était jamais réellement visible. Ici, l'échelle et le centre vertical de la caméra sont
 * calculés pour que la carte tienne et soit centrée dans la bande NON recouverte
 * (`safeTop..safeBottom`), pas dans le canvas entier. */
function computeFitCamera(mapSize: number, canvas: HTMLCanvasElement): Camera {
  const navHeight = document.querySelector('.top-nav')?.getBoundingClientRect().height ?? 0;
  const footerHeight = document.querySelector('.bottom-bar')?.getBoundingClientRect().height ?? 0;
  const safeHeight = Math.max(1, canvas.height - navHeight - footerHeight);
  const fitScale = Math.min(canvas.width / mapSize, safeHeight / mapSize);

  // Centre de la bande visible (entre nav et footer), en px écran depuis le haut du canvas.
  const safeCenterScreenY = navHeight + safeHeight / 2;
  // `toScreenY` (render.ts) : screenY = (worldY - camera.y) * scale + canvas.height/2. On veut que
  // le centre monde (mapSize/2) tombe à `safeCenterScreenY` plutôt qu'au centre du canvas entier —
  // on décale donc `camera.y` de l'écart correspondant, converti en unités monde.
  const screenCenterOffset = safeCenterScreenY - canvas.height / 2;
  const cameraY = mapSize / 2 - screenCenterOffset / fitScale;

  return { x: mapSize / 2, y: cameraY, scale: fitScale };
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
  /** `buildVersion` du tout premier `welcome` reçu par ce composant (voir protocol.ts) — persiste
   * à travers les reconnexions déclenchées par un changement de `roomId` (bascule de mode sur
   * l'accueil, voir l'effet ci-dessous), qui ne changent jamais `buildVersion` (propre au PROCESS
   * serveur, pas au salon) : seul un vrai redémarrage du process (déploiement) le fait varier. Un
   * `ref` (pas un `let` local à l'effet, qui serait recréé à chaque reconnexion) est nécessaire
   * pour comparer à travers ces reconnexions normales. */
  const knownBuildVersionRef = useRef<string | undefined>(undefined);

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

    const SPECTATOR_MAX_FPS = 30;
    const SPECTATOR_MIN_INTERVAL_MS = 1000 / SPECTATOR_MAX_FPS;

    function frame(now: number): void {
      const playerMinInterval = computeMinFrameIntervalMs(loadVsyncEnabled(), loadFpsSliderIndex());
      const minInterval = Math.max(SPECTATOR_MIN_INTERVAL_MS, playerMinInterval);
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
          // Détection de nouveau déploiement (voir le commentaire de `knownBuildVersionRef`) —
          // rechargement immédiat : à l'accueil, aucune partie en cours à préserver.
          if (message.buildVersion !== undefined) {
            if (knownBuildVersionRef.current === undefined) {
              knownBuildVersionRef.current = message.buildVersion;
            } else if (knownBuildVersionRef.current !== message.buildVersion) {
              window.location.reload();
              return;
            }
          }
          tickRateHz = message.tickRateHz;
          stateRef.current.mapSize = message.mapSize;
          stateRef.current.renderEngine.reset();
          const canvas = canvasRef.current;
          if (canvas) stateRef.current.camera = computeFitCamera(message.mapSize, canvas);
          setIsSwitching(false);
        } else if (message.type === 'state') {
          stateRef.current.renderEngine.pushSnapshot(message.entities, message.tick, tickRateHz);
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
