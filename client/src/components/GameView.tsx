import type {
  DeathCustomCard,
  EntitySnapshot,
  LeaderboardEntry,
  ServerMessage,
} from '@angulio/shared';
import {
  clamp,
  deathBannerById,
  DEFAULT_DEATH_BANNER_ID,
  DEFAULT_DEATH_MESSAGE,
  WS_CLOSE_NICKNAME_TAKEN,
  WS_CLOSE_ROOM_EXPIRED,
  WS_CLOSE_ROOM_FULL,
} from '@angulio/shared';
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  calculateGridSector,
  createFpsTracker,
  createTickRateTracker,
  detectBatteryInfo,
  detectGpuInfo,
  detectMemoryInfo,
  detectNetworkInfo,
  detectSystemInfo,
  formatDebugText,
  type BatteryInfo,
  type GpuInfo,
  type NetworkInfo,
} from '../debugOverlay.js';
import { attachInput } from '../input.js';
import { GameConnection } from '../net.js';
import {
  BASE_SCALE,
  computeCamera,
  cullEntitiesForViewport,
  interpolateEntities,
  renderFrame,
  type Camera,
} from '../render.js';
import { RenderEngine } from '../renderEngine.js';
import {
  loadFpsSliderIndex,
  loadVsyncEnabled,
  minFrameIntervalMs as computeMinFrameIntervalMs,
} from '../settings.js';
import { ownAggregate, speedBetween } from '../stats.js';
import Minimap from './Minimap.js';

const INPUT_SEND_INTERVAL_MS = 50; // aligné sur le tick serveur par défaut (20 Hz)
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;
const MAP_UNITS_TO_METERS = 0.01;
/** Écran de mort personnalisé (cahier des charges fourni) : "aucun recalcul canvas/WebGL lourd
 * pendant l'écran de mort" — 10 FPS suffit à garder le fond du jeu visible (pas figé) sans
 * consommer de ressources pour une scène que le joueur ne pilote plus. */
const DEAD_FRAME_INTERVAL_MS = 100;

interface DeathState {
  isDead: boolean;
  finalScore: number;
  survivalTimeSec: number;
  xpEarned: number;
  killerNickname?: string;
  customCard: DeathCustomCard;
}

const DEFAULT_DEATH_STATE: DeathState = {
  isDead: false,
  finalScore: 0,
  survivalTimeSec: 0,
  xpEarned: 0,
  customCard: { message: DEFAULT_DEATH_MESSAGE, bannerId: DEFAULT_DEATH_BANNER_ID },
};

/** "04m 12s" (cahier des charges fourni, maquette de l'écran de mort) plutôt qu'un nombre brut
 * de secondes — plus lisible pour une partie qui peut durer plusieurs minutes. */
