import { useEffect, useRef, useState } from 'react';
import type { EntitySnapshot } from '@angulio/shared';
import { kickPlayer, listRooms, transferPlayer, type AdminRoomView } from '../adminApi.js';
import { connectAdminSocket, type AdminSocketHandle } from '../adminSocket.js';
import { drawEntities, type Camera } from '../entityCanvas.js';

interface RoomsViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

const REFRESH_INTERVAL_MS = 3000;
const POV_ZOOM = 0.6;

/** Onglet "Salons & Écrans" (§3.3 cahier_des_charges_admin.md) — supervision des salons/joueurs
 * en ligne, expulsion, transfert, mode Suivi "POV". */
export default function RoomsView({ token, onAuthError }: RoomsViewProps) {
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [pov, setPov] = useState<{ roomId: string; playerId: string; nickname: string } | null>(
    null,
  );

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

  const handleKick = (roomId: string, playerId: string, nickname: string): void => {
    void (async () => {
      try {
        await kickPlayer(token, roomId, playerId);
        setStatus(`${nickname} expulsé(e).`);
        refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  const handleTransfer = (roomId: string, playerId: string): void => {
    const targetRoomId = window.prompt('Id du salon cible ?');
    if (!targetRoomId) return;
    void (async () => {
      try {
        await transferPlayer(token, roomId, playerId, targetRoomId);
        setStatus('Joueur transféré.');
        refresh();
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  return (
    <div className="view view-wide">
      <div className="top-bar">
        <div>
          <h2>Salons &amp; Écrans</h2>
          <p className="view-subtitle">
            Salons actifs, joueurs connectés, expulsion, transfert, mode Suivi "POV".
          </p>
        </div>
        <button className="btn-ghost" type="button" onClick={refresh}>
          Rafraîchir
        </button>
      </div>

      <p className="error-text">{error}</p>
      <p className="status-text">{status}</p>

      {rooms.map((room) => (
        <section className="panel" key={room.id}>
          <div className="room-header">
            <div>
              <h2 style={{ fontSize: 16 }}>
                {room.name} <span className="badge">{room.modId}</span>{' '}
                <span className="badge">{room.visibility}</span>
              </h2>
              <p className="view-subtitle">
                {room.stats.playerCount}/{room.maxPlayers} joueurs · tick {room.tickRateHz}Hz ·
                avg {room.stats.tickAvgMs.toFixed(1)}ms · p95 {room.stats.tickP95Ms.toFixed(1)}ms ·
                {' '}
                {room.stats.tickOverruns} dépassement(s)
              </p>
            </div>
          </div>

          <table className="data-table">
            <thead>
              <tr>
                <th>Joueur</th>
                <th>Masse</th>
                <th>Ping</th>
                <th>Statut</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {room.players.length === 0 ? (
                <tr>
                  <td colSpan={5}>Aucun joueur.</td>
                </tr>
              ) : (
                room.players.map((player) => (
                  <tr key={player.playerId}>
                    <td>{player.nickname}</td>
                    <td>{Math.round(player.mass)}</td>
                    <td>{player.ping !== undefined ? `${player.ping}ms` : '—'}</td>
                    <td>
                      {[player.isBot ? 'Bot' : '', player.isFrozen ? 'Gelé' : '']
                        .filter(Boolean)
                        .join(' · ') || '—'}
                    </td>
                    <td className="row-actions">
                      {!player.isBot && (
                        <>
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() =>
                              setPov({ roomId: room.id, playerId: player.playerId, nickname: player.nickname })
                            }
                          >
                            POV
                          </button>
                          <button
                            className="btn-ghost"
                            type="button"
                            onClick={() => handleTransfer(room.id, player.playerId)}
                          >
                            Transférer
                          </button>
                          <button
                            className="btn-ghost btn-danger"
                            type="button"
                            onClick={() => handleKick(room.id, player.playerId, player.nickname)}
                          >
                            Expulser
                          </button>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      ))}

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

/** Caméra verrouillée sur le barycentre des morceaux du joueur ciblé (§3.3, "Suivi POV") —
 * réutilise le canal WebSocket admin comme un spectateur (toutes les entités, voir
 * adminSocket.ts), le zoom/centrage est purement calculé côté client à partir des entités
 * reçues (aucun mode de vue serveur dédié nécessaire). */
function PovOverlay({ token, roomId, playerId, nickname, onClose }: PovOverlayProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [disconnected, setDisconnected] = useState('');

  useEffect(() => {
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
    let raf = 0;
    let latestEntities: EntitySnapshot[] = [];

    const handle: AdminSocketHandle = connectAdminSocket(token, roomId, {
      onState: (entities) => {
        latestEntities = entities;
      },
      onPlayerInfo: (id, nick) => nicknames.set(id, nick),
      onClose: (reason) => setDisconnected(reason),
    });

    function frame(): void {
      const ownPieces = latestEntities.filter((e) => e.p === playerId);
      const camera: Camera =
        ownPieces.length > 0
          ? {
              x: ownPieces.reduce((s, e) => s + e.x, 0) / ownPieces.length,
              y: ownPieces.reduce((s, e) => s + e.y, 0) / ownPieces.length,
              scale: POV_ZOOM,
            }
          : { x: 0, y: 0, scale: POV_ZOOM * 0.1 };
      drawEntities(ctx!, latestEntities, camera, nicknames, colors, playerId);
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      handle.close();
    };
  }, [token, roomId, playerId]);

  return (
    <div className="pov-overlay">
      <div className="pov-header">
        <span>POV — {nickname}</span>
        <button className="btn-ghost" type="button" onClick={onClose}>
          Détacher
        </button>
      </div>
      {disconnected && <p className="error-text">{disconnected}</p>}
      <canvas ref={canvasRef} className="pov-canvas" />
    </div>
  );
}
