import { useEffect, useState } from 'react';
import {
  broadcastMessage,
  getActivity,
  getHealth,
  getHealthHistory,
  listRooms,
  type AdminActivityEntry,
  type AdminRoomView,
  type HealthHistoryPoint,
  type HealthSnapshot,
} from '../adminApi.js';

interface DashboardViewProps {
  token: string;
  onAuthError: (error: unknown) => void;
  onOpenRoom: (roomId: string) => void;
  /** Raccourci "Synchroniser les salons" (§7.3 plan-implementation-admin.md) — la synchro à chaud
   * elle-même vit dans l'onglet Configuration (P6, diff/apply), ce bouton s'y contente de naviguer. */
  onGoToConfiguration: () => void;
}

/** Non lu au-delà de ce seuil = badge rouge (§8.2/§6, salon "anormalement" lent) — même seuil
 * qu'un tick 20Hz confortable double son budget (50ms/tick). */
const TICK_WARNING_MS = 100;
/** Alerte event loop (§5.2 cahier_des_charges_admin.md). */
const EVENT_LOOP_WARNING_MS = 50;
const REFRESH_INTERVAL_MS = 3000;
/** L'historique n'avance qu'à 1 point/minute côté serveur (healthHistory.ts) — inutile de le
 * rafraîchir à la même cadence que le reste du Dashboard. */
const HISTORY_REFRESH_INTERVAL_MS = 30_000;

type AlertSeverity = 'critical' | 'warning';

interface DashboardAlert {
  id: string;
  severity: AlertSeverity;
  message: string;
  roomId?: string;
}

const SEVERITY_RANK: Record<AlertSeverity, number> = { critical: 0, warning: 1 };

/** Bandeau d'alertes (§7.3, §5.2 cahier_des_charges_admin.md) — seuils fixes du cahier, triées
 * par gravité (DB down avant tout le reste : ça affecte les comptes joueurs pour TOUT le
 * serveur, pas un seul salon). */
function buildAlerts(health: HealthSnapshot | undefined, rooms: AdminRoomView[]): DashboardAlert[] {
  const alerts: DashboardAlert[] = [];

  if (health && !health.dbOk) {
    alerts.push({ id: 'db', severity: 'critical', message: 'Base de données indisponible.' });
  }
  if (health?.eventLoopDelay && health.eventLoopDelay.p99Ms > EVENT_LOOP_WARNING_MS) {
    alerts.push({
      id: 'event-loop',
      severity: 'warning',
      message: `Délai de l'event loop élevé (p99 ${health.eventLoopDelay.p99Ms.toFixed(0)}ms).`,
    });
  }
  for (const room of health?.rooms ?? []) {
    if (room.tickAvgMs > TICK_WARNING_MS) {
      alerts.push({
        id: `tick-${room.roomId}`,
        severity: 'warning',
        message: `Salon "${room.name}" : tick moyen élevé (${room.tickAvgMs.toFixed(1)}ms).`,
        roomId: room.roomId,
      });
    }
  }
  for (const room of rooms) {
    if (room.maxPlayers > 0 && room.stats.playerCount >= room.maxPlayers) {
      alerts.push({
        id: `full-${room.id}`,
        severity: 'warning',
        message: `Salon "${room.name}" complet (${room.stats.playerCount}/${room.maxPlayers}).`,
        roomId: room.id,
      });
    }
  }

  return alerts.sort((a, b) => SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity]);
}

const CHART_WIDTH = 600;
const CHART_HEIGHT = 140;
const CHART_PADDING = 10;

/** Graphe SVG fait main (décision §2.5 plan-implementation-admin.md : pas de librairie de charts
 * pour un jeu de données aussi petit, ≤1440 points/24h). `series` : plusieurs courbes sur les
 * mêmes axes (ex. tick moyen + délai event loop), chacune avec sa couleur/légende. L'axe Y
 * démarre TOUJOURS à 0 (jamais de zoom automatique sur la plage de valeurs) : un relief exagéré
 * sur un bruit de mesure serait trompeur pour un outil de diagnostic. */
