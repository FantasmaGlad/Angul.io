import type { EntitySnapshot, LeaderboardEntry, ServerMessage } from '@angulio/shared';
import {
  clamp,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_EXPIRED,
  WS_CLOSE_ROOM_FULL,
} from '@angulio/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  calculateGridSector,
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
import Minimap from './Minimap.js';

const INPUT_SEND_INTERVAL_MS = 50; // aligné sur le tick serveur par défaut (20 Hz)
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;
const MAP_UNITS_TO_METERS = 0.01;

interface GameViewProps {
  nickname: string;
  roomIdOrInviteCode: string;
  inviteCodeToShow?: string;
  authToken?: string;
  onExit: (message?: string) => void;
}

export default function GameView({
  nickname,
  roomIdOrInviteCode,
  inviteCodeToShow,
  authToken,
  onExit,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugOverlayRef = useRef<HTMLPreElement | null>(null);
  const comboBannerRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  const statNicknameRef = useRef<HTMLSpanElement | null>(null);
  const statMassRef = useRef<HTMLSpanElement | null>(null);
  const statSpeedRef = useRef<HTMLSpanElement | null>(null);

  const onExitRef = useRef(onExit);
  useLayoutEffect(() => {
    onExitRef.current = onExit;
  });

  const connectionRef = useRef<GameConnection | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [deathState, setDeathState] = useState<{ isDead: boolean; finalScore: number }>({
    isDead: false,
    finalScore: 0,
  });
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [mapSizeState, setMapSizeState] = useState<number>(15000);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resizeCanvas(): void {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    let selfPlayerId: string | undefined;
    let mapSize = 15000;
    let latestSnapshot: EntitySnapshot[] = [];
    let previousSnapshot: EntitySnapshot[] | undefined;
    let latestSnapshotAt = performance.now();
    const nicknames = new Map<string, string>();
    // Couleur de blob par joueur (refonte UI/UX, avatar procédural) — apprise via les mêmes
    // messages `player` que les pseudos (voir PlayerInfoMessage.color côté serveur), utilisée par
    // `colorFor` (render.ts) à la place de l'ancien `DEFAULT_BLOB_COLOR` unique.
    const colors = new Map<string, string>();
    let latestCamera: Camera = { x: 7500, y: 7500, scale: BASE_SCALE };
    let lastPingMs = 0;
    let lastComboLevel: number | undefined;
    let comboHideTimer: ReturnType<typeof setTimeout> | undefined;
    let justDied = false;
    let maxMassThisLife = 50;

    function showComboBanner(level: number): void {
      const banner = comboBannerRef.current;
      if (!banner) return;
      banner.textContent = `Combo x${level} !`;
      banner.classList.add('visible');
      if (comboHideTimer) clearTimeout(comboHideTimer);
      comboHideTimer = setTimeout(() => {
        banner.classList.remove('visible');
      }, 2000);
    }

    const input = attachInput(canvas);

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
    );
    connectionRef.current = connection;

    let lastMinimapUpdateAt = 0;

    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        selfPlayerId = message.playerId;
        mapSize = message.mapSize;
        setMapSizeState(message.mapSize);
        maxMassThisLife = 50;
        setDeathState({ isDead: false, finalScore: 0 });
        if (statNicknameRef.current) statNicknameRef.current.textContent = nickname;
      } else if (message.type === 'player') {
        nicknames.set(message.playerId, message.nickname);
        if (message.color) colors.set(message.playerId, message.color);
      } else if (message.type === 'state') {
        previousSnapshot = latestSnapshot;
        latestSnapshot = message.entities;
        latestSnapshotAt = performance.now();
        if (message.leaderboard) {
          setLeaderboard(message.leaderboard);
        }
        const own = ownAggregate(latestSnapshot, selfPlayerId);
        if (own) {
          maxMassThisLife = Math.max(maxMassThisLife, own.mass);
        }
        const comboLevel = message.self?.combo?.level;
        if (comboLevel !== undefined && comboLevel !== lastComboLevel) {
          showComboBanner(comboLevel);
        }
        lastComboLevel = comboLevel;
      } else if (message.type === 'died') {
        justDied = true;
        setDeathState({ isDead: true, finalScore: Math.round(maxMassThisLife) });
        setTimeout(() => {
          justDied = false;
        }, 1500);
      } else if (message.type === 'pong') {
        lastPingMs = performance.now() - message.t;
      }
    });

    let closedByUs = false;
    connection.onClose((event) => {
      if (closedByUs) return;
      if (event.code === WS_CLOSE_NICKNAME_TAKEN) {
        onExitRef.current('Ce pseudo est déjà utilisé sur ce salon — choisis-en un autre.');
        return;
      }
      if (event.code === WS_CLOSE_ROOM_FULL) {
        onExitRef.current('Ce salon est complet.');
        return;
      }
      if (event.code === WS_CLOSE_ROOM_EXPIRED) {
        onExitRef.current('Ce salon a été fermé (durée écoulée).');
        return;
      }
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

    const pingInterval = setInterval(() => {
      connection.send({ type: 'ping', t: performance.now() });
    }, PING_INTERVAL_MS);

    const fpsTracker = createFpsTracker();
    const systemInfo = detectSystemInfo();
    let gpuInfo: GpuInfo | undefined;
    let networkInfo: NetworkInfo | undefined;
    let debugVisible = false;

    const minFrameIntervalMs = 1000 / loadFpsCap();
    let lastFrameAt = 0;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== 'F3') return;
      event.preventDefault();
      debugVisible = !debugVisible;
      debugOverlayRef.current?.classList.toggle('visible', debugVisible);
      if (debugVisible) {
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

      const logicStart = performance.now();
      const t = clamp((now - latestSnapshotAt) / SERVER_STATE_INTERVAL_MS, 0, 1);
      const entities = interpolateEntities(previousSnapshot, latestSnapshot, t);

      const camera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
      latestCamera = camera;
      const logicStepMs = performance.now() - logicStart;

      const drawStart = performance.now();
      const renderInfo = renderFrame(ctx!, canvas!, entities, camera, nicknames, colors);
      const drawTimeMs = performance.now() - drawStart;

      if (hudRef.current) {
        const status = justDied ? 'Vous êtes mort — respawn en cours…' : '';
        hudRef.current.textContent = [
          status,
          inviteCodeToShow && `Code d'invitation : ${inviteCodeToShow}`,
        ]
          .filter(Boolean)
          .join(' — ');
      }

      const own = ownAggregate(latestSnapshot, selfPlayerId);
      const currentPos = own ? { x: own.x, y: own.y } : { x: camera.x, y: camera.y };
      if (now - lastMinimapUpdateAt > 100) {
        lastMinimapUpdateAt = now;
        setPlayerPos(currentPos);
      }

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

      let playersCount = 0;
      let foodCount = 0;
      const ejectedCount = 0;
      for (const entity of latestSnapshot) {
        if (entity.k === 'c' || entity.p !== undefined) playersCount++;
        else foodCount++;
      }

      const fps = fpsTracker.tick(now);
      if (debugVisible && debugOverlayRef.current) {
        debugOverlayRef.current.textContent = formatDebugText({
          fps,
          pingMs: lastPingMs,
          tick: undefined,
          visibleEntities: entities.length,
          totalEntities: latestSnapshot.length,
          roomId: roomIdOrInviteCode,
          cameraScale: camera.scale,
          gpu: gpuInfo,
          network: networkInfo,
          memory: detectMemoryInfo(),
          system: systemInfo,
          render: {
            drawTimeMs,
            drawCalls: renderInfo.drawCalls,
            batches: renderInfo.batches,
            visibleEntities: entities.length,
            totalEntities: Math.max(latestSnapshot.length, 15000),
            viewportWidth: canvas!.width,
            viewportHeight: canvas!.height,
            cameraScale: camera.scale,
            dpiRatio: window.devicePixelRatio,
          },
          simulation: {
            logicStepMs,
            spatialChecks: entities.length,
            playersCount,
            foodCount,
            ejectedCount,
            localX: currentPos.x,
            localY: currentPos.y,
            gridSector: calculateGridSector(currentPos.x, currentPos.y, mapSize),
          },
          networkSync: {
            rttMs: lastPingMs,
            serverTpsCurrent: 60,
            serverTpsTarget: 60,
            netInKbps: connection.netInKbps,
            netInPktSec: connection.netInPktSec,
            netOutKbps: connection.netOutKbps,
            interpBufferMs: SERVER_STATE_INTERVAL_MS,
            interpSnapshots: previousSnapshot ? 2 : 1,
            reconciliationsPerSec: 0,
          },
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
      if (comboHideTimer) clearTimeout(comboHideTimer);
      cancelAnimationFrame(rafId);
      connection.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <canvas ref={canvasRef} id="game" />
      <div className="combo-banner" ref={comboBannerRef} aria-hidden="true" />
      <div className="game-overlay">
        <div className="stats-panel">
          <div className="stat-row">
            <span className="stat-label">Pseudo</span>
            <span className="stat-value" ref={statNicknameRef}>
              —
            </span>
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
        <button type="button" className="hud-quit-button" onClick={() => onExit()}>
          Quitter
        </button>
        <div className="hud-status" ref={hudRef} />
      </div>

      {/* Top 10 Live Leaderboard */}
      <div className="leaderboard-overlay">
        <div className="leaderboard-header">CLASSEMENT (TOP 10)</div>
        <div className="leaderboard-list">
          {leaderboard.length === 0 ? (
            <div className="leaderboard-row">— En attente —</div>
          ) : (
            leaderboard.map((entry) => (
              <div
                key={`${entry.rank}-${entry.nickname}`}
                className={`leaderboard-row ${entry.isSelf ? 'is-self' : ''}`}
              >
                <span className="leaderboard-rank">#{entry.rank}</span>
                <span className="leaderboard-nickname">{entry.nickname}</span>
                <span className="leaderboard-score">{entry.score}</span>
              </div>
            ))
          )}
        </div>
      </div>

      {/* Modal Éliminé / Respawn */}
      {deathState.isDead && (
        <div className="death-overlay">
          <div className="death-modal">
            <h2>Éliminé</h2>
            <p>Votre cellule a été absorbée.</p>
            <div className="death-stats">
              <span className="death-stat-label">Score Final (Masse Max)</span>
              <span className="death-stat-value">{deathState.finalScore}</span>
            </div>
            <div className="death-actions">
              <button
                className="btn-primary-action"
                type="button"
                onClick={() => {
                  setDeathState({ isDead: false, finalScore: 0 });
                  connectionRef.current?.send({ type: 'join', nickname });
                }}
              >
                Rejouer (Respawn)
              </button>
              <button className="btn-secondary-action" type="button" onClick={() => onExit()}>
                Menu Principal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minimap (quadrillage 3x3 : 1-3 horizontal, A-C vertical) */}
      <Minimap position={playerPos} mapSize={mapSizeState} />

      <pre className="debug-overlay" ref={debugOverlayRef} />
    </>
  );
}
