import { useEffect, useRef, useState } from 'react';
import type { AdminRoomAction, EntitySnapshot } from '@angulio/shared';
import { SKIN_IMAGE_MAP, SKINS } from '@angulio/shared';
import {
  computeFitCamera,
  renderFrame,
  RenderEngine,
  screenToWorld,
  worldToScreen,
  type Camera,
} from '@angulio/shared/render';
import {
  broadcastMessage,
  kickPlayer,
  listBotBehaviors,
  listModes,
  listRooms,
  runRoomAction,
  transferPlayer,
  type AdminRoomView,
} from '../adminApi.js';
import { connectAdminSocket, generateGodPlayerId, type AdminSocketHandle } from '../adminSocket.js';
import { pieceAtScreenPoint } from '../entityCanvas.js';
import ConnectionStatusDot, { type ConnectionStatus } from './ConnectionStatus.js';
import KickModal, { type KickModalTarget } from './KickModal.js';
import StudioMinimap, { drawMinimap } from './StudioMinimap.js';

interface RoomStudioProps {
  token: string;
  onAuthError: (error: unknown) => void;
  initialRoomId?: string;
  /** Retour au niveau liste (A11, plan-implementation-admin.md §5.1) — le Studio ne se ferme plus
   * jamais tout seul (ex-onglet séparé) : ce bouton est désormais sa seule sortie explicite. */
  onBack: () => void;
}

const KEY_PAN_SPEED = 800; // px monde/s, x3 avec Shift
const GOD_INPUT_INTERVAL_MS = 80;
/** Pinceau nourriture (§10.1) — ~10 pastilles/s tant que le clic est maintenu. */
const FOOD_PAINT_INTERVAL_MS = 100;
/** Déplacement physique (§9.1 : "Throttle client ~50 ms"). */
const DRAG_MOVE_INTERVAL_MS = 50;
/** Double-clic sur un blob = suivre + zoom rapproché (§8.3, remplace l'ex-mode POV séparé du
 * niveau liste, supprimé en P3, plan-implementation-admin.md §5.1). */
const FOLLOW_CLOSE_ZOOM_SCALE = 0.6;
/** Durée d'estompage (ms) des marqueurs d'événement (mort/disparition d'un morceau, §8.4). */
const EVENT_MARKER_FADE_MS = 2000;

interface ContextMenuState {
  screenX: number;
  screenY: number;
  playerId: string;
}

interface PlayerInspectInfo {
  playerId: string;
  nickname: string;
  skin?: string;
  mass: number;
  isBot: boolean;
  isFrozen: boolean;
  isGod: boolean;
  possessedByAdmin: boolean;
}

/** Niveau détail de l'onglet "Salons" (A11, plan-implementation-admin.md §5.1 — ex-"Espace
 * Créatif"/`CreativeView.tsx`, renommé lors de la fusion avec `RoomsView.tsx`) : Studio de
 * Contrôle & Commandement — vue Canvas haute fidélité 60 FPS avec interpolation de snapshots,
 * fond grille Onyx, manipulation physique des joueurs et mode Blob Dieu. */
