import { useEffect, useRef, useState } from 'react';
import { kickPlayer, listRooms, transferPlayer, type AdminRoomView } from '../adminApi.js';
import { connectAdminSocket, type AdminSocketHandle } from '../adminSocket.js';
import { AdminSnapshotBuffer, type Camera } from '../entityCanvas.js';
import { PixiEntityRenderer } from '../pixiEntityRenderer.js';
import ConnectionStatusDot, { type ConnectionStatus } from './ConnectionStatus.js';

interface RoomsViewProps {
  token: string;
  onAuthError: (message: string) => void;
  onSelectCreativeRoom?: (roomId: string) => void;
}

const REFRESH_INTERVAL_MS = 3000;
const POV_ZOOM = 0.6;
/** Salon signalé (badge rouge, §8.2) au-delà de ce seuil — double le budget confortable d'un
 * tick 20Hz (50ms/tick). */
const TICK_WARNING_MS = 100;

/** Onglet "Salons & Écrans" (§3.3 cahier_des_charges_admin.md) — supervision des salons/joueurs
 * en ligne, expulsion, transfert, mode Suivi "POV". */
export default function RoomsView({ token, onAuthError, onSelectCreativeRoom }: RoomsViewProps) {
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pov, setPov] = useState<{ roomId: string; playerId: string; nickname: string } | null>(
    null,
  );
  const [transferTarget, setTransferTarget] = useState<{
    roomId: string;
    playerId: string;
    nickname: string;
  } | null>(null);
  const [selectedTargetRoomId, setSelectedTargetRoomId] = useState('');
  /** Filtres/tri du carrousel (§8.2). */
  const [modeFilter, setModeFilter] = useState('all');
  const [sortMode, setSortMode] = useState<'none' | 'occupancy-desc' | 'occupancy-asc'>('none');
  /** Modale motif (§8.3 : "Kick doit désormais ouvrir la même modale motif ... que §7.2") — le
   * champ "durée" de §7.2 s'applique au bannissement (compte, avec expiration en base), pas au
   * kick (juste une fermeture de socket, sans état persistant) : pas de durée ici tant que le
   * bannissement temporaire lui-même n'existe pas côté serveur (§11, Phase 3). Le motif n'est pas
   * encore journalisé (pas de stockage tant que §11.2 n'existe pas) — capturé et affiché dans le
   * statut de confirmation en attendant. */
  const [kickTarget, setKickTarget] = useState<{ roomId: string; playerId: string; nickname: string } | null>(null);
  const [kickReason, setKickReason] = useState('');

  const refresh = (): void => {
    void (async () => {
      try {
        setRooms(await listRooms(token));
        setError('');
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        onAuthError(message);
      }
    })();
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const handleConfirmKick = (): void => {
    if (!kickTarget || !kickReason.trim()) return;
    void (async () => {
      try {
        await kickPlayer(token, kickTarget.roomId, kickTarget.playerId);
        setStatus(`${kickTarget.nickname} expulsé(e) — motif : ${kickReason.trim()}`);
        setKickTarget(null);
        setKickReason('');
        refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  const visibleRooms = rooms
    .filter((room) => modeFilter === 'all' || room.modId === modeFilter)
    .sort((a, b) => {
      if (sortMode === 'occupancy-desc') return b.stats.playerCount - a.stats.playerCount;
      if (sortMode === 'occupancy-asc') return a.stats.playerCount - b.stats.playerCount;
      return 0;
    });
  const availableModes = Array.from(new Set(rooms.map((room) => room.modId))).sort();

  const handleConfirmTransfer = (): void => {
    if (!transferTarget || !selectedTargetRoomId) return;
    void (async () => {
      try {
        await transferPlayer(token, transferTarget.roomId, transferTarget.playerId, selectedTargetRoomId);
        setStatus(`${transferTarget.nickname} transféré(e).`);
        setTransferTarget(null);
        setSelectedTargetRoomId('');
        refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  const carouselRef = useRef<HTMLDivElement>(null);
  const scrollCarousel = (dir: 'left' | 'right') => {
    if (!carouselRef.current) return;
    const amount = dir === 'left' ? -420 : 420;
    carouselRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div className="view view-wide" style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%' }}>
      <div className="top-bar" style={{ flexShrink: 0 }}>
        <div>
          <h2>Salons &amp; Écrans (Vue Carrousel)</h2>
          <p className="view-subtitle">
            Supervision globale en carrousel horizontal — aucun défilement vertical requis.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <button className="swiper-arrow-btn" type="button" onClick={() => scrollCarousel('left')} aria-label="Précédent">
            <span className="material-symbols-outlined">chevron_left</span>
          </button>
          <button className="swiper-arrow-btn" type="button" onClick={() => scrollCarousel('right')} aria-label="Suivant">
            <span className="material-symbols-outlined">chevron_right</span>
          </button>
          <button className="btn-ghost" type="button" onClick={refresh}>
            <span className="material-symbols-outlined" style={{ fontSize: 16, verticalAlign: 'middle', marginRight: 4 }}>refresh</span>
            Rafraîchir
          </button>
        </div>
      </div>

      <div className="filter-row" style={{ marginTop: 0, flexShrink: 0 }}>
        <select value={modeFilter} onChange={(e) => setModeFilter(e.target.value)}>
          <option value="all">Tous les modes</option>
          {availableModes.map((modId) => (
            <option key={modId} value={modId}>
              {modId}
            </option>
          ))}
        </select>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
          <option value="none">Ordre par défaut</option>
          <option value="occupancy-desc">Occupation : plus rempli d'abord</option>
          <option value="occupancy-asc">Occupation : moins rempli d'abord</option>
        </select>
      </div>

      {error && <p className="error-text" style={{ margin: 0, flexShrink: 0 }}>{error}</p>}
      {status && <p className="status-text" style={{ margin: 0, flexShrink: 0 }}>{status}</p>}

      {/* Track de Carrousel Horizontal */}
      <div
        ref={carouselRef}
        className="rooms-carousel-track"
        style={{
          flex: 1,
          display: 'flex',
          gap: 16,
          overflowX: 'auto',
          overflowY: 'hidden',
          paddingBottom: 8,
          scrollSnapType: 'x mandatory',
        }}
      >
        {visibleRooms.map((room) => (
          <section
            className="panel"
            key={room.id}
            style={{
              minWidth: 380,
              maxWidth: 420,
              flexShrink: 0,
              scrollSnapAlign: 'start',
              display: 'flex',
              flexDirection: 'column',
              height: '100%',
              boxSizing: 'border-box',
              padding: 16,
            }}
          >
            <div className="room-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
              <div>
                <h3 style={{ fontSize: 16, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                  {room.stats.tickAvgMs > TICK_WARNING_MS && (
                    <span className="tick-warning-dot" title={`Tick anormalement élevé (${room.stats.tickAvgMs.toFixed(1)}ms)`} />
                  )}
                  {room.name} <span className="badge">{room.modId}</span>
                </h3>
                <p className="view-subtitle" style={{ marginTop: 4 }}>
                  {room.stats.playerCount}/{room.maxPlayers} joueurs · {room.snapshotHz}Hz · avg {room.stats.tickAvgMs.toFixed(1)}ms
                </p>
              </div>
              <div style={{ display: 'flex', gap: 6 }}>
                {onSelectCreativeRoom && (
                  <button
                    className="btn-primary"
                    type="button"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                    onClick={() => onSelectCreativeRoom(room.id)}
                    title="Gérer en direct dans le studio"
                  >
                    Gérer
                  </button>
                )}
                <button
                  className="btn-ghost"
                  type="button"
                  style={{ padding: '6px 10px', fontSize: 12 }}
                  onClick={() => setPov({ roomId: room.id, playerId: '', nickname: `Spectateur Salon : ${room.name}` })}
                  title="Voir l'arène globale"
                >
                  POV
                </button>
              </div>
            </div>

            <div style={{ flex: 1, overflowY: 'auto' }}>
              <table className="data-table" style={{ width: '100%' }}>
                <thead>
                  <tr>
                    <th>Joueur</th>
                    <th>Masse</th>
                    <th>Ping</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {room.players.length === 0 ? (
                    <tr>
                      <td colSpan={4} style={{ fontStyle: 'italic', color: 'var(--text-soft)' }}>Aucun joueur actif.</td>
                    </tr>
                  ) : (
                    room.players.map((player) => (
                      <tr key={player.playerId}>
                        <td style={{ fontWeight: 600 }}>
                          {player.nickname}
                          {player.isBot && <span className="badge" style={{ fontSize: 9, marginLeft: 4 }}>Bot</span>}
                        </td>
                        <td style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{Math.round(player.mass)}</td>
                        <td>{player.ping !== undefined ? `${player.ping}ms` : '—'}</td>
                        <td className="row-actions">
                          {!player.isBot && (
                            <div style={{ display: 'flex', gap: 4 }}>
                              <button
                                className="btn-ghost"
                                type="button"
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                onClick={() => setPov({ roomId: room.id, playerId: player.playerId, nickname: player.nickname })}
                                title="Vue POV du joueur"
                              >
                                POV
                              </button>
                              <button
                                className="btn-ghost"
                                type="button"
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                onClick={() => {
                                  setTransferTarget({ roomId: room.id, playerId: player.playerId, nickname: player.nickname });
                                  const otherRooms = rooms.filter((r) => r.id !== room.id);
                                  if (otherRooms.length > 0) setSelectedTargetRoomId(otherRooms[0]!.id);
                                }}
                                title="Transférer"
                              >
                                Transférer
                              </button>
                              <button
                                className="btn-ghost btn-danger"
                                type="button"
                                style={{ padding: '2px 6px', fontSize: 11 }}
                                onClick={() => setKickTarget({ roomId: room.id, playerId: player.playerId, nickname: player.nickname })}
                                title="Expulser"
                              >
                                Kick
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        ))}
      </div>

      {transferTarget && (
        <div className="context-menu-backdrop" style={{ zIndex: 150 }} onClick={() => setTransferTarget(null)}>
          <div
            className="panel"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 151,
              width: 380,
              maxWidth: '90vw',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3>Transférer {transferTarget.nickname}</h3>
            <p className="view-subtitle" style={{ marginBottom: 14 }}>
              Choisissez le salon de destination :
            </p>
            {rooms.filter((r) => r.id !== transferTarget.roomId).length === 0 ? (
              <p className="error-text">Aucun autre salon actif disponible.</p>
            ) : (
              <select
                value={selectedTargetRoomId}
                onChange={(e) => setSelectedTargetRoomId(e.target.value)}
                style={{ width: '100%', marginBottom: 16, padding: 8 }}
              >
                {rooms
                  .filter((r) => r.id !== transferTarget.roomId)
                  .map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name} ({r.stats.playerCount}/{r.maxPlayers})
                    </option>
                  ))}
              </select>
            )}
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
              <button className="btn-ghost" type="button" onClick={() => setTransferTarget(null)}>
                Annuler
              </button>
              <button
                className="btn-primary"
                type="button"
                disabled={rooms.filter((r) => r.id !== transferTarget.roomId).length === 0}
                onClick={handleConfirmTransfer}
              >
                Transférer
              </button>
            </div>
          </div>
        </div>
      )}

      {kickTarget && (
        <div className="context-menu-backdrop" style={{ zIndex: 150 }} onClick={() => setKickTarget(null)}>
          <div
            className="panel"
            style={{
              position: 'fixed',
              top: '50%',
              left: '50%',
              transform: 'translate(-50%, -50%)',
              zIndex: 151,
              width: 380,
              maxWidth: '90vw',
              padding: 24,
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ fontSize: 16, marginBottom: 8 }}>Expulser {kickTarget.nickname} ?</h3>
            <p className="view-subtitle" style={{ marginBottom: 12 }}>
              Motif obligatoire (§8.3/§7.2) — visible dans le journal d'audit dès sa mise en place.
            </p>
            <input
              value={kickReason}
              onChange={(e) => setKickReason(e.target.value)}
              placeholder="Motif de l'expulsion…"
              style={{ width: '100%' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
              <button className="btn-ghost" type="button" onClick={() => { setKickTarget(null); setKickReason(''); }}>
                Annuler
              </button>
              <button className="btn-primary btn-danger" type="button" disabled={!kickReason.trim()} onClick={handleConfirmKick}>
                Expulser
              </button>
            </div>
          </div>
        </div>
      )}

      {pov && (
        <PovOverlay
          token={token}
          roomId={pov.roomId}
          playerId={pov.playerId}
          nickname={pov.nickname}
          onClose={() => setPov(null)}
        />
      )}
    </div>
  );
}

interface PovOverlayProps {
  token: string;
  roomId: string;
  playerId: string;
  nickname: string;
  onClose: () => void;
}

function PovOverlay({ token, roomId, playerId, nickname, onClose }: PovOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [disconnected, setDisconnected] = useState('');
  const [connectionStatus, setConnectionStatus] = useState<ConnectionStatus>('connecting');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new PixiEntityRenderer(canvas);

    function resize(): void {
      canvas!.width = canvas!.clientWidth;
      canvas!.height = canvas!.clientHeight;
      renderer.resize(canvas!.width, canvas!.height);
    }
    resize();
    window.addEventListener('resize', resize);

    const nicknames = new Map<string, string>();
    const colors = new Map<string, string>();
    let raf = 0;
    // Interpolation (§10.2 cahier_des_charges_admin.md) — absente avant ce correctif : le POV
    // dessinait directement le dernier `onState` reçu, sans lissage entre deux snapshots réseau,
    // un mouvement en escalier à la cadence réseau plutôt que fluide à la cadence d'écran.
    const snapshotBuffer = new AdminSnapshotBuffer();

    const handle: AdminSocketHandle = connectAdminSocket(token, roomId, {
      onState: (entities) => {
        snapshotBuffer.pushSnapshot(entities);
      },
      onPlayerInfo: (id, nick) => nicknames.set(id, nick),
      onWelcome: (tickRateHz) => {
        snapshotBuffer.setServerTickRateHz(tickRateHz);
        setConnectionStatus('connected');
      },
      onClose: (reason) => {
        setConnectionStatus('disconnected');
        setDisconnected(reason);
      },
    });
    setConnectionStatus('connecting');

    function frame(): void {
      const latestEntities = snapshotBuffer.getInterpolatedEntities();
      let camera: Camera;
      if (playerId) {
        const ownPieces = latestEntities.filter((e) => e.p === playerId);
        camera =
          ownPieces.length > 0
            ? {
                x: ownPieces.reduce((s, e) => s + e.x, 0) / ownPieces.length,
                y: ownPieces.reduce((s, e) => s + e.y, 0) / ownPieces.length,
                scale: POV_ZOOM,
              }
            : { x: 7500, y: 7500, scale: 0.05 };
      } else {
        const allPlayerPieces = latestEntities.filter((e) => e.p !== undefined);
        camera =
          allPlayerPieces.length > 0
            ? {
                x: allPlayerPieces.reduce((s, e) => s + e.x, 0) / allPlayerPieces.length,
                y: allPlayerPieces.reduce((s, e) => s + e.y, 0) / allPlayerPieces.length,
                scale: 0.06,
              }
            : { x: 7500, y: 7500, scale: 0.05 };
      }
      renderer.render(latestEntities, camera, nicknames, colors, playerId || undefined);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      renderer.destroy();
      window.removeEventListener('resize', resize);
      handle.close();
    };
  }, [token, roomId, playerId]);

  return (
    <div className="pov-overlay">
      <div className="pov-header">
        <span>{nickname}</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <ConnectionStatusDot status={connectionStatus} />
          <button className="btn-ghost" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
      </div>
      {disconnected && <p className="error-text">{disconnected}</p>}
      <canvas ref={canvasRef} className="pov-canvas" />
    </div>
  );
}