function HistoryChart({
  points,
  series,
  unit,
}: {
  points: HealthHistoryPoint[];
  series: Array<{ label: string; color: string; accessor: (p: HealthHistoryPoint) => number }>;
  unit: string;
}) {
  if (points.length < 2) {
    return (
      <p className="view-subtitle" style={{ fontStyle: 'italic', margin: 0 }}>
        Pas encore assez de données sur cette période.
      </p>
    );
  }

  const minX = points[0]!.atMs;
  const maxX = points[points.length - 1]!.atMs;
  const spanX = Math.max(1, maxX - minX);
  const maxY = Math.max(1, ...series.flatMap((s) => points.map((p) => s.accessor(p))));

  const xScale = (x: number): number =>
    CHART_PADDING + ((x - minX) / spanX) * (CHART_WIDTH - CHART_PADDING * 2);
  const yScale = (y: number): number =>
    CHART_HEIGHT - CHART_PADDING - (y / maxY) * (CHART_HEIGHT - CHART_PADDING * 2);

  return (
    <div>
      <svg viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`} style={{ width: '100%', height: CHART_HEIGHT, display: 'block' }}>
        <line
          x1={CHART_PADDING}
          y1={CHART_HEIGHT - CHART_PADDING}
          x2={CHART_WIDTH - CHART_PADDING}
          y2={CHART_HEIGHT - CHART_PADDING}
          stroke="var(--border)"
          strokeWidth={1}
        />
        {series.map((s) => (
          <polyline
            key={s.label}
            points={points.map((p) => `${xScale(p.atMs).toFixed(1)},${yScale(s.accessor(p)).toFixed(1)}`).join(' ')}
            fill="none"
            stroke={s.color}
            strokeWidth={2}
          />
        ))}
      </svg>
      <div style={{ display: 'flex', gap: 14, marginTop: 6, flexWrap: 'wrap' }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--text-soft)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
        <span style={{ fontSize: 11, color: 'var(--text-faint)', marginLeft: 'auto' }}>
          Max affiché : {maxY.toFixed(1)}
          {unit}
        </span>
      </div>
    </div>
  );
}

/** Module Tableau de bord (§6 cahier_des_charges_admin.md) — vue d'atterrissage après connexion.
 * P5 (plan-implementation-admin.md §7) : bandeau d'alertes, historique 1h/6h/24h (2 graphes),
 * activité récente honnête (journal `logAdminEvent`, plus de placeholder), annonce globale et
 * raccourci vers la synchro à chaud des salons (P6). */
export default function DashboardView({ token, onAuthError, onOpenRoom, onGoToConfiguration }: DashboardViewProps) {
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [health, setHealth] = useState<HealthSnapshot | undefined>(undefined);
  const [activity, setActivity] = useState<AdminActivityEntry[]>([]);
  const [history, setHistory] = useState<HealthHistoryPoint[]>([]);
  const [historyHours, setHistoryHours] = useState<1 | 6 | 24>(1);
  const [error, setError] = useState('');
  const [broadcastText, setBroadcastText] = useState('');
  const [broadcastStatus, setBroadcastStatus] = useState('');

  useEffect(() => {
    let cancelled = false;
    const refresh = async (): Promise<void> => {
      try {
        const roomsRes = await listRooms(token);
        if (cancelled) return;
        const [healthRes, activityRes] = await Promise.all([getHealth(token), getActivity(token)]);
        if (cancelled) return;
        setRooms(roomsRes);
        setHealth(healthRes);
        setActivity(activityRes);
        setError('');
      } catch (err: unknown) {
        if (cancelled) return;
        setError((err as Error).message);
        onAuthError(err);
      }
    };
    void refresh();
    const interval = setInterval(() => void refresh(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, onAuthError]);

  useEffect(() => {
    let cancelled = false;
    const refreshHistory = async (): Promise<void> => {
      try {
        const points = await getHealthHistory(token, historyHours);
        if (!cancelled) setHistory(points);
      } catch (err: unknown) {
        if (!cancelled) onAuthError(err);
      }
    };
    void refreshHistory();
    const interval = setInterval(() => void refreshHistory(), HISTORY_REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [token, historyHours, onAuthError]);

  const totalPlayers = rooms.reduce((sum, room) => sum + room.stats.playerCount, 0);
  const avgTick =
    rooms.length === 0 ? 0 : rooms.reduce((sum, room) => sum + room.stats.tickAvgMs, 0) / rooms.length;
  const alerts = buildAlerts(health, rooms);

  const sendGlobalAnnouncement = (): void => {
    const text = broadcastText.trim();
    if (!text) return;
    void broadcastMessage(token, text, {})
      .then((result) => {
        setBroadcastStatus(`Envoyée à ${result.sent} joueur(s).`);
        setBroadcastText('');
      })
      .catch((err: unknown) => setBroadcastStatus((err as Error).message));
  };

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Tableau de bord</h2>
          <p className="view-subtitle">Vue d'ensemble de l'état du serveur, en un coup d'œil.</p>
        </div>
        <button className="btn-ghost" type="button" onClick={onGoToConfiguration}>
          <span className="material-symbols-outlined" aria-hidden="true">sync</span> Synchroniser les salons
        </button>
      </div>

      {alerts.length > 0 && (
        <section className="panel" style={{ borderColor: 'var(--danger)' }}>
          <span className="section-title" style={{ marginTop: 0 }}>
            Alertes ({alerts.length})
          </span>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {alerts.map((alert) => (
              <button
                key={alert.id}
                type="button"
                className="btn-ghost"
                disabled={!alert.roomId}
                onClick={() => alert.roomId && onOpenRoom(alert.roomId)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  justifyContent: 'flex-start',
                  textAlign: 'left',
                  padding: '8px 12px',
                  background: alert.severity === 'critical' ? 'rgba(220,38,38,0.1)' : 'rgba(217,119,6,0.1)',
                  color: alert.severity === 'critical' ? 'var(--danger)' : '#92400e',
                }}
              >
                <span className="material-symbols-outlined" aria-hidden="true" style={{ fontSize: 18 }}>
                  {alert.severity === 'critical' ? 'error' : 'warning'}
                </span>
                {alert.message}
                {alert.roomId && (
                  <span style={{ marginLeft: 'auto', fontSize: 11, opacity: 0.8 }}>Ouvrir le studio →</span>
                )}
              </button>
            ))}
          </div>
        </section>
      )}

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
          <div className="stat-card">
            <div className="stat-card-value">{health?.eventLoopDelay?.p99Ms.toFixed(1) ?? '—'}ms</div>
            <div className="stat-card-label">Event loop (p99)</div>
          </div>
          <div className="stat-card">
            <div className="stat-card-value" style={{ color: health?.dbOk === false ? 'var(--danger)' : undefined }}>
              {health === undefined ? '—' : health.dbOk ? 'OK' : 'HS'}
            </div>
            <div className="stat-card-label">Base de données</div>
          </div>
        </div>
        <p className="error-text">{error}</p>
      </section>

      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span className="section-title" style={{ margin: 0 }}>
            Historique
          </span>
          <div style={{ display: 'flex', gap: 4 }}>
            {([1, 6, 24] as const).map((hours) => (
              <button
                key={hours}
                type="button"
                className={historyHours === hours ? 'btn-primary' : 'btn-ghost'}
                style={{ padding: '4px 12px', fontSize: 12 }}
                onClick={() => setHistoryHours(hours)}
              >
                {hours}h
              </button>
            ))}
          </div>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, marginTop: 12 }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)' }}>Joueurs connectés</span>
            <div style={{ marginTop: 6 }}>
              <HistoryChart
                points={history}
                unit=""
                series={[{ label: 'Joueurs', color: 'var(--accent)', accessor: (p) => p.playersOnline }]}
              />
            </div>
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-soft)' }}>Performance</span>
            <div style={{ marginTop: 6 }}>
              <HistoryChart
                points={history}
                unit="ms"
                series={[
                  { label: 'Tick moyen (pire salon)', color: 'var(--accent)', accessor: (p) => p.tickAvgMs },
                  { label: 'Event loop (p99)', color: 'var(--danger)', accessor: (p) => p.eventLoopP99Ms ?? 0 },
                ]}
              />
            </div>
          </div>
        </div>
      </section>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Annonce globale
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <input
            value={broadcastText}
            onChange={(event) => setBroadcastText(event.target.value)}
            placeholder="Message diffusé à tous les salons..."
            maxLength={200}
            style={{ flex: 1 }}
          />
          <button className="btn-primary" type="button" onClick={sendGlobalAnnouncement}>
            <span className="material-symbols-outlined" aria-hidden="true">campaign</span> Diffuser
          </button>
        </div>
        {broadcastStatus && <p className="status-text" style={{ marginTop: 8 }}>{broadcastStatus}</p>}
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
                title="Ouvrir dans le studio"
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
        {activity.length === 0 ? (
          <p className="view-subtitle" style={{ marginTop: 8 }}>
            Aucune action admin journalisée depuis le démarrage du serveur.
          </p>
        ) : (
          <ul className="activity-feed">
            {activity.slice(0, 30).map((entry, index) => (
              <li key={index}>
                <span style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-faint)' }}>
                  {new Date(entry.atMs).toLocaleTimeString()}
                </span>{' '}
                — {entry.event}
                {Object.keys(entry.fields).length > 0 && (
                  <span style={{ color: 'var(--text-faint)' }}>
                    {' '}
                    ({Object.entries(entry.fields).map(([key, value]) => `${key}=${String(value)}`).join(', ')})
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
