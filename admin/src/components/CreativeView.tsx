import { useEffect, useRef, useState } from 'react';
import type { AdminRoomAction, EntitySnapshot } from '@angulio/shared';
import { broadcastMessage, listRooms, type AdminRoomView } from '../adminApi.js';
import { connectAdminSocket, generateGodPlayerId, type AdminSocketHandle } from '../adminSocket.js';
import { drawEntities, pieceAtScreenPoint, screenToWorld, type Camera } from '../entityCanvas.js';

interface CreativeViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

const KEY_PAN_SPEED = 800; // px monde/s, x3 avec Shift (§4.1)
const GOD_INPUT_INTERVAL_MS = 80;

interface ContextMenuState {
  screenX: number;
  screenY: number;
  playerId: string;
}

/** Onglet "Espace Créatif" (§4 cahier_des_charges_admin.md) — vue Canvas haut débit : navigation
 * libre, actions directes sur les joueurs, spawn/nettoyage, gestion du salon à chaud, mode Blob
 * Dieu, diffusion de messages. */
export default function CreativeView({ token, onAuthError }: CreativeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [roomId, setRoomId] = useState('');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [godActive, setGodActive] = useState(false);
  const [spawnMode, setSpawnMode] = useState<'none' | 'food' | 'bot'>('none');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastColor, setBroadcastColor] = useState('#ffffff');
  const [broadcastGlobal, setBroadcastGlobal] = useState(false);

  const socketRef = useRef<AdminSocketHandle | null>(null);
  const godPlayerIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    void (async () => {
      try {
        const list = await listRooms(token);
        setRooms(list);
        if (!roomId && list.length > 0) setRoomId(list[0]!.id);
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        onAuthError(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const runAction = (action: AdminRoomAction): void => {
    void socketRef.current?.sendAction(action).then((result) => {
      if (!result.ok) setError("Action refusée par le serveur.");
      else setError('');
    });
  };

  // --- Boucle Canvas : connexion, rendu, contrôles (§4.1-4.3) ---------------------------------
  useEffect(() => {
    if (!roomId) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    function resize(): void {
      canvas!.width = canvas!.clientWidth;
      canvas!.height = canvas!.clientHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    const nicknames = new Map<string, string>();
    const colors = new Map<string, string>();
    let entities: EntitySnapshot[] = [];
    const camera: Camera = { x: 0, y: 0, scale: 0.15 };
    let followId: string | undefined = selectedPlayerId;
    const pressedKeys = new Set<string>();
    let isPanning = false;
    let lastPanScreen = { x: 0, y: 0 };
    let lastMouseWorld = { x: 0, y: 0 };

    const handle = connectAdminSocket(token, roomId, {
      onState: (received) => {
        entities = received;
      },
      onPlayerInfo: (id, nick) => nicknames.set(id, nick),
      onClose: (reason) => setError(reason),
    });
    socketRef.current = handle;

    function centerOf(playerId: string): { x: number; y: number } | undefined {
      const pieces = entities.filter((e) => e.p === playerId);
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
      const factor = event.deltaY > 0 ? 0.9 : 1.1;
      camera.scale = Math.min(3, Math.max(0.01, camera.scale * factor));
    }
    canvas.addEventListener('wheel', onWheel, { passive: false });

    function onMouseDown(event: MouseEvent): void {
      if (event.button === 2) return; // clic droit : voir contextmenu ci-dessous
      const godId = godPlayerIdRef.current;
      if (godId) return; // en mode Dieu, la souris pilote le blob, pas la caméra
      const clicked = pieceAtScreenPoint(entities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p) {
        followId = clicked.p;
        setSelectedPlayerId(clicked.p);
        return;
      }
      if (spawnMode !== 'none') {
        const world = screenToWorld(camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
        if (spawnMode === 'food') {
          runAction({ kind: 'spawnFood', x: world.x, y: world.y, mass: 5 });
        } else {
          runAction({ kind: 'spawnBot' });
        }
        return;
      }
      followId = undefined;
      setSelectedPlayerId(undefined);
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
        followId = undefined;
      }
    }
    function onMouseUp(): void {
      isPanning = false;
    }
    function onContextMenu(event: MouseEvent): void {
      event.preventDefault();
      const clicked = pieceAtScreenPoint(entities, camera, canvas!.width, canvas!.height, event.offsetX, event.offsetY);
      if (clicked?.p && !clicked.p.startsWith('admin-god-')) {
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
    function frame(): void {
      const now = performance.now();
      const dtMs = now - lastFrameAt;
      lastFrameAt = now;

      const godId = godPlayerIdRef.current;
      if (godId) {
        const godCenter = centerOf(godId);
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
      } else if (followId) {
        const center = centerOf(followId);
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

      drawEntities(ctx!, entities, camera, nicknames, colors, selectedPlayerId);
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
      canvas.removeEventListener('contextmenu', onContextMenu);
      handle.close();
      socketRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [roomId, token, spawnMode]);

  const toggleGodmode = (): void => {
    if (godActive) {
      const id = godPlayerIdRef.current;
      if (id) runAction({ kind: 'disableGodmode', playerId: id });
      godPlayerIdRef.current = undefined;
      setGodActive(false);
    } else {
      const id = generateGodPlayerId();
      godPlayerIdRef.current = id;
      runAction({ kind: 'enableGodmode', playerId: id, nickname: 'Fantadmin (Dieu)' });
      setGodActive(true);
    }
  };

  const boostGodMass = (): void => {
    const id = godPlayerIdRef.current;
    if (!id) return;
    runAction({ kind: 'setMass', playerId: id, mass: 10_000 });
  };

  const sendBroadcast = (): void => {
    if (!broadcastText.trim()) return;
    void broadcastMessage(token, broadcastText.trim(), {
      color: broadcastColor,
      durationMs: 5000,
      roomId: broadcastGlobal ? undefined : roomId,
    })
      .then((result) => setStatus(`Annonce envoyée à ${result.sent} joueur(s).`))
      .catch((err: unknown) => setError((err as Error).message));
  };

  const contextAction = (kind: 'kill' | 'freeze' | 'unfreeze' | 'split' | 'remerge'): void => {
    if (!contextMenu) return;
    runAction({ kind, playerId: contextMenu.playerId });
    setContextMenu(null);
  };

  const contextSetMass = (): void => {
    if (!contextMenu) return;
    const value = window.prompt('Nouvelle masse totale ?', '1000');
    if (value && Number.isFinite(Number(value))) {
      runAction({ kind: 'setMass', playerId: contextMenu.playerId, mass: Number(value) });
    }
    setContextMenu(null);
  };

  return (
    <div className="view view-wide creative-view">
      <div className="top-bar">
        <div>
          <h2>Espace Créatif</h2>
          <p className="view-subtitle">
            Survol invisible du salon, actions directes, spawn, Blob Dieu (§4).
          </p>
        </div>
        <select value={roomId} onChange={(event) => setRoomId(event.target.value)}>
          {rooms.map((room) => (
            <option key={room.id} value={room.id}>
              {room.name} ({room.modId})
            </option>
          ))}
        </select>
      </div>

      <p className="error-text">{error}</p>
      <p className="status-text">{status}</p>

      <div className="creative-toolbar">
        <button
          className={spawnMode === 'food' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => setSpawnMode(spawnMode === 'food' ? 'none' : 'food')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            grain
          </span>{' '}
          Spawn nourriture
        </button>
        <button
          className={spawnMode === 'bot' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => setSpawnMode(spawnMode === 'bot' ? 'none' : 'bot')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">
            smart_toy
          </span>{' '}
          Spawn bot
        </button>
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearFood' })}>
          Vider les pastilles
        </button>
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearBots' })}>
          Supprimer les bots
        </button>
        <button
          className="btn-ghost btn-danger"
          type="button"
          onClick={() => runAction({ kind: 'reset' })}
        >
          Reset salon
        </button>
        <select
          onChange={(event) => {
            if (event.target.value) runAction({ kind: 'switchMod', modId: event.target.value });
            event.target.value = '';
          }}
          defaultValue=""
        >
          <option value="" disabled>
            Changer de mode…
          </option>
          <option value="vanilla">Vanilla</option>
          <option value="hardcore">Hardcore</option>
        </select>
        <button className={godActive ? 'btn-primary' : 'btn-ghost'} type="button" onClick={toggleGodmode}>
          <span className="material-symbols-outlined" aria-hidden="true">
            workspace_premium
          </span>{' '}
          Blob Dieu {godActive ? '(actif)' : ''}
        </button>
        {godActive && (
          <button className="btn-ghost" type="button" onClick={boostGodMass}>
            <span className="material-symbols-outlined" aria-hidden="true">
              bolt
            </span>{' '}
            +10 000 masse
          </button>
        )}
      </div>

      <div className="creative-broadcast">
        <input
          value={broadcastText}
          onChange={(event) => setBroadcastText(event.target.value)}
          placeholder="Message à diffuser…"
          maxLength={200}
        />
        <input
          type="color"
          value={broadcastColor}
          onChange={(event) => setBroadcastColor(event.target.value)}
        />
        <label className="filter-checkbox">
          <input
            type="checkbox"
            checked={broadcastGlobal}
            onChange={(event) => setBroadcastGlobal(event.target.checked)}
          />
          Global
        </label>
        <button className="btn-primary" type="button" onClick={sendBroadcast}>
          Diffuser
        </button>
      </div>

      <div className="creative-canvas-wrap">
        <canvas ref={canvasRef} className="creative-canvas" />
      </div>

      {contextMenu && (
        <>
          <div className="context-menu-backdrop" onClick={() => setContextMenu(null)} />
          <div
            className="context-menu"
            style={{ left: contextMenu.screenX, top: contextMenu.screenY }}
          >
            <button type="button" onClick={() => contextAction('kill')}>
              Kill
            </button>
            <button type="button" onClick={() => contextAction('freeze')}>
              Geler
            </button>
            <button type="button" onClick={() => contextAction('unfreeze')}>
              Dégeler
            </button>
            <button type="button" onClick={contextSetMass}>
              Modifier la masse…
            </button>
            <button type="button" onClick={() => contextAction('split')}>
              Split forcé
            </button>
            <button type="button" onClick={() => contextAction('remerge')}>
              Refusion forcée
            </button>
          </div>
        </>
      )}
    </div>
  );
}
