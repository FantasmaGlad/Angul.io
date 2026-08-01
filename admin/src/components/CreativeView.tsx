import { useEffect, useRef, useState } from 'react';
import type { AdminRoomAction, EntitySnapshot } from '@angulio/shared';
import { SKIN_IMAGE_MAP } from '@angulio/shared';
import {
  broadcastMessage,
  kickPlayer,
  listRooms,
  runRoomAction,
  type AdminRoomView,
} from '../adminApi.js';
import { connectAdminSocket, generateGodPlayerId, type AdminSocketHandle } from '../adminSocket.js';
import { AdminSnapshotBuffer, pieceAtScreenPoint, screenToWorld, type Camera } from '../entityCanvas.js';
import { PixiEntityRenderer } from '../pixiEntityRenderer.js';
import ConnectionStatusDot, { type ConnectionStatus } from './ConnectionStatus.js';

interface CreativeViewProps {
  token: string;
  onAuthError: (message: string) => void;
  initialRoomId?: string;
}

const KEY_PAN_SPEED = 800; // px monde/s, x3 avec Shift
const GOD_INPUT_INTERVAL_MS = 80;

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
}

/** Onglet "Espace Créatif" — Studio de Contrôle & Commandement :
 * vue Canvas haute fidélité 60 FPS avec interpolation de snapshots, fond grille Onyx,
 * manipulation physique des joueurs et mode Blob Dieu. */
