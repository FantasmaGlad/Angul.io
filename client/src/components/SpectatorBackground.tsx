import type { EntitySnapshot, ServerMessage } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { useEffect, useRef, useState } from 'react';
import { GameConnection } from '../net.js';
import { cullEntitiesForViewport, interpolateEntities, renderFrame, type Camera } from '../render.js';

/** Même cadence que le tick serveur par défaut (voir Room) — sert de base à l'interpolation
 * d'affichage, comme dans GameView.tsx. */
const SERVER_STATE_INTERVAL_MS = 50;

/** Aucun pseudo à afficher au-dessus des morceaux pour un fond décoratif (évite le bruit visuel
 * de pseudos de joueurs qu'on n'a pas soi-même choisi de regarder) — constante plutôt qu'un
 * nouveau `Map()` alloué à chaque frame (~60/s). */
const NO_NICKNAMES = new Map<string, string>();

/** Un fond décoratif n'a pas besoin de suivre le taux de rafraîchissement réel de l'écran (jusqu'à
 * 240Hz+) : ça ne change rien à ce que l'œil perçoit pour une simple ambiance en arrière-plan,
 * mais ça multiplie le travail CPU pour rien — surtout une fois multiplié par le nombre de
 * visiteurs de l'accueil ayant chacun ce rendu qui tourne en continu (source de lag observée dès
 * l'écran d'accueil, voir aussi la gestion d'intérêt spectateur dans broadcast.ts côté serveur). */
const BACKGROUND_FRAME_INTERVAL_MS = 1000 / 30;

/** Délai avant d'ouvrir la nouvelle connexion spectateur après un changement de `roomId` — si
 * l'utilisateur re-clique sur un autre mode avant l'écoulement de ce délai, l'effet précédent est
 * nettoyé (voir cleanup ci-dessous) et aucune connexion n'est jamais ouverte pour l'étape
 * intermédiaire : évite d'ouvrir/fermer un socket par clic lors d'un survol rapide des modes
 * (charge serveur inutile, voir broadcast.ts côté serveur pour le coût par connexion). */
const ROOM_SWITCH_DEBOUNCE_MS = 150;

interface SpectatorState {
  mapSize: number;
  camera: Camera;
  previousSnapshot: EntitySnapshot[] | undefined;
  latestSnapshot: EntitySnapshot[];
  latestSnapshotAt: number;
}

function computeFitCamera(mapSize: number, canvas: HTMLCanvasElement): Camera {
  const fitScale = Math.min(canvas.width / mapSize, canvas.height / mapSize);
  return { x: mapSize / 2, y: mapSize / 2, scale: fitScale };
}

interface SpectatorBackgroundProps {
  /** Id du salon permanent à observer en lecture seule — `undefined` tant que la liste des
   * salons n'a pas encore été chargée (voir App.tsx), auquel cas la connexion n'est pas encore
   * ouverte (la boucle de rendu, elle, tourne déjà — voir plus bas). Change quand le joueur
   * sélectionne un autre mode sur l'accueil (voir Home.tsx) : la bascule doit être instantanée,
   * pas un flash sur canvas vide le temps de la reconnexion. */
  roomId: string | undefined;
  /** Transition "on lance une partie" (demande utilisateur, voir App.tsx `enterGame`/Home.tsx) :
   * zoome le fond "en avant" (grossissement centré) pendant que le reste de l'UI (`.home-ui`)
   * zoome "en arrière" et s'estompe. */
  zooming: boolean;
}

/** Fond animé de l'accueil (refonte UI/UX, demande utilisateur : "vision zoomée du serveur en
 * transparence") — vraie connexion WebSocket en lecture seule (`?spectate=1`, voir
 * net/server.ts) au salon actuellement affiché, jamais un `join` : ce socket n'est jamais ajouté
 * à `world` côté serveur, donc jamais compté comme joueur. Caméra fixe (pas de morceau à soi pour
 * centrer la vue, contrairement à GameView.tsx). Pas de reconnexion automatique (cohérent avec la
 * limitation MVP déjà documentée de net.ts) : une coupure arrête simplement l'animation, sans
 * message d'erreur — c'est un fond décoratif, pas une fonctionnalité critique. Respecte
 * `prefers-reduced-motion` : rien n'est monté du tout si l'utilisateur l'a demandé.
 *
 * Deux effets séparés plutôt qu'un seul keyé sur `roomId` (comme avant) : la boucle de rendu vit
 * dans un effet monté une seule fois et lit un état partagé (`stateRef`) au lieu d'être recréée à
 * chaque changement de salon — un changement de `roomId` ne remonte donc que la connexion réseau,
 * jamais le canvas. Sans ça, chaque bascule de salon repartait d'un rendu vide le temps que la
 * nouvelle connexion livre son premier snapshot (flash au lieu d'une bascule instantanée). */
