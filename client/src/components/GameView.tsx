import type { EntitySnapshot, ServerMessage } from '@angulio/shared';
import { clamp } from '@angulio/shared';
import { useEffect, useRef } from 'react';
import {
  createFpsTracker,
  detectGpuInfo,
  detectMemoryInfo,
  detectNetworkInfo,
  detectSystemInfo,
  formatDebugText,
  type GpuInfo,
  type NetworkInfo,
} from '../debugOverlay.js';
import { attachInput } from '../input.js';
import { GameConnection } from '../net.js';
import {
  BASE_SCALE,
  computeCamera,
  interpolateEntities,
  renderFrame,
  type Camera,
} from '../render.js';
import { loadFpsCap } from '../settings.js';
import { ownAggregate, speedBetween } from '../stats.js';

const INPUT_SEND_INTERVAL_MS = 50; // aligné sur le tick serveur par défaut (20 Hz)
/** Intervalle attendu entre deux messages `state` (20 Hz par défaut, voir Room/index.ts côté
 * serveur) — sert de base à l'interpolation d'affichage (render.ts, `interpolateEntities`) et
 * à la dérivation de la vitesse (stats.ts, `speedBetween`). */
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;
/** Facteur purement cosmétique (affichage uniquement) pour donner un ordre de grandeur
 * "physique" repérable (m/s) plutôt que l'unité de simulation abstraite. */
const MAP_UNITS_TO_METERS = 0.01;

interface GameViewProps {
  roomIdOrInviteCode: string;
  inviteCodeToShow: string | undefined;
  nickname: string;
  authToken: string | undefined;
  onExit: (message: string) => void;
}

/** Canvas + boucle de jeu — délibérément impératif et hors du cycle de rendu React (§ optimisation
 * demandée) : la boucle tourne à ~60 im/s et les stats HUD (masse/vitesse) sont mises à jour
 * ~20 fois/s directement en DOM via des refs plutôt qu'en state React, pour éviter des dizaines
 * de re-renders par seconde sur du texte. Toute la logique métier (WebSocket, rendu, entrées,
 * stats) reste dans les modules existants (net.ts/render.ts/input.ts/stats.ts), inchangés — ce
 * composant ne fait que les orchestrer. */
