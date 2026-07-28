import type { EntitySnapshot, ServerMessage } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { useEffect, useRef } from 'react';
import { GameConnection } from '../net.js';
import { interpolateEntities, renderFrame, type Camera } from '../render.js';

/** Même cadence que le tick serveur par défaut (voir Room) — sert de base à l'interpolation
 * d'affichage, comme dans GameView.tsx. */
const SERVER_STATE_INTERVAL_MS = 50;

/** Aucun pseudo à afficher au-dessus des morceaux pour un fond décoratif (évite le bruit visuel
 * de pseudos de joueurs qu'on n'a pas soi-même choisi de regarder) — constante plutôt qu'un
 * nouveau `Map()` alloué à chaque frame (~60/s). */
const NO_NICKNAMES = new Map<string, string>();

interface SpectatorBackgroundProps {
  /** Id du salon permanent à observer en lecture seule — `undefined` tant que la liste des
   * salons n'a pas encore été chargée (voir App.tsx), auquel cas rien n'est monté. */
  roomId: string | undefined;
  /** Transition "on lance une partie" (demande utilisateur, voir App.tsx `enterGame`/Home.tsx) :
   * zoome le fond "en avant" (grossissement centré) pendant que le reste de l'UI (`.home-ui`)
   * zoome "en arrière" et s'estompe. */
  zooming: boolean;
}

/** Fond animé de l'accueil (refonte UI/UX, demande utilisateur : "vision zoomée du serveur en
 * transparence") — vraie connexion WebSocket en lecture seule (`?spectate=1`, voir
 * net/server.ts) au salon permanent, jamais un `join` : ce socket n'est jamais ajouté à `world`
 * côté serveur, donc jamais compté comme joueur. Caméra fixe (pas de morceau à soi pour centrer
 * la vue, contrairement à GameView.tsx). Pas de reconnexion automatique (cohérent avec la
 * limitation MVP déjà documentée de net.ts) : une coupure arrête simplement l'animation, sans
 * message d'erreur — c'est un fond décoratif, pas une fonctionnalité critique. Respecte
 * `prefers-reduced-motion` : rien n'est monté du tout si l'utilisateur l'a demandé. */
export default function SpectatorBackground({ roomId, zooming }: SpectatorBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!roomId) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    let mapSize = 15000;
    let camera: Camera = { x: 7500, y: 7500, scale: 0.1 };

    function updateCameraScale(): void {
      if (!canvas) return;
      const fitScale = Math.min(canvas.width / mapSize, canvas.height / mapSize);
      camera = {
        x: mapSize / 2,
        y: mapSize / 2,
        scale: fitScale,
      };
    }

    function resizeCanvas(): void {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
      updateCameraScale();
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let previousSnapshot: EntitySnapshot[] | undefined;
    let latestSnapshot: EntitySnapshot[] = [];
    let latestSnapshotAt = performance.now();

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomId)}&spectate=1`,
    );
    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        mapSize = message.mapSize;
        updateCameraScale();
      } else if (message.type === 'state') {
        previousSnapshot = latestSnapshot;
        latestSnapshot = message.entities;
        latestSnapshotAt = performance.now();
      }
    });

    let rafId = 0;
    function frame(): void {
      const now = performance.now();
      const t = clamp((now - latestSnapshotAt) / SERVER_STATE_INTERVAL_MS, 0, 1);
      const entities = interpolateEntities(previousSnapshot, latestSnapshot, t);
      renderFrame(ctx!, canvas!, entities, camera, NO_NICKNAMES);
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      cancelAnimationFrame(rafId);
      connection.close();
    };
  }, [roomId]);

  return (
    <canvas
      ref={canvasRef}
      className={`spectator-background${zooming ? ' zooming' : ''}`}
      aria-hidden="true"
    />
  );
}