export default function SpectatorBackground({ roomId, zooming }: SpectatorBackgroundProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // `latestSnapshotAt: 0` (pas `performance.now()`, impur pendant le rendu) : sans effet en
  // pratique — tant qu'aucun snapshot n'est arrivé, `latestSnapshot` est `[]` et
  // `interpolateEntities` renvoie `latest` tel quel indépendamment de `t`.
  const stateRef = useRef<SpectatorState>({
    mapSize: 15000,
    camera: { x: 7500, y: 7500, scale: 0.1 },
    previousSnapshot: undefined,
    latestSnapshot: [],
    latestSnapshotAt: 0,
  });

  // Boucle de rendu — montée une seule fois, indépendante de `roomId` : continue de peindre le
  // dernier état connu (`stateRef`) pendant qu'un changement de salon reconnecte en arrière-plan.
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
      if (now - lastFrameAt >= BACKGROUND_FRAME_INTERVAL_MS) {
        lastFrameAt = now;
        const { previousSnapshot, latestSnapshot, latestSnapshotAt, camera } = stateRef.current;
        const t = clamp((performance.now() - latestSnapshotAt) / SERVER_STATE_INTERVAL_MS, 0, 1);
        // Culle AVANT d'interpoler, comme GameView.tsx (voir cullEntitiesForViewport, render.ts) :
        // le salon observé peut contenir bien plus d'entités que ce qu'un fond dézoomé affiche
        // réellement à l'écran — sans ce filtre, ce coût d'interpolation tourne à 30 fps pour
        // chaque visiteur de l'accueil et grossit avec la population du salon, indépendamment de
        // ce que l'œil peut voir (source de lag observée dès l'écran d'accueil sur un salon
        // peuplé).
        const culledLatest = cullEntitiesForViewport(
          latestSnapshot,
          camera,
          canvas!.width,
          canvas!.height,
          undefined,
        );
        const culledPrevious = previousSnapshot
          ? cullEntitiesForViewport(previousSnapshot, camera, canvas!.width, canvas!.height, undefined)
          : undefined;
        const entities = interpolateEntities(culledPrevious, culledLatest, t);
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

  // Feedback visuel de bascule (demande utilisateur : le switch de salon paraissait peu réactif)
  // — activé immédiatement au clic, indépendamment de la latence de reconnexion ci-dessous, et
  // désactivé dès réception du `welcome` du nouveau salon (voir plus bas).
  const [isSwitching, setIsSwitching] = useState(false);

  // Connexion spectateur — une par salon observé, recréée à chaque changement de `roomId` (voir
  // Home.tsx : suit désormais le mode sélectionné plutôt qu'un salon fixe). Ne touche jamais au
  // canvas directement, seulement à `stateRef` (lu par la boucle de rendu ci-dessus) : la nouvelle
  // connexion remplace les données affichées uniquement une fois son premier `state` reçu, jamais
  // avant — pas de trou visible pendant la reconnexion.
  //
  // L'ouverture de la connexion elle-même est différée de `ROOM_SWITCH_DEBOUNCE_MS` : si `roomId`
  // change à nouveau avant l'écoulement du délai, le cleanup ci-dessous annule le timeout avant
  // qu'aucun socket n'ait été ouvert — un survol rapide des modes n'ouvre/ferme donc plus un
  // socket par étape intermédiaire, seulement pour le salon sur lequel l'utilisateur s'arrête.
  useEffect(() => {
    if (!roomId) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    setIsSwitching(true);

    let connection: GameConnection | undefined;
    const timeoutId = window.setTimeout(() => {
      const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
      connection = new GameConnection(
        `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomId)}&spectate=1`,
      );
      connection.onMessage((message: ServerMessage) => {
        if (message.type === 'welcome') {
          stateRef.current.mapSize = message.mapSize;
          const canvas = canvasRef.current;
          if (canvas) stateRef.current.camera = computeFitCamera(message.mapSize, canvas);
          setIsSwitching(false);
        } else if (message.type === 'state') {
          stateRef.current.previousSnapshot = stateRef.current.latestSnapshot;
          stateRef.current.latestSnapshot = message.entities;
          stateRef.current.latestSnapshotAt = performance.now();
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
