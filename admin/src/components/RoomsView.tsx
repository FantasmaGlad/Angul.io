import { useEffect, useRef, useState } from 'react';
import { computeFitCamera, renderFrame, RenderEngine, type Camera } from '@angulio/shared/render';
import { listRooms, type AdminRoomView } from '../adminApi.js';
import { connectAdminSocket } from '../adminSocket.js';

interface RoomsViewProps {
  token: string;
  onAuthError: (error: unknown) => void;
  onOpenStudio: (roomId: string) => void;
}

const REFRESH_INTERVAL_MS = 3000;
/** Salon signalé (badge rouge, §7.1 cahier_des_charges_admin.md) au-delà de ce seuil — double le
 * budget confortable d'un tick 20Hz (50ms/tick). */
const TICK_WARNING_MS = 100;

/** Niveau liste de l'onglet "Salons" (A11, plan-implementation-admin.md §5.1) — vue d'ensemble en
 * grille de cartes (remplace l'ex-carrousel horizontal) ; plus de tableau de joueurs ni de bouton
 * kick à ce niveau : une seule porte d'entrée (`onOpenStudio`) vers le Studio, qui concentre
 * désormais toutes les actions sur un joueur (kick, transfert, sanctions...). */
export default function RoomsView({ token, onAuthError, onOpenStudio }: RoomsViewProps) {
  const [rooms, setRooms] = useState<AdminRoomView[]>([]);
  const [error, setError] = useState('');
  /** Filtres/tri de la grille (§7.1). */
  const [modeFilter, setModeFilter] = useState('all');
  const [visibilityFilter, setVisibilityFilter] = useState<'all' | 'public' | 'private'>('all');
  const [sortMode, setSortMode] = useState<'none' | 'occupancy-desc' | 'occupancy-asc'>('none');
  /** Miniature live activable/désactivable (§7.1 : "pour ménager le CPU") — désactivée par défaut,
   * une carte visible ouvre alors un canal WebSocket admin dédié rendu à cadence réduite. */
  const [livePreview, setLivePreview] = useState(false);

  const refresh = (): void => {
    void (async () => {
      try {
        setRooms(await listRooms(token));
        setError('');
      } catch (err) {
        setError((err as Error).message);
        onAuthError(err);
      }
    })();
  };

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, REFRESH_INTERVAL_MS);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const visibleRooms = rooms
    .filter((room) => modeFilter === 'all' || room.modId === modeFilter)
    .filter((room) => visibilityFilter === 'all' || room.visibility === visibilityFilter)
    .sort((a, b) => {
      if (sortMode === 'occupancy-desc') return b.stats.playerCount - a.stats.playerCount;
      if (sortMode === 'occupancy-asc') return a.stats.playerCount - b.stats.playerCount;
      return 0;
    });
  const availableModes = Array.from(new Set(rooms.map((room) => room.modId))).sort();

  return (
    <div className="view view-wide" style={{ height: 'calc(100vh - 56px)', display: 'flex', flexDirection: 'column', gap: 12, maxWidth: '100%' }}>
      <div className="top-bar" style={{ flexShrink: 0 }}>
        <div>
          <h2>Salons</h2>
          <p className="view-subtitle">
            Vue d'ensemble des salons actifs — cliquez une carte pour ouvrir son studio.
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <label className="filter-checkbox" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}>
            <input type="checkbox" checked={livePreview} onChange={(e) => setLivePreview(e.target.checked)} />
            Aperçu en direct
          </label>
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
        <select value={visibilityFilter} onChange={(e) => setVisibilityFilter(e.target.value as typeof visibilityFilter)}>
          <option value="all">Publics et privés</option>
          <option value="public">Publics uniquement</option>
          <option value="private">Privés uniquement</option>
        </select>
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as typeof sortMode)}>
          <option value="none">Ordre par défaut</option>
          <option value="occupancy-desc">Occupation : plus rempli d'abord</option>
          <option value="occupancy-asc">Occupation : moins rempli d'abord</option>
        </select>
      </div>

      {error && <p className="error-text" style={{ margin: 0, flexShrink: 0 }}>{error}</p>}

      <div className="salons-card-grid" style={{ flex: 1, overflowY: 'auto', paddingBottom: 8 }}>
        {visibleRooms.length === 0 ? (
          <p className="view-subtitle" style={{ fontStyle: 'italic' }}>Aucun salon actif.</p>
        ) : (
          visibleRooms.map((room) => (
            <RoomCard
              key={room.id}
              room={room}
              token={token}
              livePreview={livePreview}
              onOpen={() => onOpenStudio(room.id)}
            />
          ))
        )}
      </div>
    </div>
  );
}

