import { useEffect, useState } from 'react';
import { listRooms, type AdminRoomView } from '../adminApi.js';

interface DashboardViewProps {
  token: string;
  onAuthError: (message: string) => void;
  onOpenRoom: (roomId: string) => void;
}

/** Non lu au-delà de ce seuil = badge rouge (§8.2/§6, salon "anormalement" lent) — même seuil
 * qu'un tick 20Hz confortable double son budget (50ms/tick). */
const TICK_WARNING_MS = 100;

/** Module Tableau de bord (§6 cahier_des_charges_admin.md) — vue d'atterrissage après connexion.
 * Le flux d'activité récente (§6 : "dernières actions admin journalisées") dépend du journal
 * d'audit (§11.2), pas encore implémenté (Phase 3 de la feuille de route §16) — affiché en
 * attente plutôt que masqué, pour que la structure finale reste visible dès maintenant. */
export default function DashboardView({ token, onAuthError, onOpenRoom }: DashboardViewProps) {
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        setRooms(await listRooms(token));
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        onAuthError(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const totalPlayers = rooms.reduce((sum, room) => sum + room.stats.playerCount, 0);
  const avgTick =
    rooms.length === 0
      ? 0
      : rooms.reduce((sum, room) => sum + room.stats.tickAvgMs, 0) / rooms.length;

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Tableau de bord</h2>
          <p className="view-subtitle">Vue d'ensemble de l'état du serveur, en un coup d'œil.</p>
        </div>
      </div>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Santé serveur
        </span>
        <div className="stat-grid">
          <div className="stat-card">
            <div className="stat-card-value">{rooms.length}</div>
            <div className="stat-card-label">Salons actifs</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{totalPlayers}</div>
            <div className="stat-card-label">Joueurs connectés</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value">{avgTick.toFixed(1)}ms</div>
            <div className="stat-card-label">Tick moyen</div>
          </div>
        </div>
        <p className="error-text">{error}</p>
      </section>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Salons
        </span>
        {rooms.length === 0 ? (
          <p className="view-subtitle" style={{ marginTop: 8 }}>
            Aucun salon actif.
          </p>
        ) : (
          <div className="room-card-grid">
            {rooms.map((room) => (
              <button
                key={room.id}
                type="button"
                className="room-card"
                onClick={() => onOpenRoom(room.id)}
                title="Ouvrir dans Salons & Écrans"
              >
                <span className="room-card-title">
                  {room.stats.tickAvgMs > TICK_WARNING_MS && <span className="tick-warning-dot" />}
                  {room.name}
                </span>
                <span className="view-subtitle">
                  {room.modId} · {room.stats.playerCount}/{room.maxPlayers} joueurs ·{' '}
                  {room.stats.tickAvgMs.toFixed(1)}ms
                </span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Activité récente
        </span>
        <p className="view-subtitle" style={{ marginTop: 8 }}>
          Le flux d'actions admin journalisées arrive avec le module Modération (§11) — journal
          d'audit encore à construire côté serveur.
        </p>
      </section>
    </div>
  );
}