export default function CreativeView({ token, onAuthError, initialRoomId }: CreativeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [toastMsg, setToastMsg] = useState<{ text: string; type: 'info' | 'error' | 'success' } | null>(null);

  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [godActive, setGodActive] = useState(false);
  const [spawnMode, setSpawnMode] = useState<'none' | 'food' | 'bot' | 'teleport'>('none');
  const [searchFilter, setSearchFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'human' | 'bot'>('all');

  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastColor, setBroadcastColor] = useState('#ffffff');
  const [broadcastGlobal, setBroadcastGlobal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [livePlayerList, setLivePlayerList] = useState<PlayerInspectInfo[]>([]);
  /** Indicateur de connexion (§10.3 cahier_des_charges_admin.md) — jusqu'ici, une déconnexion
   * n'était visible que via le toast d'erreur (`onClose`), qui disparaît après 3s ; ce point
   * reste affiché tant que la connexion n'est pas rétablie. */
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');
  /** Cadence RÉELLEMENT annoncée par `welcome` (§10.1/§17 : "la cadence affichée doit toujours
   * être la cadence réellement reçue, jamais une valeur théorique") — remplace le badge "Live
   * 20Hz" qui était codé en dur (juste par-coïncidence exact avant ce correctif, aurait
   * silencieusement menti dès que `TICK_RATE_HZ`/`ADMIN_TICK_DIVISOR` changerait côté serveur). */
  const [liveTickRateHz, setLiveTickRateHz] = useState<number | undefined>(undefined);

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
  });
  useEffect(() => {
    liveRef.current.spawnMode = spawnMode;
  }, [spawnMode]);
  useEffect(() => {
    liveRef.current.selectedPlayerId = selectedPlayerId;
    liveRef.current.followId = selectedPlayerId;
  }, [selectedPlayerId]);

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
        onAuthError(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialRoomId]);

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

  const rendererRef = useRef<PixiEntityRenderer | null>(null);

  // --- Moteur de rendu GPU (§10.2 cahier_des_charges_admin.md) : un seul par MONTAGE du
  // composant, jamais recréé quand on change de salon (`roomId`) ou d'outil (effet suivant) ---
  // Recréer une `Application` PixiJS (donc un contexte WebGL) à chaque changement de salon s'est
  // avéré non viable en pratique : reproduit en test, deux `Application` PixiJS se disputant
  // brièvement le même contexte WebGL du même `<canvas>` (l'ancienne pas encore détruite, la
  // nouvelle déjà en train de s'initialiser) a figé l'onglet ENTIER (plus aucun JS exécutable,
  // y compris hors React) pendant plusieurs minutes — bien au-delà d'un simple ralentissement.
  // Le canva/contexte GPU est désormais lié au CYCLE DE VIE DU COMPOSANT (monté une fois tant que
  // "Espace Créatif" reste affiché), seule la connexion WebSocket change de salon en salon (effet
  // suivant, déps `[roomId, token]`) — un salon differe par ses DONNÉES, pas par son moteur de
  // rendu.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new PixiEntityRenderer(canvas);
    rendererRef.current = renderer;

    function resize(): void {
      canvas!.width = canvas!.clientWidth;
      canvas!.height = canvas!.clientHeight;
      renderer.resize(canvas!.width, canvas!.height);
    }
    resize();
    window.addEventListener('resize', resize);

    return () => {
      window.removeEventListener('resize', resize);
      renderer.destroy();
      rendererRef.current = null;
    };
  }, []);

  // --- Boucle Canvas : connexion, rendu 60 FPS, contrôles ---------------------------------
  useEffect(() => {
    if (!roomId) return;
    const canvas = canvasRef.current;
    const rendererInstance = rendererRef.current;
    if (!canvas || !rendererInstance) return;
    const renderer = rendererInstance;

    const nicknames = new Map<string, string>();
    const skinsMap = new Map<string, string>();
    const snapshotBuffer = new AdminSnapshotBuffer();

    const camera: Camera = { x: 0, y: 0, scale: 0.25 };
    const pressedKeys = new Set<string>();
    let isPanning = false;
    let lastPanScreen = { x: 0, y: 0 };
    let lastMouseWorld = { x: 0, y: 0 };

    let lastPlayerListUpdateAt = 0;
    const handle = connectAdminSocket(token, roomId, {
      onState: (received) => {
        snapshotBuffer.pushSnapshot(received);

        const now = performance.now();
        if (now - lastPlayerListUpdateAt > 200) {
          lastPlayerListUpdateAt = now;
          const playerMap = new Map<string, { mass: number; isFrozen: boolean }>();
          for (const e of received) {
            if (!e.p) continue;
            const existing = playerMap.get(e.p);
            playerMap.set(e.p, {
              mass: (existing?.mass || 0) + e.m,
              isFrozen: false,
            });
          }
          const list: PlayerInspectInfo[] = Array.from(playerMap.entries()).map(([pId, info]) => ({
            playerId: pId,
            nickname: nicknames.get(pId) || (pId.startsWith('bot-') ? pId : `Joueur #${pId.slice(0, 6)}`),
            skin: skinsMap.get(pId),
            mass: info.mass,
            isBot: pId.startsWith('bot-'),
            isFrozen: info.isFrozen,
          }));
          list.sort((a, b) => b.mass - a.mass);
          setLivePlayerList(list);
        }
      },
      onPlayerInfo: (id, nick, skin) => {
        nicknames.set(id, nick);
        if (skin) skinsMap.set(id, skin);
      },
      onWelcome: (tickRateHz) => {
        snapshotBuffer.setServerTickRateHz(tickRateHz);
        setLiveTickRateHz(tickRateHz);
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

    function onKeyDown(event: KeyboardEvent): void {
      pressedKeys.add(event.key.toLowerCase());
    }
    function onKeyUp(event: KeyboardEvent): void {
      pressedKeys.delete(event.key.toLowerCase());
    }
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);

    function onWheel(event: WheelEvent): void {
      event.preventDefault();
      const factor = event.deltaY > 0 ? 0.88 : 1.14;
      camera.scale = Math.min(3, Math.max(0.02, camera.scale * factor));
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onMouseDown(event: MouseEvent): void {
      if (event.button === 2) return;
      const godId = godPlayerIdRef.current;
      if (godId) return;

      const currentEntities = snapshotBuffer.getInterpolatedEntities();
      const clicked = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p) {
        liveRef.current.followId = clicked.p;
        setSelectedPlayerId(clicked.p);
        return;
      }

      if (liveRef.current.spawnMode === 'food') {
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        runAction({ kind: 'spawnFood', x: world.x, y: world.y, mass: 10 }, "Pastille générée");
        return;
      }

      if (liveRef.current.spawnMode === 'bot') {
        runAction({ kind: 'spawnBot' }, "Bot créé");
        return;
      }

      if (liveRef.current.spawnMode === 'teleport' && liveRef.current.selectedPlayerId) {
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        runAction({
          kind: 'godInput',
          playerId: liveRef.current.selectedPlayerId,
          x: world.x,
          y: world.y,
          intensity: 1,
          split: false,
        }, `Joueur téléporté`);
        setSpawnMode('none');
        return;
      }

      liveRef.current.followId = undefined;
      isPanning = true;
      lastPanScreen = { x: event.clientX, y: event.clientY };
    }

    function onMouseMove(event: MouseEvent): void {
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
    function onMouseUp(): void {
      isPanning = false;
    }
    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const currentEntities = snapshotBuffer.getInterpolatedEntities();
      const clicked = pieceAtScreenPoint(currentEntities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p && !clicked.p.startsWith('admin-god-')) {
        setSelectedPlayerId(clicked.p);
        setContextMenu({ screenX: event.clientX, screenY: event.clientY, playerId: clicked.p });
      }
    }

    canvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    canvas.addEventListener('contextmenu', onContextMenu);

    let lastFrameAt = performance.now();
    let godInputAccumMs = 0;
    let raf = 0;

    // Boucle de rendu 60 FPS ultra-fluide avec interpolation
    function frame(): void {
      const now = performance.now();
      const dtMs = now - lastFrameAt;
      lastFrameAt = now;

      const currentEntities = snapshotBuffer.getInterpolatedEntities();

      const godId = godPlayerIdRef.current;
      if (godId) {
        const godCenter = centerOf(godId, currentEntities);
        if (godCenter) {
          camera.x = godCenter.x;
          camera.y = godCenter.y;
        }
        godInputAccumMs += dtMs;
        if (godInputAccumMs >= GOD_INPUT_INTERVAL_MS) {
          godInputAccumMs = 0;
          runAction({
            kind: 'godInput',
            playerId: godId,
            x: lastMouseWorld.x,
            y: lastMouseWorld.y,
            intensity: 1,
            split: false,
          });
        }
      } else if (liveRef.current.followId) {
        const center = centerOf(liveRef.current.followId, currentEntities);
        if (center) {
          camera.x = center.x;
          camera.y = center.y;
        }
      } else {
        const speed = (pressedKeys.has('shift') ? 3 : 1) * KEY_PAN_SPEED * (dtMs / 1000);
        if (pressedKeys.has('q') || pressedKeys.has('arrowleft')) camera.x -= speed;
        if (pressedKeys.has('d') || pressedKeys.has('arrowright')) camera.x += speed;
        if (pressedKeys.has('z') || pressedKeys.has('arrowup')) camera.y -= speed;
        if (pressedKeys.has('s') || pressedKeys.has('arrowdown')) camera.y += speed;
      }

      renderer.render(currentEntities, camera, nicknames, skinsMap, liveRef.current.selectedPlayerId);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      canvas.removeEventListener('wheel', onWheel);
      canvas.removeEventListener('mousedown', onMouseDown);
      canvas.removeEventListener('contextmenu', onContextMenu);
      handle.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token]);

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
    if (!broadcastText.trim()) return;
    void broadcastMessage(token, broadcastText.trim(), {
      color: broadcastColor,
      durationMs: 5000,
      roomId: broadcastGlobal ? undefined : roomId,
    })
      .then((result) => showToast(`Annonce envoyée à ${result.sent} joueur(s).`, 'success'))
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
  };

  const contextAction = (kind: 'kill' | 'freeze' | 'unfreeze' | 'split' | 'remerge'): void => {
    if (!contextMenu) return;
    runAction({ kind, playerId: contextMenu.playerId }, `Action ${kind} exécutée`);
    setContextMenu(null);
  };

  const handleKickPlayer = (pId: string, nick: string) => {
    void kickPlayer(token, roomId, pId)
      .then(() => showToast(`Joueur ${nick} expulsé avec succès`, 'success'))
      .catch((err: unknown) => showToast((err as Error).message, 'error'));
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
        <div>
          <h2>Espace Créatif &amp; Studio de Contrôle</h2>
          <p className="view-subtitle">
            Surveillance en direct, manipulation physique des joueurs et gestion d'arène.
          </p>
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

      {/* Main Control Toolbar */}
      <div className="creative-toolbar" style={{ flexShrink: 0 }}>
        <button
          className={spawnMode === 'food' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => setSpawnMode(spawnMode === 'food' ? 'none' : 'food')}
          title="Cliquez sur la carte pour poser une pastille"
        >
          <span className="material-symbols-outlined" aria-hidden="true">grain</span> Spawn nourriture
        </button>
        <button
          className={spawnMode === 'bot' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => runAction({ kind: 'spawnBot' }, "Bot ajouté")}
        >
          <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span> Spawn bot
        </button>
        {selectedPlayerId && (
          <button
            className={spawnMode === 'teleport' ? 'btn-primary' : 'btn-ghost'}
            type="button"
            onClick={() => setSpawnMode(spawnMode === 'teleport' ? 'none' : 'teleport')}
            title="Cliquez sur la carte pour téléporter le joueur sélectionné"
          >
            <span className="material-symbols-outlined" aria-hidden="true">near_me</span> Téléporter à l'emplacement
          </button>
        )}
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearFood' }, "Pastilles nettoyées")}>
          <span className="material-symbols-outlined" aria-hidden="true">cleaning_services</span> Vider pastilles
        </button>
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearBots' }, "Bots retirés")}>
          <span className="material-symbols-outlined" aria-hidden="true">no_accounts</span> Supprimer bots
        </button>
        <button
          className="btn-ghost"
          style={{ color: 'var(--danger)', borderColor: 'var(--danger)' }}
          type="button"
          onClick={() => setShowResetConfirm(true)}
        >
          <span className="material-symbols-outlined" aria-hidden="true">restart_alt</span> Reset salon
        </button>
        <select
          onChange={(event) => {
            if (event.target.value) runAction({ kind: 'switchMod', modId: event.target.value }, `Mode changé pour ${event.target.value}`);
            event.target.value = '';
          }}
          defaultValue=""
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 'var(--radius-pill)', padding: '8px 12px' }}
        >
          <option value="" disabled>Changer de mode…</option>
          <option value="vanilla">Vanilla</option>
          <option value="hardcore">Hardcore</option>
        </select>
        <button className={godActive ? 'btn-primary' : 'btn-ghost'} type="button" onClick={toggleGodmode}>
          <span className="material-symbols-outlined" aria-hidden="true">workspace_premium</span> Blob Dieu {godActive ? '(actif)' : ''}
        </button>
        {godActive && (
          <button className="btn-ghost" type="button" onClick={boostGodMass}>
            <span className="material-symbols-outlined" aria-hidden="true">bolt</span> +10 000 masse
          </button>
        )}
      </div>

      {/* Broadcast Bar */}
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
        <button className="btn-primary" type="button" onClick={sendBroadcast}>
          <span className="material-symbols-outlined" aria-hidden="true">campaign</span> Diffuser
        </button>
      </div>

      {/* Main Studio Body (Split view Canvas + Live Inspector) */}
      <div style={{ flex: 1, minHeight: 0, display: 'flex', gap: 16 }}>
        {/* Canvas Wrap */}
        <div className="creative-canvas-wrap" style={{ flex: 1, height: '100%', position: 'relative', margin: 0 }}>
          <canvas ref={canvasRef} className="creative-canvas" />
        </div>

        {/* Live Room Inspector Panel */}
        <div
          className="panel"
          style={{
            width: 340,
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
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-soft)' }}>
              Inspecteur Joueurs ({filteredPlayers.length})
            </span>
            <span className="badge" style={{ fontSize: 10 }}>
              {liveTickRateHz !== undefined ? `Live ${liveTickRateHz}Hz` : 'Live —'}
            </span>
          </div>

          {/* Search & Type Filter Header */}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {filteredPlayers.map((p) => {
                const isSelected = selectedPlayerId === p.playerId;
                const skinImgUrl = p.skin ? SKIN_IMAGE_MAP[p.skin] : undefined;

                return (
                  <div
                    key={p.playerId}
                    style={{
                      background: isSelected ? 'var(--surface-hover)' : 'var(--bg)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '10px 12px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 8,
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        {skinImgUrl ? (
                          <img src={skinImgUrl} alt={p.skin} style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'contain' }} />
                        ) : (
                          <div style={{ width: 28, height: 28, borderRadius: '50%', background: p.isBot ? '#93c5fd' : '#f59e0b' }} />
                        )}
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                            {p.nickname}
                            {p.isBot ? (
                              <span className="badge" style={{ fontSize: 9, padding: '1px 5px', background: '#dbeafe', color: '#1e40af' }}>BOT</span>
                            ) : (
                              <span className="badge" style={{ fontSize: 9, padding: '1px 5px', background: '#fef3c7', color: '#92400e' }}>JOUEUR</span>
                            )}
                            {p.isFrozen && (
                              <span className="badge" style={{ fontSize: 9, padding: '1px 5px', background: '#e0f2fe', color: '#0369a1' }}>GELÉ</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                        {Math.round(p.mass)} m
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 4, flexWrap: 'nowrap', overflowX: 'auto', paddingBottom: 2 }}>
                      <button
                        className="btn-ghost"
                        type="button"
                        style={{ padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        onClick={() => setSelectedPlayerId(isSelected ? undefined : p.playerId)}
                        title="Centrer la caméra sur ce joueur"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>visibility</span>
                        {isSelected ? 'Détacher' : 'Suivre'}
                      </button>

                      <button
                        className="btn-ghost"
                        type="button"
                        style={{ padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        onClick={() => runAction({ kind: p.isFrozen ? 'unfreeze' : 'freeze', playerId: p.playerId }, p.isFrozen ? 'Joueur dégelé' : 'Joueur gelé')}
                        title={p.isFrozen ? 'Dégeler' : 'Geler'}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>ac_unit</span>
                        {p.isFrozen ? 'Dégeler' : 'Geler'}
                      </button>

                      <button
                        className="btn-ghost"
                        type="button"
                        style={{ padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        onClick={() => runAction({ kind: 'setMass', playerId: p.playerId, mass: p.mass + 500 }, "+500 Masse")}
                        title="Ajouter +500 de masse (Clic droit pour masse perso)"
                        onContextMenu={(e) => {
                          e.preventDefault();
                          const val = window.prompt(`Nouvelle masse pour ${p.nickname} ?`, String(Math.round(p.mass)));
                          if (val && Number.isFinite(Number(val))) runAction({ kind: 'setMass', playerId: p.playerId, mass: Number(val) }, "Masse ajustée");
                        }}
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>add</span>
                        +500m
                      </button>

                      <button
                        className="btn-ghost"
                        type="button"
                        style={{ padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        onClick={() => runAction({ kind: 'split', playerId: p.playerId }, "Split forcé déclenché")}
                        title="Split forcé"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>call_split</span>
                        Split
                      </button>

                      <button
                        className="btn-ghost"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        type="button"
                        onClick={() => runAction({ kind: 'kill', playerId: p.playerId }, "Joueur éliminé")}
                        title="Éliminer le joueur"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>skull</span>
                        Kill
                      </button>

                      <button
                        className="btn-ghost"
                        style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '3px 7px', fontSize: 11, borderRadius: 'var(--radius-md)', whiteSpace: 'nowrap' }}
                        type="button"
                        onClick={() => handleKickPlayer(p.playerId, p.nickname)}
                        title="Expulser du salon"
                      >
                        <span className="material-symbols-outlined" style={{ fontSize: 13 }}>logout</span>
                        Kick
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
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