function formatSurvivalTime(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.floor(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}m ${String(seconds).padStart(2, '0')}s`;
}

interface GameViewProps {
  nickname: string;
  roomIdOrInviteCode: string;
  inviteCodeToShow?: string;
  authToken?: string;
  onExit: (message?: string) => void;
  /** Transfert forcé par un admin (§3.3 cahier_des_charges_admin.md) — GameView ne rouvre pas la
   * connexion lui-même (son effet principal ne dépend que du montage, voir plus bas) : l'appelant
   * (App.tsx) doit remonter ce composant avec un nouveau `roomIdOrInviteCode` (ex. via `key`). */
  onForceRoomChange?: (roomId: string) => void;
}

export default function GameView({
  nickname,
  roomIdOrInviteCode,
  inviteCodeToShow,
  authToken,
  onExit,
  onForceRoomChange,
}: GameViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const debugOverlayRef = useRef<HTMLPreElement | null>(null);
  const comboBannerRef = useRef<HTMLDivElement | null>(null);
  const announcementBannerRef = useRef<HTMLDivElement | null>(null);
  const hudRef = useRef<HTMLDivElement | null>(null);

  const statNicknameRef = useRef<HTMLSpanElement | null>(null);
  const statMassRef = useRef<HTMLSpanElement | null>(null);
  const statSpeedRef = useRef<HTMLSpanElement | null>(null);

  const onExitRef = useRef(onExit);
  useLayoutEffect(() => {
    onExitRef.current = onExit;
  });

  const onForceRoomChangeRef = useRef(onForceRoomChange);
  useLayoutEffect(() => {
    onForceRoomChangeRef.current = onForceRoomChange;
  });

  const connectionRef = useRef<GameConnection | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [deathState, setDeathState] = useState<DeathState>(DEFAULT_DEATH_STATE);
  const [playerPos, setPlayerPos] = useState<{ x: number; y: number } | undefined>(undefined);
  const [playerMass, setPlayerMass] = useState<number | undefined>(undefined);
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
    let serverTickRateHz: number | undefined;
    let latestSnapshot: EntitySnapshot[] = [];
    let previousSnapshot: EntitySnapshot[] | undefined;
    let latestSnapshotAt = performance.now();
    const nicknames = new Map<string, string>();
    // Couleur de blob par joueur (refonte UI/UX, avatar procédural) — apprise via les mêmes
    // messages `player` que les pseudos (voir PlayerInfoMessage.color côté serveur), utilisée par
    // `colorFor` (render.ts) à la place de l'ancien `DEFAULT_BLOB_COLOR` unique.
    const colors = new Map<string, string>();
    let latestCamera: Camera = { x: 7500, y: 7500, scale: BASE_SCALE };
    // `undefined` tant qu'aucun `pong` n'est encore arrivé (écran F3, RTT) — distinct de `0`, qui
    // afficherait une latence mesurée alors qu'aucune mesure n'a encore eu lieu.
    let lastPingMs: number | undefined;
    let lastComboLevel: number | undefined;
    let comboHideTimer: ReturnType<typeof setTimeout> | undefined;
    let announcementHideTimer: ReturnType<typeof setTimeout> | undefined;
    let justDied = false;
    let isDeadNow = false;

    function respawn(): void {
      isDeadNow = false;
      setDeathState(DEFAULT_DEATH_STATE);
      connection.send({ type: 'join', nickname });
    }

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

    /** Annonce admin (§4.6 cahier_des_charges_admin.md, "Diffusion de Messages & Overlays") —
     * même principe imperatif que `showComboBanner` (pas de re-render React pour un texte affiché
     * en surimpression pendant la boucle de jeu). */
    function showAnnouncement(text: string, color: string, durationMs: number): void {
      const banner = announcementBannerRef.current;
      if (!banner) return;
      banner.textContent = text;
      banner.style.color = color;
      banner.classList.add('visible');
      if (announcementHideTimer) clearTimeout(announcementHideTimer);
      announcementHideTimer = setTimeout(() => {
        banner.classList.remove('visible');
      }, durationMs);
    }

    const input = attachInput(canvas);

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
    );
    connectionRef.current = connection;

    const renderEngine = new RenderEngine();

    let lastMinimapUpdateAt = 0;

    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        selfPlayerId = message.playerId;
        mapSize = message.mapSize;
        serverTickRateHz = message.tickRateHz;
        renderEngine.reset();
        setMapSizeState(message.mapSize);
        isDeadNow = false;
        setDeathState(DEFAULT_DEATH_STATE);
        if (statNicknameRef.current) statNicknameRef.current.textContent = nickname;
      } else if (message.type === 'player') {
        nicknames.set(message.playerId, message.nickname);
        if (message.color) colors.set(message.playerId, message.color);
      } else if (message.type === 'state') {
        previousSnapshot = latestSnapshot;
        latestSnapshot = message.entities;
        latestSnapshotAt = performance.now();
        renderEngine.pushSnapshot(message.entities, serverTickRateHz);
        serverTpsCurrent = tickRateTracker.record(latestSnapshotAt);
        if (message.leaderboard) {
          setLeaderboard(message.leaderboard);
        }
        const comboLevel = message.self?.combo?.level;
        if (comboLevel !== undefined && comboLevel !== lastComboLevel) {
          showComboBanner(comboLevel);
        }
        lastComboLevel = comboLevel;
      } else if (message.type === 'died') {
        justDied = true;
        isDeadNow = true;
        setDeathState({
          isDead: true,
          finalScore: message.finalScore,
          survivalTimeSec: message.survivalTimeSec,
          xpEarned: message.xpEarned,
          killerNickname: message.killerNickname,
          customCard: message.customCard,
        });
        setTimeout(() => {
          justDied = false;
        }, 1500);
      } else if (message.type === 'pong') {
        lastPingMs = performance.now() - message.t;
        // Rapporté au serveur pour affichage dans l'interface admin ("Salons & Écrans") — le
        // client est seul à mesurer sa propre latence (voir ClientLatencyMessage).
        connection.send({ type: 'latency', ms: Math.round(lastPingMs) });
      } else if (message.type === 'announcement') {
        showAnnouncement(message.text, message.color, message.durationMs);
      } else if (message.type === 'forceRoomChange') {
        onForceRoomChangeRef.current?.(message.roomId);
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
    const tickRateTracker = createTickRateTracker();
    let serverTpsCurrent = 0;
    const systemInfo = detectSystemInfo();
    let gpuInfo: GpuInfo | undefined;
    let networkInfo: NetworkInfo | undefined;
    let batteryInfo: BatteryInfo | undefined;
    let debugVisible = false;

    const minFrameIntervalMs = computeMinFrameIntervalMs(loadVsyncEnabled(), loadFpsSliderIndex());
    // `undefined` = pas de plafond logiciel (Vsync ou palier "Illimité") : impossible de connaître
    // le taux de rafraîchissement réel de l'écran depuis le JS, donc rien à afficher comme cible
    // chiffrée dans ce cas (voir debugOverlay.ts, RenderStats.targetHz).
    const targetHz =
      minFrameIntervalMs > 0 ? Math.round(1000 / minFrameIntervalMs) : undefined;
    let lastFrameAt = 0;

    function onKeyDown(event: KeyboardEvent): void {
      // Respawn rapide (cahier des charges fourni, écran de mort) : Espace ne fait rien tant
      // qu'on est vivant (évite un split accidentel si le joueur a mappé une autre touche par
      // habitude — de toute façon Espace ne déclenche aucune action en jeu aujourd'hui).
      if (event.key === ' ' && isDeadNow) {
        event.preventDefault();
        respawn();
        return;
      }
      if (event.key !== 'F3') return;
      event.preventDefault();
      debugVisible = !debugVisible;
      debugOverlayRef.current?.classList.toggle('visible', debugVisible);
      if (debugVisible) {
        gpuInfo ??= detectGpuInfo();
        networkInfo = detectNetworkInfo();
        if (!batteryInfo) void detectBatteryInfo().then((info) => (batteryInfo = info));
      }
    }
    window.addEventListener('keydown', onKeyDown);

    let rafId = 0;

    function frame(): void {
      const now = performance.now();
      // Écran de mort personnalisé (cahier des charges fourni)
      const targetIntervalMs = isDeadNow
        ? Math.max(minFrameIntervalMs, DEAD_FRAME_INTERVAL_MS)
        : minFrameIntervalMs;
      if (now - lastFrameAt < targetIntervalMs) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const frameDt = Math.min(50, lastFrameAt > 0 ? now - lastFrameAt : 16);
      lastFrameAt = now;

      const logicStart = performance.now();
      const entities = renderEngine.getInterpolatedEntities(
        frameDt,
        latestCamera,
        canvas!.width,
        canvas!.height,
        selfPlayerId,
        false,
      );

      const targetCamera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });
      const ownForScale = ownAggregate(entities, selfPlayerId);
      const targetScale = ownForScale
        ? clamp(BASE_SCALE / Math.sqrt(ownForScale.mass / 50), 0.1, 1.76)
        : BASE_SCALE;

      // Suivi de caméra direct et réactif (+ brute)
      const cameraLerp = 0.35;
      latestCamera = {
        x: latestCamera.x + (targetCamera.x - latestCamera.x) * cameraLerp,
        y: latestCamera.y + (targetCamera.y - latestCamera.y) * cameraLerp,
        scale: latestCamera.scale + (targetScale - latestCamera.scale) * cameraLerp,
      };
      const camera = latestCamera;
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
        setPlayerMass(own?.mass);
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
      for (const entity of latestSnapshot) {
        if (entity.k === 'c' || entity.p !== undefined) playersCount++;
        else foodCount++;
      }

      const fps = fpsTracker.tick(now);
      if (debugVisible && debugOverlayRef.current) {
        debugOverlayRef.current.textContent = formatDebugText({
          fps,
          pingMs: lastPingMs,
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
            totalEntities: latestSnapshot.length,
            viewportWidth: canvas!.width,
            viewportHeight: canvas!.height,
            cameraScale: camera.scale,
            dpiRatio: window.devicePixelRatio,
            targetHz,
          },
          simulation: {
            logicStepMs,
            playersCount,
            foodCount,
            localX: currentPos.x,
            localY: currentPos.y,
            gridSector: calculateGridSector(currentPos.x, currentPos.y, mapSize),
          },
          networkSync: {
            rttMs: lastPingMs,
            serverTpsCurrent,
            serverTpsTarget: serverTickRateHz,
            netInKbps: connection.netInKbps,
            netInPktSec: connection.netInPktSec,
            netOutKbps: connection.netOutKbps,
            interpBufferMs: SERVER_STATE_INTERVAL_MS,
            interpSnapshots: previousSnapshot ? 2 : 1,
          },
          hardware: {
            cpuCores: systemInfo.hardwareConcurrency,
            batteryPercent: batteryInfo?.percent,
            batteryCharging: batteryInfo?.charging,
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
      <div className="announcement-banner" ref={announcementBannerRef} aria-hidden="true" />
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

      {/* Écran de mort personnalisé (cahier des charges fourni) */}
      {deathState.isDead && (
        <div className="death-overlay">
          <div className="death-modal">
            <h2>Fin de partie</h2>
            {deathState.killerNickname && (
              <p className="death-killer">
                Éliminé par : <strong>{deathState.killerNickname}</strong>
              </p>
            )}

            <div
              className="death-banner"
              style={{
                background: `linear-gradient(135deg, ${deathBannerById(deathState.customCard.bannerId).gradient[0]}, ${deathBannerById(deathState.customCard.bannerId).gradient[1]})`,
              }}
            >
              <span className="death-banner-icon">
                {deathBannerById(deathState.customCard.bannerId).icon}
              </span>
              <p className="death-banner-message">"{deathState.customCard.message}"</p>
            </div>

            <div className="death-stats-grid">
              <div className="death-stat-cell">
                <span className="death-stat-label">Masse finale</span>
                <span className="death-stat-value">{deathState.finalScore}</span>
              </div>
              <div className="death-stat-cell">
                <span className="death-stat-label">Temps de survie</span>
                <span className="death-stat-value">
                  {formatSurvivalTime(deathState.survivalTimeSec)}
                </span>
              </div>
              <div className="death-stat-cell">
                <span className="death-stat-label">XP gagnée</span>
                <span className="death-stat-value">+{Math.round(deathState.xpEarned)}</span>
              </div>
            </div>

            <div className="death-actions">
              <button
                className="btn-primary-action"
                type="button"
                onClick={() => {
                  setDeathState(DEFAULT_DEATH_STATE);
                  connectionRef.current?.send({ type: 'join', nickname });
                }}
              >
                Rejouer (Espace)
              </button>
              <button className="btn-secondary-action" type="button" onClick={() => onExit()}>
                Menu Principal
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Minimap (quadrillage 3x3 : 1-3 horizontal, A-C vertical) */}
      <Minimap position={playerPos} playerMass={playerMass} mapSize={mapSizeState} />

      <pre className="debug-overlay" ref={debugOverlayRef} />
    </>
  );
}
