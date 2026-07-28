import { useEffect, useRef, useState } from 'react';
import type { AdminRoomAction, EntitySnapshot } from '@angulio/shared';
import { broadcastMessage, listRooms, type AdminRoomView } from '../adminApi.js';
import { connectAdminSocket, generateGodPlayerId, type AdminSocketHandle } from '../adminSocket.js';
import { drawEntities, pieceAtScreenPoint, screenToWorld, type Camera } from '../entityCanvas.js';

interface CreativeViewProps {
  token: string;
  onAuthError: (message: string) => void;
  initialRoomId?: string;
}

const KEY_PAN_SPEED = 800; // px monde/s, x3 avec Shift (§4.1)
const GOD_INPUT_INTERVAL_MS = 80;

interface ContextMenuState {
  screenX: number;
  screenY: number;
  playerId: string;
}

interface PlayerInspectInfo {
  playerId: string;
  nickname: string;
  mass: number;
  isBot: boolean;
  isFrozen: boolean;
}

/** Onglet "Espace Créatif" (§4 cahier_des_charges_admin.md) — Studio de Contrôle & Commandement :
 * vue Canvas haut débit, panneau latéral d'inspection en direct, manipulation physique des joueurs,
 * mode Blob Dieu, diffusion de messages. */
export default function CreativeView({ token, onAuthError, initialRoomId }: CreativeViewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [roomId, setRoomId] = useState(initialRoomId || '');
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | undefined>(undefined);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [godActive, setGodActive] = useState(false);
  const [spawnMode, setSpawnMode] = useState<'none' | 'food' | 'bot'>('none');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastColor, setBroadcastColor] = useState('#ffffff');
  const [broadcastGlobal, setBroadcastGlobal] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [livePlayerList, setLivePlayerList] = useState<PlayerInspectInfo[]>([]);

  const socketRef = useRef<AdminSocketHandle | null>(null);
  const godPlayerIdRef = useRef<string | undefined>(undefined);

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
        setError(message);
        onAuthError(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, initialRoomId]);

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

    let lastPlayerListUpdateAt = 0;
    const handle = connectAdminSocket(token, roomId, {
      onState: (received) => {
        entities = received;
        const now = performance.now();
        if (now - lastPlayerListUpdateAt > 250) {
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
            mass: info.mass,
            isBot: pId.startsWith('bot-'),
            isFrozen: info.isFrozen,
          }));
          list.sort((a, b) => b.mass - a.mass);
          setLivePlayerList(list);
        }
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

  const activeRoom = rooms.find((r) => r.id === roomId);

  return (
    <div className="view view-wide creative-view" style={{ maxWidth: '100%', height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="top-bar" style={{ flexShrink: 0 }}>
        <div>
          <h2>Espace Créatif &amp; Studio de Contrôle</h2>
          <p className="view-subtitle">
            Surveillance en direct, manipulation physique des joueurs et gestion d'arène.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {activeRoom && (
            <span className="badge" style={{ padding: '6px 12px', borderRadius: 'var(--radius-pill)', background: 'var(--surface-hover)' }}>
              {activeRoom.name} · {activeRoom.stats.playerCount}/{activeRoom.maxPlayers} joueurs
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

      {error && <p className="error-text" style={{ flexShrink: 0, margin: 0 }}>{error}</p>}
      {status && <p className="status-text" style={{ flexShrink: 0, margin: 0 }}>{status}</p>}

      <div className="creative-toolbar" style={{ flexShrink: 0 }}>
        <button
          className={spawnMode === 'food' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => setSpawnMode(spawnMode === 'food' ? 'none' : 'food')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">grain</span> Spawn nourriture
        </button>
        <button
          className={spawnMode === 'bot' ? 'btn-primary' : 'btn-ghost'}
          type="button"
          onClick={() => setSpawnMode(spawnMode === 'bot' ? 'none' : 'bot')}
        >
          <span className="material-symbols-outlined" aria-hidden="true">smart_toy</span> Spawn bot
        </button>
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearFood' })}>
          <span className="material-symbols-outlined" aria-hidden="true">cleaning_services</span> Vider pastilles
        </button>
        <button className="btn-ghost" type="button" onClick={() => runAction({ kind: 'clearBots' })}>
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
            if (event.target.value) runAction({ kind: 'switchMod', modId: event.target.value });
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

      <div className="creative-broadcast" style={{ flexShrink: 0 }}>
        <input
          value={broadcastText}
          onChange={(event) => setBroadcastText(event.target.value)}
          placeholder="Message à diffuser aux joueurs…"
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
            width: 310,
            flexShrink: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: 10,
            overflowY: 'auto',
            height: '100%',
            padding: 16,
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: 'var(--text-soft)' }}>
              Joueurs ({livePlayerList.length})
            </span>
            <span className="badge" style={{ fontSize: 10 }}>Live 20Hz</span>
          </div>

          {livePlayerList.length === 0 ? (
            <p className="view-subtitle" style={{ fontStyle: 'italic', marginTop: 10 }}>
              Aucun joueur actif dans ce salon. Spawnez des bots ou de la nourriture !
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {livePlayerList.map((p) => (
                <div
                  key={p.playerId}
                  style={{
                    background: selectedPlayerId === p.playerId ? 'var(--surface-hover)' : 'var(--bg)',
                    border: `1px solid ${selectedPlayerId === p.playerId ? 'var(--accent)' : 'var(--border)'}`,
                    borderRadius: 'var(--radius-md)',
                    padding: '10px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <span style={{ fontWeight: 700, fontSize: 13, display: 'flex', alignItems: 'center', gap: 4 }}>
                      {p.nickname}
                      {p.isBot && <span className="badge" style={{ fontSize: 9, padding: '2px 5px' }}>Bot</span>}
                      {p.isFrozen && <span className="badge" style={{ fontSize: 9, padding: '2px 5px', background: '#e0f2fe', color: '#0369a1' }}>Gelé</span>}
                    </span>
                    <span style={{ fontSize: 12, fontFamily: 'var(--font-mono)', fontWeight: 700, color: 'var(--accent)' }}>
                      {Math.round(p.mass)} m
                    </span>
                  </div>

                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', marginTop: 4 }}>
                    <button
                      className="btn-ghost"
                      type="button"
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-md)' }}
                      onClick={() => setSelectedPlayerId(selectedPlayerId === p.playerId ? undefined : p.playerId)}
                      title="Centrer la caméra sur ce joueur"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>visibility</span>
                      {selectedPlayerId === p.playerId ? 'Détacher' : 'Suivre'}
                    </button>
                    <button
                      className="btn-ghost"
                      type="button"
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-md)' }}
                      onClick={() => runAction({ kind: p.isFrozen ? 'unfreeze' : 'freeze', playerId: p.playerId })}
                      title={p.isFrozen ? 'Dégeler' : 'Geler'}
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>ac_unit</span>
                      {p.isFrozen ? 'Dégeler' : 'Geler'}
                    </button>
                    <button
                      className="btn-ghost"
                      type="button"
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-md)' }}
                      onClick={() => {
                        const val = window.prompt(`Nouvelle masse pour ${p.nickname} ?`, String(Math.round(p.mass)));
                        if (val && Number.isFinite(Number(val))) runAction({ kind: 'setMass', playerId: p.playerId, mass: Number(val) });
                      }}
                      title="Modifier la masse"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>fitness_center</span>
                      Masse
                    </button>
                    <button
                      className="btn-ghost"
                      type="button"
                      style={{ padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-md)' }}
                      onClick={() => runAction({ kind: 'split', playerId: p.playerId })}
                      title="Split forcé"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>call_split</span>
                      Split
                    </button>
                    <button
                      className="btn-ghost"
                      style={{ color: 'var(--danger)', borderColor: 'var(--danger)', padding: '4px 8px', fontSize: 11, borderRadius: 'var(--radius-md)' }}
                      type="button"
                      onClick={() => runAction({ kind: 'kill', playerId: p.playerId })}
                      title="Éliminer le joueur"
                    >
                      <span className="material-symbols-outlined" style={{ fontSize: 14 }}>skull</span>
                      Kill
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
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
                  runAction({ kind: 'reset' });
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