export default function RoomStudio({ token, onAuthError, initialRoomId, onBack }: RoomStudioProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const canvasWrapRef = useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [modes, setModes] = useState<string[]>([]);
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [godActive, setGodActive] = useState(false);
  /** `'move'` remplace l'ex-`'teleport'` (§9.1, P4) : déplace réellement le barycentre
   * (`dragMove`) au lieu de détourner `godInput` pour ATTIRER vers un point (voir §1
   * plan-implementation-admin.md). `'virus'` = placement manuel au clic (§10.2). */
  const [spawnMode, setSpawnMode] = useState<'none' | 'food' | 'bot' | 'move' | 'virus'>('none');
  const [searchFilter, setSearchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'human' | 'bot'>('all');

  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastColor, setBroadcastColor] = useState('#ffffff');
  const [broadcastGlobal, setBroadcastGlobal] = useState(false);
  /** Durée réglable 1-60s (A15, plan-implementation-admin.md §3.6) — l'API accepte déjà jusqu'à
   * 60000ms (`adminRooms.ts`), seule l'UI figeait la valeur à 5s. */
  const [broadcastDurationSec, setBroadcastDurationSec] = useState(5);
  /** Historique de session des annonces envoyées — volatile (perdu à la fermeture de l'onglet),
   * pas de persistance tant que le journal d'audit (§14) n'existe pas. */
  const [broadcastHistory, setBroadcastHistory] = useState<
    Array<{ at: number; text: string; scope: string; durationSec: number; sent: number }>
  >([]);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [livePlayerList, setLivePlayerList] = useState<PlayerInspectInfo[]>([]);
  /** Modale motif partagée (A1, plan-implementation-admin.md §3.2, `KickModal.tsx`) — le Studio
   * appelait auparavant `kickPlayer` directement au clic, sans modale ni motif. */
  const [kickTarget, setKickTarget] = useState<KickModalTarget | null>(null);
  /** Transfert vers un autre salon (P3, plan-implementation-admin.md §5.1) — relocalisé ici depuis
   * l'ex-tableau de joueurs de `RoomsView.tsx`, supprimé lors de la fusion : le Studio est
   * désormais la seule porte d'entrée vers les actions sur un joueur. */
  const [selectedTargetRoomId, setSelectedTargetRoomId] = useState('');

  /** Panneau droit "Intervention" (§9.3 cahier_des_charges_admin.md) — rétractable, sous-onglets
   * séparant spawn / sanctions / salon / mode Dieu, bordure rouge/orange pour signaler "a un
   * effet sur la partie" (§3.2 : observation ≠ intervention, jamais mélangées visuellement). */
  const [interveneOpen, setInterveneOpen] = useState(true);
  const [interveneTab, setInterveneTab] = useState<'spawn' | 'sanctions' | 'salon' | 'god'>('sanctions');
  /** Formulaire "bot personnalisé" (§9.3/§17) — nom/masse/position, appliqué soit au clic sur la
   * carte (`spawnMode === 'bot'`), soit instantanément au centre visible via le bouton dédié. */
  const [customBotNickname, setCustomBotNickname] = useState('');
  const [customBotMass, setCustomBotMass] = useState('');
  const [customMassDraft, setCustomMassDraft] = useState('');
  /** Confirmation à 2 clics pour Kill (§17 : "aucune action destructive ... accessible en moins
   * de 2 clics confirmés depuis l'état 'rien de sélectionné'") — armé par un premier clic, expire
   * de lui-même après quelques secondes si le second clic ne vient jamais. */
  const [killArmed, setKillArmed] = useState(false);
  /** Indicateur de connexion (§10.3 cahier_des_charges_admin.md) — jusqu'ici, une déconnexion
   * n'était visible que via le toast d'erreur (`onClose`), qui disparaît après 3s ; ce point
   * reste affiché tant que la connexion n'est pas rétablie. */
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  /** Cadence RÉELLEMENT annoncée par `welcome` (§10.1/§17 : "la cadence affichée doit toujours
   * être la cadence réellement reçue, jamais une valeur théorique") — remplace le badge "Live
   * 20Hz" qui était codé en dur (juste par-coïncidence exact avant ce correctif, aurait
   * silencieusement menti dès que `TICK_RATE_HZ`/`ADMIN_TICK_DIVISOR` changerait côté serveur). */
  const [liveTickRateHz, setLiveTickRateHz] = useState<number | undefined>(undefined);
  /** Pseudos masquables (§8.4) — `renderFrame` (rendu partagé) le supporte déjà nativement
   * (`hideNicknames`), simple bascule ici. */
  const [hideNicknames, setHideNicknames] = useState(false);
  /** Canvas plein écran (Fullscreen API sur `.creative-canvas-wrap`, pas juste le `<canvas>` : le
   * bouton pseudos et la minimap doivent rester utilisables une fois en plein écran). Synchronisé
   * par l'événement `fullscreenchange` (pas seulement par le clic sur le bouton) car l'utilisateur
   * peut aussi quitter avec Échap. */
  const [isFullscreen, setIsFullscreen] = useState(false);
  /** Connue dès le `welcome` (A5 corrigé) — exposée en state React pour la prop `mapSize` de
   * `StudioMinimap` ; la boucle de rendu elle-même utilise sa propre variable locale (voir
   * l'effet plus bas), pas ce state (jamais lu à 60fps). */
  const [mapSize, setMapSize] = useState(0);

  // --- P4 : marionnette, masse continue, apparence, spawn virus/pinceau/vagues de bots ------

  /** Marionnette (§9.3) — id du joueur/bot actuellement possédé par CETTE session admin, ou
   * `undefined`. Un seul à la fois (imposé aussi côté serveur, voir connectionHandler.ts). */
  const [possessedPlayerId, setPossessedPlayerId] = useState<string | undefined>(undefined);
  const [appearanceNicknameDraft, setAppearanceNicknameDraft] = useState('');
  const [appearanceSkinDraft, setAppearanceSkinDraft] = useState('');
  /** Glissière logarithmique de masse (§9.2, 10 → 100 000) — valeur stockée en LOG10 (1 à 5), pas
   * en masse brute : un pas linéaire en log donne un ressenti de glissière uniforme sur toute la
   * plage, contrairement à un pas linéaire en masse (les 10 premiers % de la course couvriraient
   * alors presque toute la plage utile). Ne se resynchronise PAS depuis la masse réelle du joueur
   * sélectionné (qui varie en continu en jouant) — resterait sinon à se battre avec le doigt de
   * l'admin en plein glissement. */
  const [massSliderLog, setMassSliderLog] = useState(3); // 10^3 = 1000
  const [foodBrushRadius, setFoodBrushRadius] = useState(60);
  const [foodBrushMass, setFoodBrushMass] = useState(10);
  const [virusType, setVirusType] = useState<1 | 2 | 3>(1);
  const [botWaveCount, setBotWaveCount] = useState(10);
  const [botWaveMass, setBotWaveMass] = useState('');
  const [botWaveBehaviorProfile, setBotWaveBehaviorProfile] = useState('');
  const [botBehaviorProfiles, setBotBehaviorProfiles] = useState<string[]>([]);

  const socketRef = useRef<AdminSocketHandle | null>(null);
  const godPlayerIdRef = useRef<string | undefined>(undefined);
  /** `spawnMode`/`selectedPlayerId` lus par la boucle canva/WebSocket (voir l'effet plus bas) SANS
   * figurer dans ses dépendances — les lire directement depuis le state React y forçait une
   * RECONNEXION COMPLÈTE (WebSocket + moteur de rendu PixiJS détruit et recréé) à chaque clic sur
   * "Suivre"/changement d'outil de spawn. Inoffensif avec l'ancien rendu Canvas2D (recréer un
   * contexte 2D est quasi gratuit) mais un vrai bug de fiabilité avec PixiJS (recréer un contexte
   * WebGL est nettement plus coûteux ; un ancien contexte pas encore totalement détruit qui
   * chevauche un nouveau sur le même <canvas> a fait geler l'onglet en test). `followId` reste
   * distinct de `selectedPlayerId` : cliquer "Suivre" (re)lance le suivi caméra, mais panner la
   * caméra à la main (`onMouseDown`) l'interrompt SANS désélectionner le joueur dans l'inspecteur —
   * ce sont deux notions liées mais pas identiques. */
  const liveRef = useRef({
    spawnMode,
    selectedPlayerId,
    followId: selectedPlayerId as string | undefined,
    customBotNickname,
    customBotMass,
    hideNicknames,
    /** Zoom rapproché à imposer à la PROCHAINE frame suivie (double-clic, §8.3) — consommé une
     * fois par la boucle de rendu puis remis à `undefined`, plutôt qu'un état figé en continu
     * (qui empêcherait tout zoom manuel ultérieur tant qu'un joueur reste suivi). */
    pendingCloseZoom: false,
    /** Clic sur la minimap (§8.3) — la minimap est rendue par React (en dehors de la boucle
     * d'effet qui possède `camera`), ce champ sert de pont pour lui faire recentrer la caméra à
     * la prochaine frame, même mécanisme que `pendingCloseZoom`. */
    pendingJumpTo: undefined as { x: number; y: number } | undefined,
    possessedPlayerId: undefined as string | undefined,
    foodBrushRadius,
    foodBrushMass,
    virusType,
    /** Masse actuellement connue du joueur sélectionné (§9.2, raccourci Ctrl+molette) — lue par
     * `onWheel` (dans la boucle canvas/WebSocket) sans y ajouter `livePlayerList` en dépendance
     * d'effet, même raisonnement que le reste de ce ref. */
    selectedPlayerMass: undefined as number | undefined,
  });
  useEffect(() => {
    liveRef.current.spawnMode = spawnMode;
  }, [spawnMode]);
  useEffect(() => {
    liveRef.current.selectedPlayerId = selectedPlayerId;
    liveRef.current.followId = selectedPlayerId;
  }, [selectedPlayerId]);
  useEffect(() => {
    liveRef.current.customBotNickname = customBotNickname;
    liveRef.current.customBotMass = customBotMass;
  }, [customBotNickname, customBotMass]);
  useEffect(() => {
    liveRef.current.hideNicknames = hideNicknames;
  }, [hideNicknames]);
  useEffect(() => {
    liveRef.current.possessedPlayerId = possessedPlayerId;
  }, [possessedPlayerId]);
  useEffect(() => {
    liveRef.current.foodBrushRadius = foodBrushRadius;
    liveRef.current.foodBrushMass = foodBrushMass;
  }, [foodBrushRadius, foodBrushMass]);
  useEffect(() => {
    liveRef.current.virusType = virusType;
  }, [virusType]);
  useEffect(() => {
    liveRef.current.selectedPlayerMass = livePlayerList.find((p) => p.playerId === selectedPlayerId)?.mass;
  }, [livePlayerList, selectedPlayerId]);
  /** Le joueur possédé peut mourir/quitter le salon pendant la possession — nettoie l'état local
   * dès qu'il disparaît de `adminPlayers` (le serveur a déjà libéré la possession lui-même côté
   * `Room.removePlayer`, voir room.ts ; ceci ne fait que refléter l'état côté UI). */
  useEffect(() => {
    if (possessedPlayerId && !livePlayerList.some((p) => p.playerId === possessedPlayerId)) {
      setPossessedPlayerId(undefined);
    }
  }, [livePlayerList, possessedPlayerId]);

  const showToast = (text: string, type: 'info' | 'error' | 'success' = 'info') => {
    setToastMsg({ text, type });
    setTimeout(() => setToastMsg(null), 3000);
  };

  useEffect(() => {
    void (async () => {
      try {
        const list = await listRooms(token);
        setRooms(list);
        if (initialRoomId && list.some((r) => r.id === initialRoomId)) {
          setRoomId(initialRoomId);
        } else if (!roomId && list.length > 0) {
          setRoomId(list[0]!.id);
        }
      } catch (err) {
        const message = (err as Error).message;
        showToast(message, 'error');
        onAuthError(err);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialRoomId]);

  useEffect(() => {
    void listModes()
      .then(setModes)
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
  }, []);

  useEffect(() => {
    void listBotBehaviors(token)
      .then(setBotBehaviorProfiles)
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
  }, [token]);

  const runAction = (action: AdminRoomAction, desc?: string): void => {
    if (!socketRef.current) return;
    void socketRef.current.sendAction(action).then(async (result) => {
      if (result.ok) {
        if (desc) showToast(desc, 'success');
      } else {
        try {
          const restRes = await runRoomAction(token, roomId, action);
          if (restRes.ok) {
            if (desc) showToast(desc, 'success');
          } else {
            showToast("Action refusée", 'error');
          }
        } catch {
          showToast("Impossible d'exécuter l'action", 'error');
        }
      }
    });
  };

  /** Throttle ~100ms (§9.2 cahier_des_charges_admin.md) — la glissière de masse en continu et le
   * raccourci Ctrl+molette appellent tous deux `setMass` beaucoup plus vite que ce que le réseau
   * doit réellement porter ; dernière valeur "en attente" envoyée à l'échéance (trailing), jamais
   * perdue même si l'admin relâche juste après un appel throttlé. */
  const massThrottleRef = useRef<{ lastAt: number; timer: ReturnType<typeof setTimeout> | undefined }>({
    lastAt: 0,
    timer: undefined,
  });
  const throttledSetMass = (playerId: string, mass: number): void => {
    const state = massThrottleRef.current;
    const send = (): void => {
      state.lastAt = Date.now();
      runAction({ kind: 'setMass', playerId, mass });
    };
    const elapsed = Date.now() - state.lastAt;
    clearTimeout(state.timer);
    if (elapsed >= 100) {
      send();
    } else {
      state.timer = setTimeout(send, 100 - elapsed);
    }
  };

  // --- Boucle Canvas : connexion, rendu 60 FPS partagé avec le jeu, contrôles -------------
  // Canvas2D (contrairement à l'ancien PixiJS) : pas de contexte GPU persistant à gérer entre
  // changements de salon, `canvas.getContext('2d')` est repris directement ici à chaque
  // (re)connexion — un seul effet, plus besoin du montage séparé qu'exigeait PixiJS (voir
  // l'historique git : deux `Application` PixiJS se disputant le même contexte WebGL du même
  // `<canvas>` figeait l'onglet entier, un risque qui n'existe simplement plus avec Canvas2D).
  useEffect(() => {
    if (!roomId) return;
    const canvas = canvasRef.current;
    const canvasContext = canvas?.getContext('2d');
    if (!canvas || !canvasContext) return;
    // Liaison à un type non-nullable explicite : les fonctions imbriquées plus bas (`frame`,
    // gestionnaires d'événements) perdent le rétrécissement de `canvasContext` fait ci-dessus
    // (limitation TS classique pour les déclarations `function` imbriquées) — `canvas!.xxx` est
    // déjà le pattern établi de ce fichier pour `canvas`, `ctx` suit la même logique ici.
    const ctx: CanvasRenderingContext2D = canvasContext;

    const nicknames = new Map<string, string>();
    const colorsMap = new Map<string, string>();
    const renderEngine = new RenderEngine();

    // Caméra de repli le temps très bref entre la connexion et le premier `welcome` (qui porte
    // `mapSize`, voir A5 corrigé) — remplacée par `computeFitCamera` dès qu'il arrive.
    const camera: Camera = { x: 0, y: 0, scale: 0.1 };
    let mapSize = 0;
    const pressedKeys = new Set<string>();
    let isPanning = false;
    let lastPanScreen = { x: 0, y: 0 };
    let lastMouseScreen = { x: 0, y: 0 };
    let lastMouseWorld = { x: 0, y: 0 };
    let hoveredEntity: EntitySnapshot | undefined;
    /** Dernière position connue d'un morceau disparu (mort/split/fusion, §8.4) — croix qui
     * s'estompe ~2s, purement dérivé de la disparition d'entités entre deux frames, aucun
     * changement de protocole. */
    const eventMarkers = new Map<string, { x: number; y: number; at: number }>();
    /** Morceaux ('c') vus à la frame PRÉCÉDENTE, avec leur position — nécessaire pour connaître
     * la dernière position d'un morceau qui vient de disparaître (il n'est par définition plus
     * dans `currentEntities` une fois disparu). */
    let previousPieces = new Map<string, EntitySnapshot>();
    /** Pinceau nourriture (§10.1) — maintenu tant que le bouton reste enfoncé en mode `'food'`,
     * indépendamment des événements souris individuels (voir `onMouseDown`/`onMouseUp` et la
     * cadence dans `frame()`). */
    let isPaintingFood = false;
    let foodPaintAccumMs = 0;
    /** Déplacement physique (§9.1, `spawnMode === 'move'`) — maintenu tant que le bouton reste
     * enfoncé, throttlé à `DRAG_MOVE_INTERVAL_MS` (voir `frame()`). */
    let isDraggingPlayer = false;
    let dragAccumMs = 0;

    function resize(): void {
      canvas!.width = canvas!.clientWidth;
      canvas!.height = canvas!.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Plein écran (§8.3bis) : `resize()` doit être rappelé explicitement à l'entrée/sortie — un
    // changement de mode plein écran ne déclenche pas toujours un `resize` fenêtre fiable selon le
    // navigateur, contrairement à un redimensionnement de fenêtre classique.
    function onFullscreenChange(): void {
      resize();
      setIsFullscreen(document.fullscreenElement === canvasWrapRef.current);
    }
    document.addEventListener('fullscreenchange', onFullscreenChange);

    const handle = connectAdminSocket(token, roomId, {
      onState: (state) => {
        renderEngine.pushSnapshot(state.entities, state.tick, undefined, state.entitiesFull, state.removedFoodIds);
      },
      onPlayerInfo: (id, nick, color) => {
        nicknames.set(id, nick);
        if (color) colorsMap.set(id, color);
      },
      // État fiable (A3, plan-implementation-admin.md §3.9) : nickname/mass/isFrozen viennent
      // désormais du serveur (`adminListPlayers()`, ~1Hz) plutôt que d'être dérivés des snapshots
      // `state` — `isFrozen` y était auparavant TOUJOURS `false` (le badge GELÉ était mort), et
      // le pseudo d'un bot y était deviné côté client faute de mieux.
      onAdminPlayers: (players) => {
        const list: PlayerInspectInfo[] = players.map((p) => ({
          playerId: p.playerId,
          nickname: p.nickname,
          skin: colorsMap.get(p.playerId),
          mass: p.mass,
          isBot: p.isBot,
          isFrozen: p.isFrozen,
          isGod: p.isGod,
          possessedByAdmin: p.possessedByAdmin,
        }));
        list.sort((a, b) => b.mass - a.mass);
        setLivePlayerList(list);
      },
      onWelcome: (welcome) => {
        renderEngine.reset();
        renderEngine.serverTickRateHz = welcome.tickRateHz;
        mapSize = welcome.mapSize;
        const fit = computeFitCamera(mapSize, canvas!.width, canvas!.height);
        camera.x = fit.x;
        camera.y = fit.y;
        camera.scale = fit.scale;
        setLiveTickRateHz(welcome.tickRateHz);
        setMapSize(welcome.mapSize);
        setConnectionStatus('connected');
      },
      onClose: (reason) => {
        setConnectionStatus('disconnected');
        showToast(reason, 'error');
      },
    });
    socketRef.current = handle;
    setConnectionStatus('connecting');

    function centerOf(playerId: string, currentEntities: EntitySnapshot[]): { x: number; y: number } | undefined {
      const pieces = currentEntities.filter((e) => e.p === playerId);
      if (pieces.length === 0) return undefined;
      return {
        x: pieces.reduce((s, e) => s + e.x, 0) / pieces.length,
        y: pieces.reduce((s, e) => s + e.y, 0) / pieces.length,
      };
    }

    /** Bornes de zoom dépendantes de `mapSize` (§8.3) — jamais moins large que la vue d'ensemble
     * complète de la carte (`computeFitCamera`), jamais plus proche qu'un zoom fixe raisonnable.
     * Repli générique (pas une carte "typique" codée en dur) le temps très bref avant le premier
     * `welcome` — voir `camera`, même repli côté échelle. */
    function scaleBounds(): { min: number; max: number } {
      if (!mapSize) return { min: 0.02, max: 3 };
      const fitScale = computeFitCamera(mapSize, canvas!.width, canvas!.height).scale;
      return { min: fitScale * 0.5, max: 3 };
    }

    function onKeyDown(event: KeyboardEvent): void {
      pressedKeys.add(event.key.toLowerCase());
    }
    function onKeyUp(event: KeyboardEvent): void {
      pressedKeys.delete(event.key.toLowerCase());
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    // Zoom molette centré sur le curseur (§8.3) : le point monde sous le curseur reste sous le
    // curseur après le zoom, au lieu de zoomer sur le centre de l'écran (comportement précédent).
    // Ctrl+molette sur un joueur sélectionné (§9.2) : raccourci grossir/réduire plutôt que zoomer
    // la caméra — bascule AVANT toute logique de zoom, jamais les deux à la fois.
    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      if (event.ctrlKey && liveRef.current.selectedPlayerId && liveRef.current.selectedPlayerMass) {
        const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
        const newMass = Math.max(10, Math.round(liveRef.current.selectedPlayerMass * factor));
        throttledSetMass(liveRef.current.selectedPlayerId, newMass);
        return;
      }
      const factor = event.deltaY > 0 ? 0.88 : 1.14;
      const { min, max } = scaleBounds();
      const newScale = Math.min(max, Math.max(min, camera.scale * factor));
      const worldBefore = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      camera.scale = newScale;
      const worldAfter = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      camera.x += worldBefore.x - worldAfter.x;
      camera.y += worldBefore.y - worldAfter.y;
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onMouseDown(event: MouseEvent): void {
      if (event.button === 2) return;
      const godId = godPlayerIdRef.current;
      if (godId || liveRef.current.possessedPlayerId) return;

      const currentEntities = renderEngine.getInterpolatedEntities(16, camera, canvas!.width, canvas!.height, undefined, true, mapSize);
      const clicked = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p) {
        liveRef.current.followId = clicked.p;
        setSelectedPlayerId(clicked.p);
        return;
      }

      if (liveRef.current.spawnMode === 'food') {
        isPaintingFood = true;
        foodPaintAccumMs = 0;
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        runAction({ kind: 'spawnFood', x: world.x, y: world.y, mass: liveRef.current.foodBrushMass }, 'Pinceau nourriture actif');
        return;
      }

      if (liveRef.current.spawnMode === 'bot') {
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        const nickname = liveRef.current.customBotNickname.trim() || undefined;
        const mass = Number(liveRef.current.customBotMass);
        runAction(
          {
            kind: 'spawnBot',
            nickname,
            mass: Number.isFinite(mass) && mass > 0 ? mass : undefined,
            x: world.x,
            y: world.y,
          },
          nickname ? `Bot "${nickname}" créé` : 'Bot créé',
        );
        return;
      }

      if (liveRef.current.spawnMode === 'virus') {
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        runAction({ kind: 'spawnVirus', x: world.x, y: world.y, virusType: liveRef.current.virusType }, 'Virus placé');
        return;
      }

      // Déplacement physique (§9.1) — remplace l'ex-mode "Téléporter" qui détournait `godInput`
      // (le joueur était ATTIRÉ vers le point, jamais réellement déplacé, voir §1
      // plan-implementation-admin.md). Clic maintenu = drag continu (throttlé dans `frame()`),
      // avec un premier `dragMove` immédiat dès le clic pour un ressenti réactif.
      if (liveRef.current.spawnMode === 'move' && liveRef.current.selectedPlayerId) {
        isDraggingPlayer = true;
        dragAccumMs = 0;
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        runAction({ kind: 'dragMove', playerId: liveRef.current.selectedPlayerId, x: world.x, y: world.y });
        return;
      }

      liveRef.current.followId = undefined;
      isPanning = true;
      lastPanScreen = { x: event.clientX, y: event.clientY };
    }

    // Double-clic = suivre + zoom rapproché (§8.3, remplace l'ex-mode POV séparé du niveau liste).
    function onDoubleClick(event: MouseEvent): void {
      const currentEntities = renderEngine.getInterpolatedEntities(16, camera, canvas!.width, canvas!.height, undefined, true, mapSize);
      const clicked = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (!clicked?.p) return;
      liveRef.current.followId = clicked.p;
      setSelectedPlayerId(clicked.p);
      liveRef.current.pendingCloseZoom = true;
    }

    function onMouseMove(event: MouseEvent): void {
      lastMouseScreen = { x: event.offsetX, y: event.offsetY };
      lastMouseWorld = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (isPanning) {
        const dx = (event.clientX - lastPanScreen.x) / camera.scale;
        const dy = (event.clientY - lastPanScreen.y) / camera.scale;
        camera.x -= dx;
        camera.y -= dy;
        lastPanScreen = { x: event.clientX, y: event.clientY };
        liveRef.current.followId = undefined;
      }
    }
    function onMouseLeave(): void {
      hoveredEntity = undefined;
      isPaintingFood = false;
      isDraggingPlayer = false;
    }
    function onMouseUp(): void {
      isPanning = false;
      isPaintingFood = false;
      isDraggingPlayer = false;
    }
    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const currentEntities = renderEngine.getInterpolatedEntities(16, camera, canvas!.width, canvas!.height, undefined, true, mapSize);
      const clicked = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p && !clicked.p.startsWith('admin-god-')) {
        setSelectedPlayerId(clicked.p);
        setContextMenu({ screenX: event.clientX, screenY: event.clientY, playerId: clicked.p });
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    canvas.addEventListener('dblclick', onDoubleClick);
    canvas.addEventListener('mouseleave', onMouseLeave);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    let lastFrameAt = performance.now();
    let godInputAccumMs = 0;
    let raf = 0;

    // Boucle de rendu 60 FPS — moteur mutualisé avec le jeu (A16) : mêmes grille/couleurs/skins/
    // interpolation que `renderFrame`/`RenderEngine` (@angulio/shared/render), plus les surcouches
    // admin (halo de sélection, tooltip de survol, marqueurs d'événement, minimap).
    function frame(): void {
      const now = performance.now();
      const dtMs = now - lastFrameAt;
      lastFrameAt = now;

      const currentEntities = renderEngine.getInterpolatedEntities(dtMs, camera, canvas!.width, canvas!.height, undefined, true, mapSize);

      if (liveRef.current.pendingJumpTo) {
        camera.x = liveRef.current.pendingJumpTo.x;
        camera.y = liveRef.current.pendingJumpTo.y;
        liveRef.current.pendingJumpTo = undefined;
        liveRef.current.followId = undefined;
      }

      // Pinceau nourriture (§10.1) : tant que le clic est maintenu en mode `'food'`, sème en
      // continu autour du curseur (rayon `foodBrushRadius`) à cadence fixe, indépendamment du
      // framerate réel — accumulateur, comme le reste des cadences throttlées de cette boucle.
      if (isPaintingFood) {
        foodPaintAccumMs += dtMs;
        while (foodPaintAccumMs >= FOOD_PAINT_INTERVAL_MS) {
          foodPaintAccumMs -= FOOD_PAINT_INTERVAL_MS;
          const radius = liveRef.current.foodBrushRadius;
          const angle = Math.random() * Math.PI * 2;
          const dist = Math.random() * radius;
          runAction({
            kind: 'spawnFood',
            x: lastMouseWorld.x + Math.cos(angle) * dist,
            y: lastMouseWorld.y + Math.sin(angle) * dist,
            mass: liveRef.current.foodBrushMass,
          });
        }
      }

      // Déplacement physique (§9.1) : idem, mais un seul `dragMove` par échéance (pas de boucle
      // `while`, un déplacement continu n'a pas besoin de rattraper les échéances manquées comme
      // le pinceau nourriture — la dernière position connue suffit).
      if (isDraggingPlayer && liveRef.current.selectedPlayerId) {
        dragAccumMs += dtMs;
        if (dragAccumMs >= DRAG_MOVE_INTERVAL_MS) {
          dragAccumMs = 0;
          runAction({
            kind: 'dragMove',
            playerId: liveRef.current.selectedPlayerId,
            x: lastMouseWorld.x,
            y: lastMouseWorld.y,
          });
        }
      }

      const godId = godPlayerIdRef.current;
      const possessedId = liveRef.current.possessedPlayerId;
      const controlledId = godId ?? possessedId;
      if (controlledId) {
        const controlledCenter = centerOf(controlledId, currentEntities);
        if (controlledCenter) {
          camera.x = controlledCenter.x;
          camera.y = controlledCenter.y;
        }
        godInputAccumMs += dtMs;
        if (godInputAccumMs >= GOD_INPUT_INTERVAL_MS) {
          godInputAccumMs = 0;
          // Dash/eject/split (§10.4) : mêmes touches par défaut que le jeu (client/src/keybinds.ts
          // `DEFAULT_KEYBINDS` — Espace/F/E), au clavier tant que la souris pilote la direction.
          // Partagé Dieu/marionnette : les deux gagnent les mêmes contrôles complets d'un vrai
          // joueur (§9.3/§10.4).
          const controlPayload = {
            x: lastMouseWorld.x,
            y: lastMouseWorld.y,
            intensity: 1,
            split: pressedKeys.has(' '),
            dash: pressedKeys.has('f'),
            eject: pressedKeys.has('e'),
          };
          if (godId) {
            runAction({ kind: 'godInput', playerId: godId, ...controlPayload });
          } else if (possessedId) {
            runAction({ kind: 'possessInput', playerId: possessedId, ...controlPayload });
          }
        }
      } else if (liveRef.current.followId) {
        const center = centerOf(liveRef.current.followId, currentEntities);
        if (center) {
          camera.x = center.x;
          camera.y = center.y;
        }
        if (liveRef.current.pendingCloseZoom) {
          camera.scale = FOLLOW_CLOSE_ZOOM_SCALE;
          liveRef.current.pendingCloseZoom = false;
        }
      } else {
        const speed = (pressedKeys.has('shift') ? 3 : 1) * KEY_PAN_SPEED * (dtMs / 1000);
        if (pressedKeys.has('q') || pressedKeys.has('arrowleft')) camera.x -= speed;
        if (pressedKeys.has('d') || pressedKeys.has('arrowright')) camera.x += speed;
        if (pressedKeys.has('z') || pressedKeys.has('arrowup')) camera.y -= speed;
        if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) camera.y += speed;
      }

      // Marqueurs d'événement (§8.4) : un morceau connu la frame précédente et absent de celle-ci
      // vient de disparaître (mort/split/fusion) — dérivé purement côté client, aucun changement
      // de protocole. Le canal admin reçoit TOUTES les entités (pas de filtrage d'intérêt), donc
      // une disparition observée ici est une vraie disparition, pas un simple hors-écran.
      const currentPieces = new Map<string, EntitySnapshot>();
      for (const entity of currentEntities) {
        if (entity.k !== 'c') continue;
        currentPieces.set(entity.i, entity);
        eventMarkers.delete(entity.i); // réapparu (ex. respawn réutilisant l'id) : plus à marquer
      }
      for (const [id, lastSeen] of previousPieces) {
        if (!currentPieces.has(id)) {
          eventMarkers.set(id, { x: lastSeen.x, y: lastSeen.y, at: now });
        }
      }
      previousPieces = currentPieces;

      renderFrame(ctx, canvas!, currentEntities, camera, nicknames, colorsMap, undefined, mapSize, undefined, liveRef.current.hideNicknames);

      // Halo de sélection (accent) — `renderFrame` (partagé avec le jeu) ne connaît pas la notion
      // de "sélection admin", surcouche dessinée par-dessus.
      const selectedId = liveRef.current.selectedPlayerId;
      if (selectedId) {
        for (const entity of currentEntities) {
          if (entity.p !== selectedId) continue;
          const { x, y } = worldToScreen(camera, canvas!.width, canvas!.height, entity.x, entity.y);
          const r = entity.r * camera.scale;
          ctx.beginPath();
          ctx.arc(x, y, r + 4, 0, Math.PI * 2);
          ctx.strokeStyle = '#60a5fa';
          ctx.lineWidth = 2;
          ctx.stroke();
        }
      }

      // Marqueurs de disparition qui s'estompent (~2s).
      for (const [id, marker] of eventMarkers) {
        const age = now - marker.at;
        if (age > EVENT_MARKER_FADE_MS) {
          eventMarkers.delete(id);
          continue;
        }
        const alpha = 1 - age / EVENT_MARKER_FADE_MS;
        const { x, y } = worldToScreen(camera, canvas!.width, canvas!.height, marker.x, marker.y);
        ctx.strokeStyle = `rgba(239, 68, 68, ${alpha})`;
        ctx.lineWidth = 2;
        const s = 7;
        ctx.beginPath();
        ctx.moveTo(x - s, y - s);
        ctx.lineTo(x + s, y + s);
        ctx.moveTo(x + s, y - s);
        ctx.lineTo(x - s, y + s);
        ctx.stroke();
      }

      // Tooltip de survol (§8.4) : pseudo + masse — pas de ping ici, le message périodique
      // `adminPlayers` (A3) ne le porte pas encore (source : `runtime.latencyByPlayer`, jamais
      // enrichi sur ce canal, contrairement à `GET /api/admin/rooms`).
      hoveredEntity = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, lastMouseScreen.x, lastMouseScreen.y);
      if (hoveredEntity?.p) {
        const nickname = nicknames.get(hoveredEntity.p) ?? hoveredEntity.p;
        const label = `${nickname} · ${Math.round(hoveredEntity.m)}m`;
        ctx.font = '600 12px sans-serif';
        const padding = 6;
        const textWidth = ctx.measureText(label).width;
        const boxX = lastMouseScreen.x + 14;
        const boxY = lastMouseScreen.y - 10;
        ctx.fillStyle = 'rgba(18, 20, 26, 0.9)';
        ctx.fillRect(boxX, boxY - 16, textWidth + padding * 2, 22);
        ctx.fillStyle = '#ffffff';
        ctx.textAlign = 'left';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, boxX + padding, boxY - 5);
      }

      const minimapCanvas = minimapCanvasRef.current;
      if (minimapCanvas && mapSize > 0) {
        drawMinimap(minimapCanvas, currentEntities, camera, mapSize, canvas!.width, canvas!.height);
      }

      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('dblclick', onDoubleClick);
      canvas.removeEventListener('mouseleave', onMouseLeave);
      canvas.removeEventListener('contextmenu', onContextMenu);
      document.removeEventListener('fullscreenchange', onFullscreenChange);
      handle.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

  const toggleFullscreen = (): void => {
    if (document.fullscreenElement) {
      void document.exitFullscreen();
    } else {
      void canvasWrapRef.current?.requestFullscreen();
    }
  };

  const toggleGodmode = (): void => {
    if (godActive) {
      const id = godPlayerIdRef.current;
      if (id) runAction({ kind: 'disableGodmode', playerId: id }, "Mode Blob Dieu désactivé");
      godPlayerIdRef.current = undefined;
      setGodActive(false);
    } else {
      const id = generateGodPlayerId();
      godPlayerIdRef.current = id;
      runAction({ kind: 'enableGodmode', playerId: id, nickname: 'Fantadmin (Dieu)' }, "Mode Blob Dieu activé !");
      setGodActive(true);
    }
  };

  const boostGodMass = (): void => {
    const id = godPlayerIdRef.current;
    if (!id) return;
    runAction({ kind: 'setMass', playerId: id, mass: 10_000 }, "Masse du Dieu portée à 10 000");
  };

  const sendBroadcast = (): void => {
    const text = broadcastText.trim();
    if (!text) return;
    const scope = broadcastGlobal ? 'Tous les salons' : activeRoom?.name || roomId;
    void broadcastMessage(token, text, {
      color: broadcastColor,
      durationMs: broadcastDurationSec * 1000,
      roomId: broadcastGlobal ? undefined : roomId,
    })
      .then((result) => {
        showToast(`Annonce envoyée à ${result.sent} joueur(s).`, 'success');
        setBroadcastHistory((history) => [
          { at: Date.now(), text, scope, durationSec: broadcastDurationSec, sent: result.sent },
          ...history,
        ]);
        setBroadcastText('');
      })
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
  };

  const contextAction = (kind: 'kill' | 'freeze' | 'unfreeze' | 'split' | 'remerge'): void => {
    if (!contextMenu) return;
    runAction({ kind, playerId: contextMenu.playerId }, `Action ${kind} exécutée`);
    setContextMenu(null);
  };

  const handleConfirmKick = (reason: string): void => {
    if (!kickTarget) return;
    const { playerId: pId, nickname: nick } = kickTarget;
    void kickPlayer(token, roomId, pId, reason)
      .then(() => showToast(`Joueur ${nick} expulsé avec succès`, 'success'))
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
    setKickTarget(null);
  };

  const otherRooms = rooms.filter((r) => r.id !== roomId);

  const handleTransferSelected = (): void => {
    if (!selectedPlayerId || !selectedTargetRoomId) return;
    const nickname = selectedPlayer?.nickname ?? selectedPlayerId;
    void transferPlayer(token, roomId, selectedPlayerId, selectedTargetRoomId)
      .then(() => showToast(`${nickname} transféré(e).`, 'success'))
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
    setSelectedTargetRoomId('');
  };

  /** Bot personnalisé (§9.3/§17) — instantané au centre de la vue actuelle plutôt qu'au clic,
   * pour l'admin qui veut juste "un bot nommé X avec Y de masse", sans viser un point précis. */
  const spawnCustomBotHere = (): void => {
    const nickname = customBotNickname.trim() || undefined;
    const mass = Number(customBotMass);
    runAction(
      { kind: 'spawnBot', nickname, mass: Number.isFinite(mass) && mass > 0 ? mass : undefined },
      nickname ? `Bot "${nickname}" créé` : 'Bot créé',
    );
  };

  /** Vague de bots (§10.3, P4) — additif, distinct de `spawnCustomBotHere` ci-dessus (bot
   * personnalisé unitaire, inchangé). */
  const spawnBotWave = (): void => {
    const mass = Number(botWaveMass);
    runAction(
      {
        kind: 'spawnBots',
        count: botWaveCount,
        mass: Number.isFinite(mass) && mass > 0 ? mass : undefined,
        behaviorProfile: botWaveBehaviorProfile || undefined,
      },
      `Vague de ${botWaveCount} bots lancée`,
    );
  };

  const selectedPlayer = livePlayerList.find((p) => p.playerId === selectedPlayerId);

  /** Confirmation à 2 clics (§17) — un premier clic arme, un second dans les 4s confirme. */
  const handleKillClick = (): void => {
    if (!selectedPlayerId) return;
    if (!killArmed) {
      setKillArmed(true);
      setTimeout(() => setKillArmed(false), 4000);
      return;
    }
    runAction({ kind: 'kill', playerId: selectedPlayerId }, 'Joueur éliminé');
    setKillArmed(false);
  };

  const applyCustomMass = (): void => {
    if (!selectedPlayerId) return;
    const mass = Number(customMassDraft);
    if (!Number.isFinite(mass) || mass <= 0) return;
    runAction({ kind: 'setMass', playerId: selectedPlayerId, mass }, `Masse réglée à ${Math.round(mass)}`);
    setCustomMassDraft('');
  };

  const activeRoom = rooms.find((r) => r.id === roomId);

  const filteredPlayers = livePlayerList.filter((p) => {
    if (typeFilter === 'human' && p.isBot) return false;
    if (typeFilter === 'bot' && !p.isBot) return false;
    if (searchFilter.trim()) {
      return p.nickname.toLowerCase().includes(searchFilter.toLowerCase()) || p.playerId.includes(searchFilter);
    }
    return true;
  });

  return (
    <div className="view view-wide creative-view" style={{ maxWidth: '100%', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      {/* Toast Notification Notification Pop-over */}
      {toastMsg && (
        <div
          style={{
            position: 'fixed',
            bottom: 24,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 999,
            background: toastMsg.type === 'error' ? 'var(--danger)' : toastMsg.type === 'success' ? 'var(--success)' : 'var(--accent)',
            color: '#ffffff',
            padding: '10px 20px',
            borderRadius: 'var(--radius-pill)',
            boxShadow: 'var(--shadow-modal)',
            fontWeight: 700,
            fontSize: 13,
          }}
        >
          {toastMsg.text}
        </div>
      )}

      {/* Top Header Bar */}
      <div className="top-bar" style={{ flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
          <button
            className="btn-ghost"
            type="button"
            onClick={onBack}
            title="Retour à la liste des salons"
            style={{ padding: '6px 8px', marginTop: 2 }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 18 }}>arrow_back</span>
          </button>
          <div>
            <h2>Studio de contrôle</h2>
            <p className="view-subtitle">
              Surveillance en direct, manipulation physique des joueurs et gestion d'arène.
            </p>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionStatusDot status={connectionStatus} />
          {activeRoom && (
            <span className="badge" style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)' }}>
              {activeRoom.modId.toUpperCase()} · {activeRoom.stats.playerCount}/{activeRoom.maxPlayers} joueurs
            </span>
          )}
          <select
            value={roomId}
            onChange={(event) => setRoomId(event.target.value)}
            style={{ padding: '8px 14px', fontSize: 13.5, fontWeight: 600, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)' }}
          >
            {rooms.map((room) => (
              <option key={room.id} value={room.id}>
                Salon : {room.name} ({room.modId})
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Zone Observation (§9.2) — panneau gauche, lecture seule : recherche/filtre/suivi caméra.
          Sélectionner un joueur ici l'expose comme cible aux actions de la zone Intervention. */}
      <div className="studio-zone-observe" style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
        <div
          className="panel"
          style={{
            width: 300,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: 'auto',
            height: '100%',
            padding: 16,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span className="section-title" style={{ margin: 0 }}>
              Observation ({filteredPlayers.length})
            </span>
            <span className="badge" style={{ fontSize: 10 }}>
              {liveTickRateHz !== undefined ? `Live ${liveTickRateHz}Hz` : 'Live —'}
            </span>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <input
              type="text"
              placeholder="Rechercher par pseudo ou ID..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              style={{ width: '100%', fontSize: 12, padding: '7px 10px' }}
            />
            <div style={{ display: 'flex', gap: 4 }}>
              <button
                type="button"
                className={typeFilter === 'all' ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '3px 10px', fontSize: 11, flex: 1 }}
                onClick={() => setTypeFilter('all')}
              >
                Tous ({livePlayerList.length})
              </button>
              <button
                type="button"
                className={typeFilter === 'human' ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '3px 10px', fontSize: 11, flex: 1 }}
                onClick={() => setTypeFilter('human')}
              >
                Humains ({livePlayerList.filter((p) => !p.isBot).length})
              </button>
              <button
                type="button"
                className={typeFilter === 'bot' ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '3px 10px', fontSize: 11, flex: 1 }}
                onClick={() => setTypeFilter('bot')}
              >
                Bots ({livePlayerList.filter((p) => p.isBot).length})
              </button>
            </div>
          </div>

          {filteredPlayers.length === 0 ? (
            <p className="view-subtitle" style={{ fontStyle: 'italic', marginTop: 10 }}>
              Aucun joueur actif dans ce salon. Spawnez des bots ou de la nourriture !
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {filteredPlayers.map((p) => {
                const isSelected = selectedPlayerId === p.playerId;
                const skinImgUrl = p.skin ? SKIN_IMAGE_MAP[p.skin] : undefined;

                return (
                  <button
                    key={p.playerId}
                    type="button"
                    onClick={() => setSelectedPlayerId(isSelected ? undefined : p.playerId)}
                    style={{
                      background: isSelected ? 'var(--accent-soft)' : 'var(--bg)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '9px 10px',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 8,
                      textAlign: 'left',
                      fontFamily: 'inherit',
                      cursor: 'pointer',
                    }}
                    title="Sélectionner (suivre la caméra + cibler pour l'Intervention)"
                  >
                    {skinImgUrl ? (
                      <img src={skinImgUrl} alt={p.skin} style={{ width: 26, height: 26, borderRadius: '50%', objectFit: 'contain', flexShrink: 0 }} />
                    ) : (
                      <div style={{ width: 26, height: 26, borderRadius: '50%', background: p.isBot ? 'var(--accent-soft)' : '#fef3c7', flexShrink: 0 }} />
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 700, fontSize: 12.5, display: 'flex', alignItems: 'center', gap: 4, overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nickname}</span>
                        {p.isBot ? (
                          <span className="badge" style={{ fontSize: 8.5, padding: '1px 5px', background: 'var(--accent-soft)', color: 'var(--accent-strong)', flexShrink: 0 }}>BOT</span>
                        ) : (
                          <span className="badge" style={{ fontSize: 8.5, padding: '1px 5px', background: '#fef3c7', color: '#92400e', flexShrink: 0 }}>JOUEUR</span>
                        )}
                        {p.isFrozen && (
                          <span className="badge" style={{ fontSize: 8.5, padding: '1px 5px', background: 'rgba(46,49,71,0.08)', color: 'var(--text-soft)', flexShrink: 0 }}>GELÉ</span>
                        )}
                        {p.possessedByAdmin && (
                          <span className="badge" style={{ fontSize: 8.5, padding: '1px 5px', background: '#fee2e2', color: '#991b1b', flexShrink: 0 }}>MARIONNETTE</span>
                        )}
                        {p.isGod && (
                          <span className="badge" style={{ fontSize: 8.5, padding: '1px 5px', background: '#ede9fe', color: '#5b21b6', flexShrink: 0 }}>DIEU</span>
                        )}
                      </div>
                    </div>
                    <span style={{ fontSize: 11.5, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--text-soft)', flexShrink: 0 }}>
                      {Math.round(p.mass)}m
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Canvas Wrap (§9.1 : reste sombre, "moniteur vidéo") */}
        <div ref={canvasWrapRef} className="creative-canvas-wrap" style={{ flex: 1, height: '100%', position: 'relative', margin: 0 }}>
          <canvas ref={canvasRef} className="creative-canvas" />
          <button
            type="button"
            className="btn-ghost"
            onClick={toggleFullscreen}
            title={isFullscreen ? 'Quitter le plein écran' : 'Plein écran'}
            style={{
              position: 'absolute',
              top: 10,
              right: 46,
              padding: '4px 10px',
              fontSize: 11,
              background: 'rgba(18,20,26,0.75)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>
              {isFullscreen ? 'fullscreen_exit' : 'fullscreen'}
            </span>
          </button>
          <button
            type="button"
            className="btn-ghost"
            onClick={() => setHideNicknames(!hideNicknames)}
            title={hideNicknames ? 'Afficher les pseudos' : 'Masquer les pseudos'}
            style={{
              position: 'absolute',
              top: 10,
              right: 10,
              padding: '4px 10px',
              fontSize: 11,
              background: 'rgba(18,20,26,0.75)',
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.15)',
            }}
          >
            <span className="material-symbols-outlined" style={{ fontSize: 14, verticalAlign: 'middle' }}>
              {hideNicknames ? 'visibility_off' : 'visibility'}
            </span>
          </button>
          <StudioMinimap
            canvasRef={minimapCanvasRef}
            mapSize={mapSize}
            onJumpToWorld={(x, y) => {
              liveRef.current.pendingJumpTo = { x, y };
            }}
          />
        </div>

        {/* Zone Intervention (§9.3) — panneau droit rétractable, bordure rouge/orange : tout ce
            qui a un effet réel sur la partie, jamais mélangé à l'observation. */}
        <div
          className="panel studio-zone-intervene"
          style={{
            width: interveneOpen ? 320 : 52,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            overflowY: interveneOpen ? 'auto' : 'hidden',
            height: '100%',
            padding: interveneOpen ? 16 : 10,
            boxSizing: 'border-box',
            transition: 'width 0.15s ease',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            {interveneOpen && (
              <span className="section-title" style={{ margin: 0 }}>
                Intervention
              </span>
            )}
            <button
              type="button"
              className="btn-ghost"
              style={{ padding: 4, marginLeft: 'auto' }}
              onClick={() => setInterveneOpen(!interveneOpen)}
              title={interveneOpen ? 'Réduire' : 'Déplier'}
            >
              <span className="material-symbols-outlined" style={{ fontSize: 16 }}>
                {interveneOpen ? 'chevron_right' : 'chevron_left'}
              </span>
            </button>
          </div>

          {interveneOpen && (
            <>
              <div className="intervene-tabs">
                {(
                  [
                    ['spawn', 'Spawn'],
                    ['sanctions', 'Sanctions'],
                    ['salon', 'Salon'],
                    ['god', 'Dieu'],
                  ] as const
                ).map(([tab, label]) => (
                  <button
                    key={tab}
                    type="button"
                    className={interveneTab === tab ? 'btn-primary intervene-tab' : 'btn-ghost intervene-tab'}
                    onClick={() => setInterveneTab(tab)}
                  >
                    {label}
                  </button>
                ))}
              </div>

              {interveneTab === 'spawn' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button
                    className={spawnMode === 'food' ? 'btn-primary' : 'btn-ghost'}
                    type="button"
                    onClick={() => setSpawnMode(spawnMode === 'food' ? 'none' : 'food')}
                    title="Maintenir le clic pour peindre de la nourriture (§10.1)"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">grain</span> Pinceau nourriture
                  </button>
                  {spawnMode === 'food' && (
                    <div style={{ display: 'flex', gap: 6 }}>
                      <input
                        type="number"
                        placeholder="Rayon"
                        value={foodBrushRadius}
                        onChange={(e) => setFoodBrushRadius(Math.max(1, Number(e.target.value) || 1))}
                        style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                      />
                      <input
                        type="number"
                        placeholder="Masse"
                        value={foodBrushMass}
                        onChange={(e) => setFoodBrushMass(Math.max(1, Number(e.target.value) || 1))}
                        style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                      />
                    </div>
                  )}
                  <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearFood' }, 'Pastilles nettoyées')}>
                    <span className="material-symbols-outlined" aria-hidden="true">cleaning_services</span> Vider pastilles
                  </button>

                  <span className="section-title" style={{ marginTop: 6 }}>Bot personnalisé</span>
                  <input
                    type="text"
                    placeholder="Nom (optionnel)"
                    value={customBotNickname}
                    onChange={(e) => setCustomBotNickname(e.target.value)}
                    style={{ fontSize: 12.5, padding: '7px 10px' }}
                  />
                  <input
                    type="number"
                    placeholder="Masse initiale (optionnel)"
                    value={customBotMass}
                    onChange={(e) => setCustomBotMass(e.target.value)}
                    style={{ fontSize: 12.5, padding: '7px 10px' }}
                  />
                  <button className="btn-ghost" type="button" onClick={spawnCustomBotHere}>
                    <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span> Spawn ici
                  </button>
                  <button
                    className={spawnMode === 'bot' ? 'btn-primary' : 'btn-ghost'}
                    type="button"
                    onClick={() => setSpawnMode(spawnMode === 'bot' ? 'none' : 'bot')}
                    title="Cliquez sur la carte pour placer le bot à cet endroit précis"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">my_location</span> Placer au clic
                  </button>

                  <span className="section-title" style={{ marginTop: 6 }}>Vague de bots</span>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      min={1}
                      max={50}
                      value={botWaveCount}
                      onChange={(e) => setBotWaveCount(Math.min(50, Math.max(1, Number(e.target.value) || 1)))}
                      style={{ flex: 1, fontSize: 12.5, padding: '7px 10px' }}
                      title="Nombre de bots (1-50)"
                    />
                    <input
                      type="number"
                      placeholder="Masse (optionnel)"
                      value={botWaveMass}
                      onChange={(e) => setBotWaveMass(e.target.value)}
                      style={{ flex: 1, fontSize: 12.5, padding: '7px 10px' }}
                    />
                  </div>
                  <select
                    value={botWaveBehaviorProfile}
                    onChange={(e) => setBotWaveBehaviorProfile(e.target.value)}
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                  >
                    <option value="">Profil de comportement par défaut</option>
                    {botBehaviorProfiles.map((id) => (
                      <option key={id} value={id}>
                        {id}
                      </option>
                    ))}
                  </select>
                  <button className="btn-ghost" type="button" onClick={spawnBotWave}>
                    <span className="material-symbols-outlined" aria-hidden="true">groups</span> Lancer la vague ({botWaveCount})
                  </button>

                  <span className="section-title" style={{ marginTop: 6 }}>Virus</span>
                  <div style={{ display: 'flex', gap: 4 }}>
                    {(
                      [
                        [1, 'Vert'],
                        [2, 'Rouge'],
                        [3, 'Bleu'],
                      ] as const
                    ).map(([type, label]) => (
                      <button
                        key={type}
                        type="button"
                        className={virusType === type ? 'btn-primary' : 'btn-ghost'}
                        style={{ flex: 1, padding: '4px 6px', fontSize: 11 }}
                        onClick={() => setVirusType(type)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <button
                    className={spawnMode === 'virus' ? 'btn-primary' : 'btn-ghost'}
                    type="button"
                    onClick={() => setSpawnMode(spawnMode === 'virus' ? 'none' : 'virus')}
                    title="Cliquez sur la carte pour poser un virus"
                  >
                    <span className="material-symbols-outlined" aria-hidden="true">coronavirus</span> Placer au clic
                  </button>
                </div>
              )}

              {interveneTab === 'sanctions' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {!selectedPlayer ? (
                    <p className="view-subtitle" style={{ fontStyle: 'italic' }}>
                      Sélectionnez un joueur dans le panneau Observation pour agir sur lui.
                    </p>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, fontSize: 13 }}>
                        {selectedPlayer.nickname} <span className="id-tag">{Math.round(selectedPlayer.mass)}m</span>
                      </div>
                      <button
                        className="btn-ghost"
                        type="button"
                        onClick={() => runAction({ kind: selectedPlayer.isFrozen ? 'unfreeze' : 'freeze', playerId: selectedPlayer.playerId }, selectedPlayer.isFrozen ? 'Joueur dégelé' : 'Joueur gelé')}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">ac_unit</span>
                        {selectedPlayer.isFrozen ? 'Dégeler' : 'Geler'}
                      </button>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          type="number"
                          placeholder="Masse exacte"
                          value={customMassDraft}
                          onChange={(e) => setCustomMassDraft(e.target.value)}
                          style={{ flex: 1, fontSize: 12.5, padding: '7px 10px' }}
                        />
                        <button className="btn-ghost" type="button" onClick={applyCustomMass}>
                          Appliquer
                        </button>
                      </div>
                      {/* Masse en continu (§9.2) : glissière logarithmique 10 → 100 000, throttlée
                          ~100ms — le champ "masse exacte" ci-dessus reste inchangé (décision de
                          cadrage explicite, plan-implementation-admin.md §6.3). Ctrl+molette sur le
                          canvas fait la même chose par petits pas relatifs (voir `onWheel`). */}
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                        <label style={{ fontSize: 10.5, color: 'var(--text-soft)', display: 'flex', justifyContent: 'space-between' }}>
                          <span>Masse (glissière)</span>
                          <span style={{ fontFamily: 'var(--font-mono)' }}>{Math.round(10 ** massSliderLog).toLocaleString()}</span>
                        </label>
                        <input
                          type="range"
                          min={1}
                          max={5}
                          step={0.01}
                          value={massSliderLog}
                          onChange={(e) => {
                            const log = Number(e.target.value);
                            setMassSliderLog(log);
                            throttledSetMass(selectedPlayer.playerId, Math.round(10 ** log));
                          }}
                          style={{ width: '100%' }}
                        />
                      </div>
                      <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'split', playerId: selectedPlayer.playerId }, 'Split forcé déclenché')}>
                        <span className="material-symbols-outlined" aria-hidden="true">call_split</span> Split forcé
                      </button>
                      <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'remerge', playerId: selectedPlayer.playerId }, 'Refusion forcée')}>
                        <span className="material-symbols-outlined" aria-hidden="true">merge_type</span> Refusion forcée
                      </button>
                      <button
                        className={spawnMode === 'move' ? 'btn-primary' : 'btn-ghost'}
                        type="button"
                        onClick={() => setSpawnMode(spawnMode === 'move' ? 'none' : 'move')}
                        title="Cliquez (ou cliquez-glissez) sur la carte pour déplacer physiquement le joueur sélectionné"
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">near_me</span> Déplacer sur la carte
                      </button>
                      <button
                        className={possessedPlayerId === selectedPlayer.playerId ? 'btn-primary' : 'btn-ghost'}
                        type="button"
                        onClick={() => {
                          if (possessedPlayerId === selectedPlayer.playerId) {
                            runAction({ kind: 'unpossess', playerId: selectedPlayer.playerId }, 'Main rendue');
                            setPossessedPlayerId(undefined);
                          } else {
                            runAction({ kind: 'possess', playerId: selectedPlayer.playerId }, `Contrôle de ${selectedPlayer.nickname} pris`);
                            setPossessedPlayerId(selectedPlayer.playerId);
                          }
                        }}
                        title="Prendre le contrôle total (souris + Espace/F/E) — un seul blob possédé à la fois"
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">sports_esports</span>
                        {possessedPlayerId === selectedPlayer.playerId ? 'Rendre la main' : 'Posséder (marionnette)'}
                      </button>
                      {/* Apparence à la volée (§9.4) — session courante uniquement, jamais le
                          compte persistant (voir l'onglet Joueurs pour l'édition durable). */}
                      <span className="section-title" style={{ marginTop: 6 }}>Apparence (session)</span>
                      <input
                        type="text"
                        placeholder="Nouveau pseudo"
                        value={appearanceNicknameDraft}
                        onChange={(e) => setAppearanceNicknameDraft(e.target.value)}
                        style={{ fontSize: 12.5, padding: '7px 10px' }}
                      />
                      <div style={{ display: 'flex', gap: 6 }}>
                        <select
                          value={appearanceSkinDraft}
                          onChange={(e) => setAppearanceSkinDraft(e.target.value)}
                          style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                        >
                          <option value="">Skin inchangé</option>
                          {SKINS.map((skin) => (
                            <option key={skin} value={skin}>
                              {skin}
                            </option>
                          ))}
                        </select>
                        <button
                          className="btn-ghost"
                          type="button"
                          onClick={() => {
                            const nickname = appearanceNicknameDraft.trim() || undefined;
                            const color = appearanceSkinDraft || undefined;
                            if (nickname || color) {
                              runAction(
                                { kind: 'setAppearance', playerId: selectedPlayer.playerId, nickname, color },
                                'Apparence mise à jour',
                              );
                              setAppearanceNicknameDraft('');
                              setAppearanceSkinDraft('');
                            }
                          }}
                        >
                          Appliquer
                        </button>
                      </div>
                      {otherRooms.length > 0 && (
                        <div style={{ display: 'flex', gap: 6 }}>
                          <select
                            value={selectedTargetRoomId}
                            onChange={(e) => setSelectedTargetRoomId(e.target.value)}
                            style={{ flex: 1, fontSize: 12, padding: '6px 8px' }}
                          >
                            <option value="">Transférer vers…</option>
                            {otherRooms.map((r) => (
                              <option key={r.id} value={r.id}>
                                {r.name} ({r.stats.playerCount}/{r.maxPlayers})
                              </option>
                            ))}
                          </select>
                          <button className="btn-ghost" type="button" disabled={!selectedTargetRoomId} onClick={handleTransferSelected}>
                            OK
                          </button>
                        </div>
                      )}
                      <button
                        className="btn-ghost btn-danger"
                        type="button"
                        onClick={() => setKickTarget({ playerId: selectedPlayer.playerId, nickname: selectedPlayer.nickname })}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">logout</span> Kick
                      </button>
                      <button
                        className="btn-ghost btn-danger"
                        type="button"
                        onClick={handleKillClick}
                        style={killArmed ? { background: 'var(--danger)', color: '#fff' } : undefined}
                      >
                        <span className="material-symbols-outlined" aria-hidden="true">skull</span>
                        {killArmed ? 'Confirmer Kill ?' : 'Kill'}
                      </button>
                    </>
                  )}
                </div>
              )}

              {interveneTab === 'salon' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <select
                    onChange={(event) => {
                      if (event.target.value) runAction({ kind: 'switchMod', modId: event.target.value }, `Mode changé pour ${event.target.value}`);
                      event.target.value = '';
                    }}
                    defaultValue=""
                    style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '8px 12px' }}
                  >
                    <option value="" disabled>Changer de mode…</option>
                    {modes.map((modId) => (
                      <option key={modId} value={modId}>
                        {modId}
                      </option>
                    ))}
                  </select>
                  <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearBots' }, 'Bots retirés')}>
                    <span className="material-symbols-outlined" aria-hidden="true">no_accounts</span> Supprimer bots
                  </button>
                  <button className="btn-ghost btn-danger" type="button" onClick={() => setShowResetConfirm(true)}>
                    <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span> Reset salon
                  </button>
                </div>
              )}

              {interveneTab === 'god' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <button className={godActive ? 'btn-primary' : 'btn-ghost'} type="button" onClick={toggleGodmode}>
                    <span className="material-symbols-outlined" aria-hidden="true">workspace_premium</span> Blob Dieu {godActive ? '(actif)' : ''}
                  </button>
                  {godActive && (
                    <button className="btn-ghost" type="button" onClick={boostGodMass}>
                      <span className="material-symbols-outlined" aria-hidden="true">bolt</span> +10 000 masse
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* Broadcast Bar (§9.3 : reste séparé, inchangé dans sa fonction) */}
      <div className="creative-broadcast" style={{ flexShrink: 0 }}>
        <input
          value={broadcastText}
          onChange={(event) => setBroadcastText(event.target.value)}
          placeholder="Message à diffuser aux joueurs..."
          maxLength={200}
        />
        <input
          type="color"
          value={broadcastColor}
          onChange={(event) => setBroadcastColor(event.target.value)}
          style={{ width: 36, height: 36, padding: 2, cursor: 'pointer' }}
        />
        <label className="filter-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
          <input
            type="checkbox"
            checked={broadcastGlobal}
            onChange={(event) => setBroadcastGlobal(event.target.checked)}
          />
          Tous les salons
        </label>
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5, whiteSpace: 'nowrap' }}>
          <input
            type="number"
            min={1}
            max={60}
            value={broadcastDurationSec}
            onChange={(event) => setBroadcastDurationSec(Math.min(60, Math.max(1, Number(event.target.value) || 1)))}
            style={{ width: 52, padding: '4px 6px' }}
          />
          s
        </label>
        <button className="btn-primary" type="button" onClick={sendBroadcast}>
          <span className="material-symbols-outlined" aria-hidden="true">campaign</span> Diffuser
        </button>
        {broadcastHistory.length > 0 && (
          <details style={{ marginLeft: 'auto', fontSize: 11.5 }}>
            <summary style={{ cursor: 'pointer', color: 'var(--text-soft)' }}>
              Historique de session ({broadcastHistory.length})
            </summary>
            <ul style={{ listStyle: 'none', margin: '6px 0 0', padding: 0, maxHeight: 140, overflowY: 'auto' }}>
              {broadcastHistory.map((entry, i) => (
                <li key={i} style={{ padding: '3px 0', borderTop: i > 0 ? '1px solid var(--border)' : undefined }}>
                  <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-soft)' }}>
                    {new Date(entry.at).toLocaleTimeString()}
                  </span>{' '}
                  — {entry.text} ({entry.scope}, {entry.durationSec}s, {entry.sent} destinataire(s))
                </li>
              ))}
            </ul>
          </details>
        )}
      </div>

      {/* Context Menu on Right Click */}
      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="context-menu"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          >
            <button type="button" onClick={() => contextAction('kill')}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>skull</span> Éliminer (Kill)
            </button>
            <button type="button" onClick={() => contextAction('freeze')}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>ac_unit</span> Geler
            </button>
            <button type="button" onClick={() => contextAction('unfreeze')}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>play_arrow</span> Dégeler
            </button>
            <button type="button" onClick={() => runAction({ kind: 'setMass', playerId: contextMenu.playerId, mass: 2000 }, "Masse à 2000")}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>fitness_center</span> Masse à 2000
            </button>
            <button type="button" onClick={() => contextAction('split')}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>call_split</span> Split forcé
            </button>
            <button type="button" onClick={() => contextAction('remerge')}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 6, verticalAlign: 'middle' }}>merge_type</span> Refusion forcée
            </button>
          </div>
        </>
      )}

      <KickModal target={kickTarget} onConfirm={handleConfirmKick} onCancel={() => setKickTarget(null)} />

      {/* Reset Confirmation Modal */}
      {showResetConfirm && (
        <div className="context-menu-backdrop" style={{ zIndex: 150 }} onClick={() => setShowResetConfirm(false)}>
          <div
            className="panel"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 151,
              width: 360,
              maxWidth: '90vw',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Réinitialiser le salon ?</h3>
            <p className="view-subtitle" style={{ marginBottom: 16 }}>
              Attention : toutes les entités et morceaux de ce salon seront réinitialisés.
            </p>
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" type="button" onClick={() => setShowResetConfirm(false)}>
                Annuler
              </button>
              <button
                className="btn-primary btn-danger"
                type="button"
                onClick={() => {
                  runAction({ kind: 'reset' }, "Salon réinitialisé avec succès");
                  setShowResetConfirm(false);
                }}
              >
                Réinitialiser
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
