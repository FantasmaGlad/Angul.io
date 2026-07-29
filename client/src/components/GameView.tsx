import type {
  DeathCustomCard,
  EntitySnapshot,
  LeaderboardEntry,
  MovementConfig,
  ServerMessage,
} from '@angulio/shared';
import {
  DEFAULT_DEATH_BANNER_ID,
  DEFAULT_DEATH_MESSAGE,
  isCustomImageBanner,
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
import { audioManager } from '../audio.js';
import { attachInput } from '../input.js';
import { GameConnection } from '../net.js';
import { LocalPrediction } from '../prediction.js';
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

/** Repli avant que `welcome` (et donc `serverTickRateHz`) ne soit connu — l'envoi des inputs se
 * cale ensuite dynamiquement sur la cadence réelle du salon (voir `scheduleInput` plus bas) au
 * lieu d'un intervalle fixe indépendant du tick serveur, qui battait auparavant avec lui. */
const DEFAULT_INPUT_INTERVAL_MS = 1000 / 30;
const SERVER_STATE_INTERVAL_MS = 50;
const PING_INTERVAL_MS = 1000;
/** Réactivité de l'EMA de latence (voir `smoothedLatencyMs`) — assez lent pour amortir un pic bas
 * isolé (un seul échantillon/s), assez réactif pour suivre une vraie dégradation en quelques
 * secondes. */
const LATENCY_EMA_ALPHA = 0.25;
/** Marge de sécurité (ms) ajoutée à l'estimation lissée — biaise délibérément vers une latence
 * surestimée plutôt que sous-estimée (voir le commentaire sur `smoothedLatencyMs`). */
const LATENCY_SAFETY_MARGIN_MS = 15;
const MAP_UNITS_TO_METERS = 0.01;

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
  const [showQuitConfirm, setShowQuitConfirm] = useState(false);
  const [dashInfo, setDashInfo] = useState<{
    charges: number;
    maxCharges: number;
    canDash: boolean;
    rechargeProgress: number;
  } | undefined>(undefined);

  useEffect(() => {
    const isHardcore = roomIdOrInviteCode.toLowerCase().includes('hardcore');
    const musicTrack = isHardcore
      ? '/assets/Sons/Musiques/Hardcore.m4a'
      : '/assets/Sons/Musiques/vanilla.m4a';
    audioManager.playMusic(musicTrack, true);
    return () => {
      audioManager.stopMusic();
    };
  }, [roomIdOrInviteCode]);

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
    /** Modèle de mouvement du mode actif, reçu dans `welcome` — nécessaire à la prédiction locale
     * (voir prediction.ts) ; `undefined` tant que `welcome` n'est pas encore arrivé, auquel cas la
     * prédiction reste simplement inactive (le blob suit le pipeline serveur habituel). */
    let movementConfig: MovementConfig | undefined;
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
    /** Latence aller simple lissée (EMA) + marge de sécurité — utilisée UNIQUEMENT pour le rejeu
     * de réconciliation (prediction.ts), jamais pour l'affichage (`lastPingMs` brut reste
     * inchangé, voir écran F3/rapport admin). Un seul échantillon de ping brut (mesuré 1x/s,
     * PING_INTERVAL_MS) peut ponctuellement sous-estimer la vraie latence par simple gigue réseau
     * — et sous-estimer fait rejouer TROP PEU de l'historique local : la position reconstruite au
     * rejeu se retrouve alors légèrement en retard sur la position réellement prédite pendant un
     * déplacement, et la réconciliation la tire en arrière à chaque `state` avant que le
     * déplacement suivant la ramène en avant — un aller-retour visible ("avant/arrière") en
     * mouvement, invisible à l'arrêt (résidu nul). Sur-estimer, à l'inverse, ne fait rejouer qu'un
     * peu plus que nécessaire — un simple surplus d'avance déjà toléré par construction (voir
     * l'en-tête de prediction.ts). D'où le lissage (amorti les pics bas isolés) et la marge fixe
     * (biaise délibérément vers l'estimation la moins risquée des deux). */
    let smoothedLatencyMs: number | undefined;
    let lastComboLevel: number | undefined;
    let comboHideTimer: ReturnType<typeof setTimeout> | undefined;
    let announcementHideTimer: ReturnType<typeof setTimeout> | undefined;
    let justDied = false;
    let isDeadNow = false;
    /** `true` entre une coupure réseau transitoire détectée par `GameConnection` et le `welcome`
     * qui confirme la reconnexion (voir net.ts) — purement pour informer le joueur (statut HUD)
     * que la partie n'est pas figée, juste en train de se rattacher. */
    let isReconnecting = false;

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

    let lastMouseX = window.innerWidth / 2;
    let lastMouseY = window.innerHeight / 2;
    const trackMouse = (e: MouseEvent) => {
      lastMouseX = e.clientX;
      lastMouseY = e.clientY;
    };
    window.addEventListener('mousemove', trackMouse);

    const input = attachInput(canvas, () => {
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const centerX = rect.left + rect.width / 2;
      const centerY = rect.top + rect.height / 2;
      const dx = lastMouseX - centerX;
      const dy = lastMouseY - centerY;
      const dist = Math.hypot(dx, dy);
      const dirX = dist > 0 ? dx / dist : 0;
      const dirY = dist > 0 ? dy / dist : 0;

      canvas.style.transformOrigin = `${50 + dirX * 18}% ${50 + dirY * 18}%`;
      canvas.style.transition = 'none';
      canvas.style.transform = 'scale(0.96)';
      void canvas.offsetWidth;
      canvas.style.transition = 'transform 0.22s cubic-bezier(0.1, 0.9, 0.2, 1)';
      canvas.style.transform = 'scale(1)';
    });

    const wsProtocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const tokenParam = authToken ? `&token=${encodeURIComponent(authToken)}` : '';
    const connection = new GameConnection(
      `${wsProtocol}://${location.host}/?roomId=${encodeURIComponent(roomIdOrInviteCode)}${tokenParam}`,
    );
    connectionRef.current = connection;

    const renderEngine = new RenderEngine();
    const prediction = new LocalPrediction();

    let lastMinimapUpdateAt = 0;

    connection.onMessage((message: ServerMessage) => {
      if (message.type === 'welcome') {
        selfPlayerId = message.playerId;
        mapSize = message.mapSize;
        serverTickRateHz = message.tickRateHz;
        movementConfig = message.movement;
        isReconnecting = false;
        renderEngine.reset();
        prediction.reset();
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
        if (selfPlayerId && movementConfig) {
          // Latence aller simple estimée, lissée + marge de sécurité (voir `smoothedLatencyMs`) —
          // détermine depuis quel instant rejouer l'historique d'inputs local lors de la
          // réconciliation (voir prediction.ts).
          const estimatedLatencyMs = smoothedLatencyMs;
          // Vélocité autoritaire par morceau (voir protocol.ts `self.pieces`) — permet à
          // `reconcile()` de ré-ancrer `predicted.velocity` avant de rejouer l'historique, au lieu
          // de repartir de la vélocité déjà avancée en direct (voir prediction.ts).
          const authoritativeVelocities = message.self?.pieces
            ? new Map(message.self.pieces.map((p) => [p.id, { x: p.vx, y: p.vy }]))
            : undefined;
          prediction.reconcile(
            message.entities,
            selfPlayerId,
            movementConfig,
            estimatedLatencyMs,
            serverTickRateHz,
            authoritativeVelocities,
          );
        }
        renderEngine.pushSnapshot(message.entities, message.tick, serverTickRateHz);
        serverTpsCurrent = tickRateTracker.record(latestSnapshotAt);
        if (message.leaderboard) {
          setLeaderboard(message.leaderboard);
        }
        if (message.self?.dash !== undefined) {
          setDashInfo(message.self.dash);
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
        const oneWayMs = lastPingMs / 2 + LATENCY_SAFETY_MARGIN_MS;
        smoothedLatencyMs =
          smoothedLatencyMs === undefined
            ? oneWayMs
            : smoothedLatencyMs + (oneWayMs - smoothedLatencyMs) * LATENCY_EMA_ALPHA;
        // Rapporté au serveur pour affichage dans l'interface admin ("Salons & Écrans") — le
        // client est seul à mesurer sa propre latence (voir ClientLatencyMessage).
        connection.send({ type: 'latency', ms: Math.round(lastPingMs) });
      } else if (message.type === 'announcement') {
        showAnnouncement(message.text, message.color, message.durationMs);
      } else if (message.type === 'forceRoomChange') {
        onForceRoomChangeRef.current?.(message.roomId);
      }
    });

    connection.onReconnecting(() => {
      isReconnecting = true;
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
    // Cadence dynamique (au lieu d'un intervalle fixe indépendant du tick serveur) : se recale
    // sur `serverTickRateHz` dès que `welcome` est connu, pour ne pas battre avec le vrai tick du
    // salon.
    let inputTimer: ReturnType<typeof setTimeout> | undefined;
    function scheduleInput(): void {
      const intervalMs = serverTickRateHz ? 1000 / serverTickRateHz : DEFAULT_INPUT_INTERVAL_MS;
      inputTimer = setTimeout(() => {
        if (selfPlayerId) {
          // Référence de conversion écran->monde : la position prédite locale, pas la caméra
          // (lissée/en retard) — voir `LocalPrediction.getOwnPosition`.
          const ownPosition = prediction.getOwnPosition() ?? latestCamera;
          const { target, intensity } = input.getTarget({ ...latestCamera, ...ownPosition });
          connection.send({
            type: 'input',
            target,
            intensity,
            split: input.consumeSplit(),
            dash: input.consumeDash(),
          });
        }
        scheduleInput();
      }, intervalMs);
    }
    scheduleInput();

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
    const musicUrl = roomIdOrInviteCode.toLowerCase().includes('hardcore')
      ? '/assets/Sons/Musiques/Hardcore.m4a'
      : '/assets/Sons/Musiques/vanilla.m4a';
    audioManager.playMusic(musicUrl);

    let lastFrameAt = 0;

    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === ' ' || event.code === 'Space') {
        if (isDeadNow) {
          event.preventDefault();
          respawn();
        }
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        setShowQuitConfirm((prev) => !prev);
        return;
      }
      if (event.key !== 'F3') return;
      event.preventDefault();
      debugVisible = !debugVisible;
      if (debugOverlayRef.current) {
        debugOverlayRef.current.style.display = debugVisible ? 'block' : 'none';
      }
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
      // Le pipeline de rendu (culling viewport, nourriture groupée en Path2D, sprites de skin
      // pré-détourés en cache) est assez léger pour tourner à la cadence normale même pendant
      // l'écran de mort — l'ancien plafond dédié à 10 FPS (`DEAD_FRAME_INTERVAL_MS`) créait une
      // saccade perceptible à chaque mort sans bénéfice mesurable, voir son ancien commentaire
      // ("aucun recalcul canvas/WebGL lourd" — vrai aujourd'hui même sans ce plafond).
      if (now - lastFrameAt < minFrameIntervalMs) {
        rafId = requestAnimationFrame(frame);
        return;
      }

      const frameDt = Math.min(50, lastFrameAt > 0 ? now - lastFrameAt : 16);
      lastFrameAt = now;

      const logicStart = performance.now();

      // Prédiction locale : avance le(s) morceau(x) du joueur avec la même formule que le
      // serveur, à partir de l'input LIVE de cette frame — réagit donc au curseur sans attendre
      // l'aller-retour réseau. Inactif tant que `welcome` n'est pas encore arrivé (`movementConfig`
      // inconnu) ou hors partie (`selfPlayerId` inconnu) : le blob suit alors simplement le
      // pipeline serveur habituel.
      if (movementConfig && selfPlayerId) {
        // Référence de conversion écran->monde : la position prédite locale, pas la caméra
        // (lissée/en retard) — voir `LocalPrediction.getOwnPosition`.
        const ownPosition = prediction.getOwnPosition() ?? latestCamera;
        const { target, intensity } = input.getTarget({ ...latestCamera, ...ownPosition });
        prediction.step(frameDt / 1000, target, intensity, movementConfig);
      }

      let entities = renderEngine.getInterpolatedEntities(
        frameDt,
        latestCamera,
        canvas!.width,
        canvas!.height,
        selfPlayerId,
        false,
      );
      if (selfPlayerId) entities = prediction.applyTo(entities, selfPlayerId);

      // `targetCamera.scale` (voir computeCamera, render.ts) est la SEULE formule de zoom par
      // masse — pas de duplication locale avec des bornes MIN_SCALE/MAX_SCALE recopiées à la
      // main : une telle copie était restée figée à l'ancienne valeur de MAX_SCALE lors du réglage
      // du dézoom de base (demande utilisateur, task #7) alors que `computeCamera` avait bien été
      // mis à jour — la caméra effectivement affichée ne suivait donc PAS le nouveau réglage tant
      // que cette duplication existait.
      const targetCamera = computeCamera(entities, selfPlayerId, { x: mapSize / 2, y: mapSize / 2 });

      // Suivi de caméra lissé et indépendant du framerate : pour le joueur local (selfPlayerId),
      // ancrer la position (x, y) directement sur la position prédite (targetCamera) annule 100%
      // du lag/tressautement relatif de la caméra par rapport à son propre blob. Seul le zoom (scale)
      // conserve un lissage très doux. En spectateur, la position reste lissée doucement.
      const cameraScaleLerp = 1 - Math.exp(-3.5 * (frameDt / 1000));
      if (selfPlayerId) {
        latestCamera = {
          x: targetCamera.x,
          y: targetCamera.y,
          scale: latestCamera.scale + (targetCamera.scale - latestCamera.scale) * cameraScaleLerp,
        };
      } else {
        const cameraPosLerp = 1 - Math.exp(-15 * (frameDt / 1000));
        latestCamera = {
          x: latestCamera.x + (targetCamera.x - latestCamera.x) * cameraPosLerp,
          y: latestCamera.y + (targetCamera.y - latestCamera.y) * cameraPosLerp,
          scale: latestCamera.scale + (targetCamera.scale - latestCamera.scale) * cameraScaleLerp,
        };
      }
      // L'effet de "dash" au split est un pur transform CSS sur le canvas (voir attachInput
      // plus haut et styles.css `#game.split-punch`) — jamais mélangé à cette caméra LOGIQUE, qui
      // reste le seul repère utilisé par le rendu ET par la conversion écran->monde (input.ts).
      const camera = latestCamera;
      const logicStepMs = performance.now() - logicStart;

      const drawStart = performance.now();
      const renderInfo = renderFrame(ctx!, canvas!, entities, camera, nicknames, colors, selfPlayerId);
      const drawTimeMs = performance.now() - drawStart;

      if (hudRef.current) {
        const status = isReconnecting
          ? 'Connexion interrompue — reconnexion en cours…'
          : justDied
            ? 'Vous êtes mort — respawn en cours…'
            : '';
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
      const stateIntervalSec = serverTickRateHz ? 1 / serverTickRateHz : SERVER_STATE_INTERVAL_MS / 1000;
      const speed =
        own && previousOwn ? speedBetween(previousOwn, own, stateIntervalSec) : undefined;
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
            interpBufferMs: Math.round(renderEngine.currentInterpDelayMs),
            interpSnapshots: previousSnapshot ? 2 : 1,
            missedTicks: renderEngine.missedTickCount,
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
      audioManager.stopMusic();
      if (inputTimer) clearTimeout(inputTimer);
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
      {dashInfo && (
        <div className="dash-hud-wrapper">
          <div className="dash-hud-badge">
            <span className="dash-hud-label">
              DASH <span className="dash-hud-key">F</span>
            </span>
            <div className="dash-segments-track">
              {Array.from({ length: dashInfo.maxCharges }).map((_, i) => {
                const isFull = i < dashInfo.charges;
                const isCurrentRecharging = i === dashInfo.charges;
                const fillWidth = isFull
                  ? 100
                  : isCurrentRecharging
                    ? Math.round(dashInfo.rechargeProgress * 100)
                    : 0;
                return (
                  <div key={i} className={`dash-segment-box ${isFull ? 'full' : ''}`}>
                    {!isFull && <div className="dash-segment-fill" style={{ width: `${fillWidth}%` }} />}
                  </div>
                );
              })}
            </div>
          </div>
          {!dashInfo.canDash && dashInfo.charges === 0 && (
            <div className="dash-disabled-hint">Recharge en cours… (10s/charge)</div>
          )}
        </div>
      )}
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
        <button type="button" className="hud-quit-button" onClick={() => setShowQuitConfirm(true)}>
          Quitter
        </button>
        <div className="hud-status" ref={hudRef} />
      </div>

      {showQuitConfirm && (
        <div className="death-overlay" style={{ zIndex: 200 }}>
          <div className="death-modal">
            <h2>Quitter la partie ?</h2>
            <p className="death-killer">Voulez-vous vraiment abandonner la partie en cours ?</p>
            <div className="death-actions" style={{ flexDirection: 'row', justifyContent: 'center' }}>
              <button className="btn-secondary-action" type="button" onClick={() => setShowQuitConfirm(false)}>
                Annuler
              </button>
              <button className="btn-primary-action" type="button" onClick={() => onExit()}>
                Quitter
              </button>
            </div>
          </div>
        </div>
      )}

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
                background: isCustomImageBanner(deathState.customCard.bannerId)
                  ? `url("${deathState.customCard.bannerId}") center/cover no-repeat`
                  : 'linear-gradient(135deg, rgba(30, 32, 34, 0.95), rgba(20, 22, 24, 0.95))',
                position: 'relative',
                overflow: 'hidden',
                border: '1px solid var(--border-strong)',
              }}
            >
              {isCustomImageBanner(deathState.customCard.bannerId) && (
                <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)' }} />
              )}
              <div style={{ position: 'relative', zIndex: 1 }}>
                <p className="death-banner-message">"{deathState.customCard.message || DEFAULT_DEATH_MESSAGE}"</p>
              </div>
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