export default function GameView({
  roomIdOrInviteCode,
  inviteCodeToShow,
  nickname,
  authToken,
  onExit,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const statNicknameRef = useRef<HTMLSpanElement>(null);
  const statMassRef = useRef<HTMLSpanElement>(null);
  const statSpeedRef = useRef<HTMLSpanElement>(null);
  const hudRef = useRef<HTMLDivElement>(null);
  const debugOverlayRef = useRef<HTMLPreElement>(null);

  // Lue via une ref plutôt qu'incluse dans les dépendances de l'effet principal ci-dessous :
  // `onExit` vient d'un `useCallback` stable côté App, mais cet effet ne doit de toute façon
  // tourner qu'une fois par montage (une partie = un montage, voir App.tsx). Mise à jour dans
  // son propre effet (pas pendant le rendu) — mutation de ref hors render.
  const onExitRef = useRef(onExit);
  useEffect(() => {
    onExitRef.current = onExit;
  });

  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    function resizeCanvas(): void {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    window.addEventListener('resize', resizeCanvas);
    resizeCanvas();

    let previousSnapshot: EntitySnapshot[] | undefined;
    let latestSnapshot: EntitySnapshot[] = [];
    let latestSnapshotAt = performance.now();
    let selfPlayerId: string | undefined;
    let mapSize = 4000;
    let justDied = false;
    let lastPingMs: number | undefined;
    /** Pseudo par id de joueur, appris via les messages `player` (envoyés une fois par joueur,
     * pas répétés sur chaque entité à chaque tick — bande passante). */
    const nicknames = new Map<string, string>();
    /** Caméra du dernier `frame()` dessiné (boucle RAF) — relue par l'envoi d'input (intervalle
     * séparé, ~20 Hz) pour convertir la position écran du curseur en position monde, voir
     * `input.getTarget`. */
    let latestCamera: Camera = { x: mapSize / 2, y: mapSize / 2, scale: BASE_SCALE };

    const input = attachInput(canvas);

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    // `&token=` (Lot 3.3) uniquement si connecté — une partie en invité omet le paramètre.
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
    );

    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        selfPlayerId = message.playerId;
        mapSize = message.mapSize;
      } else if (message.type === 'player') {
        nicknames.set(message.playerId, message.nickname);
      } else if (message.type === 'state') {
        previousSnapshot = latestSnapshot;
        latestSnapshot = message.entities;
        latestSnapshotAt = performance.now();
      } else if (message.type === 'died') {
        justDied = true;
        setTimeout(() => {
          justDied = false;
        }, 1500);
      } else if (message.type === 'pong') {
        lastPingMs = performance.now() - message.t;
      }
    });

    // Le serveur ferme immédiatement (code 4004) si le salon/code demandé n'existe pas. Pas de
    // reconnexion automatique pour le MVP : une coupure en cours de partie ramène à l'accueil
    // plutôt que de laisser un dernier freeze-frame silencieux. `closedByUs` distingue une
    // fermeture décidée par le serveur/réseau d'un simple démontage React (cleanup ci-dessous,
    // notamment le double montage volontaire de React.StrictMode en développement).
    let closedByUs = false;
    connection.onClose(() => {
      if (closedByUs) return;
      const wasMidGame = selfPlayerId !== undefined;
      onExitRef.current(
        wasMidGame
          ? 'Connexion au serveur perdue — reconnectez-vous.'
          : 'Salon introuvable ou code invalide.',
      );
    });

    connection.send({ type: 'join', nickname });
    const inputInterval = setInterval(() => {
      if (!selfPlayerId) return;
      const { target, intensity } = input.getTarget(latestCamera);
      connection.send({ type: 'input', target, intensity, split: input.consumeSplit() });
    }, INPUT_SEND_INTERVAL_MS);
    // Latence réelle (aller-retour), affichée dans l'écran de debug F3.
    const pingInterval = setInterval(() => {
      connection.send({ type: 'ping', t: performance.now() });
    }, PING_INTERVAL_MS);

    const fpsTracker = createFpsTracker();
    const systemInfo = detectSystemInfo();
    let gpuInfo: GpuInfo | undefined;
    let networkInfo: NetworkInfo | undefined;
    let debugVisible = false;

    // Plafond FPS (§Paramètres) : lu une fois à l'entrée en partie (comme le pseudo), pas
    // réactif à un changement pendant que la partie est déjà en cours. Purement côté rendu —
    // n'affecte ni la fréquence d'envoi des inputs (`inputInterval` ci-dessus) ni le tick
    // serveur, qui restent indépendants.
    const minFrameIntervalMs = 1000 / loadFpsCap();
    let lastFrameAt = 0;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'F3') return;
      event.preventDefault();
      debugVisible = !debugVisible;
      debugOverlayRef.current?.classList.toggle('visible', debugVisible);
      if (debugVisible) {
        // Détection paresseuse (WebGL/Network Information API) : inutile en continu si l'écran
        // de debug n'est jamais ouvert.
        gpuInfo ??= detectGpuInfo();
        networkInfo = detectNetworkInfo();
      }
    }
    window.addEventListener('keydown', onKeyDown);

    let rafId = 0;
    function frame(): void {
      const now = performance.now();
      if (now - lastFrameAt < minFrameIntervalMs) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      lastFrameAt = now;

      const t = clamp((now - latestSnapshotAt) / SERVER_STATE_INTERVAL_MS, 0, 1);
      const entities = interpolateEntities(previousSnapshot, latestSnapshot, t);

      const camera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
      latestCamera = camera;
      renderFrame(ctx!, canvas!, entities, camera, nicknames);

      if (hudRef.current) {
        const status = justDied ? 'Vous êtes mort — respawn en cours…' : '';
        hudRef.current.textContent = [
          status,
          inviteCodeToShow && `Code d'invitation : ${inviteCodeToShow}`,
        ]
          .filter(Boolean)
          .join(' — ');
      }

      // Stats mises à jour directement en DOM (refs), hors state React : un re-render par frame
      // (~20 Hz) serait un coût inutile pour du simple texte (§ optimisation demandée).
      if (statNicknameRef.current) statNicknameRef.current.textContent = nickname || '—';
      const own = ownAggregate(latestSnapshot, selfPlayerId);
      if (statMassRef.current) {
        statMassRef.current.textContent = own ? Math.round(own.mass).toString() : '—';
      }
      const previousOwn = ownAggregate(previousSnapshot ?? [], selfPlayerId);
      const speed =
        own && previousOwn
          ? speedBetween(previousOwn, own, SERVER_STATE_INTERVAL_MS / 1000)
          : undefined;
      if (statSpeedRef.current) {
        statSpeedRef.current.textContent =
          speed !== undefined ? `${(speed * MAP_UNITS_TO_METERS).toFixed(1)} m/s` : '—';
      }

      const fps = fpsTracker.tick(now);
      if (debugVisible && debugOverlayRef.current) {
        debugOverlayRef.current.textContent = formatDebugText({
          fps,
          pingMs: lastPingMs,
          tick: undefined,
          visibleEntities: latestSnapshot.length,
          roomId: roomIdOrInviteCode,
          cameraScale: camera.scale,
          gpu: gpuInfo,
          network: networkInfo,
          memory: detectMemoryInfo(),
          system: systemInfo,
        });
      }

      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    return () => {
      closedByUs = true;
      window.removeEventListener('resize', resizeCanvas);
      window.removeEventListener('keydown', onKeyDown);
      input.detach();
      clearInterval(inputInterval);
      clearInterval(pingInterval);
      cancelAnimationFrame(rafId);
      connection.close();
    };
    // Un seul montage par partie (App.tsx ne rend GameView que pendant une partie) : les props
    // sont figées pour la durée de vie de ce composant, volontairement hors dépendances.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="game" />
      <div className="game-overlay">
        <div className="stats-panel">
          <div className="stat-row">
            <span className="stat-label">Pseudo</span>
            <span className="stat-value" ref={statNicknameRef}>
              —
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Guilde</span>
            {/* Espace réservé statique : aucun système de guilde n'existe encore (§0/§4.7
                cahier_des_charges_ui_ux.md). */}
            <span className="stat-value">—</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Masse</span>
            <span className="stat-value" ref={statMassRef}>
              —
            </span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Vitesse</span>
            <span className="stat-value" ref={statSpeedRef}>
              —
            </span>
          </div>
        </div>
        <div className="hud-status" ref={hudRef} />
      </div>
      <pre className="debug-overlay" ref={debugOverlayRef} />
    </>
  );
}