function RoomCard({
  room,
  token,
  livePreview,
  onOpen,
}: {
  room: AdminRoomView;
  token: string;
  livePreview: boolean;
  onOpen: () => void;
}) {
  return (
    <button type="button" className="salons-card" onClick={onOpen} title="Ouvrir le studio">
      <div className="salons-card-header">
        <span className="salons-card-title">
          {room.stats.tickAvgMs > TICK_WARNING_MS && (
            <span className="tick-warning-dot" title={`Tick anormalement élevé (${room.stats.tickAvgMs.toFixed(1)}ms)`} />
          )}
          {room.name}
        </span>
        <span className="badge">{room.modId}</span>
      </div>
      <p className="view-subtitle" style={{ margin: 0 }}>
        {room.stats.playerCount}/{room.maxPlayers} joueurs · {room.snapshotHz}Hz · avg {room.stats.tickAvgMs.toFixed(1)}ms
        {' · '}
        {room.visibility === 'private' ? 'Privé' : 'Public'}
      </p>
      {livePreview ? (
        <RoomThumbnail token={token} roomId={room.id} />
      ) : (
        <div className="salons-card-thumb-placeholder">
          <span className="material-symbols-outlined" aria-hidden="true">visibility_off</span>
        </div>
      )}
    </button>
  );
}

const THUMBNAIL_WIDTH_PX = 300;
const THUMBNAIL_HEIGHT_PX = 150;
/** ~5 FPS (§7.1 cahier_des_charges_admin.md : "cadence réduite ~5 FPS, activable/désactivable
 * pour ménager le CPU") — `RenderEngine.getInterpolatedEntities` dérive sa propre ligne de temps
 * de `performance.now()` (ancrage epochTick/epochClientMs), pas du rythme d'appel : un appel via
 * `setInterval` à cadence réduite plutôt qu'un `requestAnimationFrame` à 60 FPS suffit et est
 * nettement moins coûteux (potentiellement plusieurs miniatures ouvertes en simultané). */
const THUMBNAIL_INTERVAL_MS = 200;

/** Miniature live d'un salon — connexion WebSocket admin dédiée, rendue avec le moteur partagé
 * avec le jeu (`@angulio/shared/render`), même principe que le Studio en plus léger : pas
 * d'interaction, caméra fit-to-map fixe, pseudos masqués (trop petit pour être lisible). */
function RoomThumbnail({ token, roomId }: { token: string; roomId: string }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const canvasContext = canvas?.getContext('2d');
    if (!canvas || !canvasContext) return;
    const ctx: CanvasRenderingContext2D = canvasContext;

    const nicknames = new Map<string, string>();
    const colors = new Map<string, string>();
    const renderEngine = new RenderEngine();
    let mapSize = 0;
    let camera: Camera = { x: 0, y: 0, scale: 0.05 };

    const handle = connectAdminSocket(token, roomId, {
      onState: (state) => {
        renderEngine.pushSnapshot(state.entities, state.tick, undefined, state.entitiesFull, state.removedFoodIds);
      },
      onPlayerInfo: (id, nick, color) => {
        nicknames.set(id, nick);
        if (color) colors.set(id, color);
      },
      onWelcome: (welcome) => {
        renderEngine.reset();
        renderEngine.serverTickRateHz = welcome.tickRateHz;
        mapSize = welcome.mapSize;
        camera = computeFitCamera(mapSize, canvas.width, canvas.height);
      },
    });

    const interval = window.setInterval(() => {
      const entities = renderEngine.getInterpolatedEntities(
        THUMBNAIL_INTERVAL_MS,
        camera,
        canvas.width,
        canvas.height,
        undefined,
        true,
        mapSize,
      );
      renderFrame(ctx, canvas, entities, camera, nicknames, colors, undefined, mapSize, undefined, true);
    }, THUMBNAIL_INTERVAL_MS);

    return () => {
      window.clearInterval(interval);
      handle.close();
    };
  }, [token, roomId]);

  return (
    <canvas
      ref={canvasRef}
      width={THUMBNAIL_WIDTH_PX}
      height={THUMBNAIL_HEIGHT_PX}
      className="salons-card-thumb"
    />
  );
}
