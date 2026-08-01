import { useEffect, useState } from 'react';
import {
  getBaseRooms,
  listModes,
  reloadServerSync,
  updateBaseRooms,
  type BaseRoomConfig,
} from '../adminApi.js';

interface ConfigurationViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

const DEFAULT_MOD_PROPERTIES: Record<string, { mapSize: number; maxPlayers: number; resetDurationMin: number }> = {
  vanilla: { mapSize: 20000, maxPlayers: 30, resetDurationMin: 120 },
  hardcore: { mapSize: 50000, maxPlayers: 30, resetDurationMin: 120 },
  infini: { mapSize: 5000, maxPlayers: 30, resetDurationMin: 120 },
  'mega-split': { mapSize: 20000, maxPlayers: 30, resetDurationMin: 120 },
};

export default function ConfigurationView({ token, onAuthError }: ConfigurationViewProps) {
  const [modes, setModes] = useState<string[]>([]);
  const [baseRooms, setBaseRooms] = useState<BaseRoomConfig[]>([]);
  const [baseRoomsError, setBaseRoomsError] = useState('');
  const [baseRoomsStatus, setBaseRoomsStatus] = useState('');
  const [savingBaseRooms, setSavingBaseRooms] = useState(false);

  // Serveur & Synchronisation
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');
  const [reloadingServer, setReloadingServer] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setModes(await listModes());
      } catch (err) {
        setBaseRoomsError((err as Error).message);
      }
    })();
    void (async () => {
      try {
        setBaseRooms(await getBaseRooms(token));
      } catch (err) {
        const message = (err as Error).message;
        setBaseRoomsError(message);
        onAuthError(message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const updateRoom = (index: number, patch: Partial<BaseRoomConfig>): void => {
    setBaseRooms((rooms) =>
      rooms.map((room, i) => {
        if (i !== index) return room;
        const updated = { ...room, ...patch };
        const defaults = patch.modId ? DEFAULT_MOD_PROPERTIES[patch.modId] : undefined;
        if (defaults) {
          updated.mapSize = defaults.mapSize;
          updated.maxPlayers = defaults.maxPlayers;
          updated.resetDurationMin = defaults.resetDurationMin;
        }
        return updated;
      }),
    );
  };

  const removeRoom = (index: number): void => {
    setBaseRooms((rooms) => rooms.filter((_, i) => i !== index));
  };

  const addRoom = (): void => {
    const defaultMod = modes[0] ?? 'vanilla';
    const defaults = DEFAULT_MOD_PROPERTIES[defaultMod] ?? { mapSize: 15000, maxPlayers: 30, resetDurationMin: 120 };
    setBaseRooms((rooms) => [
      ...rooms,
      { name: '', modId: defaultMod, mapSize: defaults.mapSize, maxPlayers: defaults.maxPlayers, resetDurationMin: defaults.resetDurationMin },
    ]);
  };

  const saveBaseRooms = (): void => {
    const trimmed = baseRooms.map((room) => ({
      name: room.name.trim(),
      modId: room.modId,
      mapSize: Number(room.mapSize) || 15000,
      maxPlayers: Number(room.maxPlayers) || 30,
      resetDurationMin: Number(room.resetDurationMin) || 0,
    }));
    if (trimmed.some((room) => !room.name || !room.modId)) {
      setBaseRoomsError('Chaque salon nécessite un nom et un mode.');
      return;
    }
    setSavingBaseRooms(true);
    setBaseRoomsError('');
    setBaseRoomsStatus('');
    void updateBaseRooms(token, trimmed)
      .then((result) => {
        setBaseRooms(trimmed);
        setBaseRoomsStatus(
          result.note ?? 'Sauvegardé dans server/rooms.local.json (isolé de git).',
        );
      })
      .catch((err: unknown) => setBaseRoomsError((err as Error).message))
      .finally(() => setSavingBaseRooms(false));
  };

  const handleServerReload = (): void => {
    setReloadingServer(true);
    setSyncError('');
    setSyncStatus('');
    void reloadServerSync(token)
      .then((res) => setSyncStatus(res.message))
      .catch((err: unknown) => setSyncError((err as Error).message))
      .finally(() => setReloadingServer(false));
  };

  return (
    <div className="view">
      <div
        className="top-bar"
        style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
      >
        <div>
          <h2>Configuration des Salons Permanents (v6.3)</h2>
          <p className="view-subtitle">
            Édition fine des salons d'accueil (taille de carte, nombre de joueurs, reset) et synchronisation serveur.
          </p>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={handleServerReload}
          disabled={reloadingServer}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
        >
          <span className={`material-symbols-outlined ${reloadingServer ? 'spinning' : ''}`}>
            sync
          </span>
          {reloadingServer ? 'Synchronisation…' : 'Synchroniser & Redémarrer les Salons'}
        </button>
      </div>

      {syncStatus && (
        <div
          className="status-text"
          style={{
            padding: '8px 12px',
            background: 'rgba(46, 139, 87, 0.15)',
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {syncStatus}
        </div>
      )}
      {syncError && (
        <div
          className="error-text"
          style={{
            padding: '8px 12px',
            background: 'rgba(255, 0, 0, 0.15)',
            borderRadius: 8,
            marginBottom: 12,
          }}
        >
          {syncError}
        </div>
      )}

      {/* SALONS PERMANENTS (ACCUEIL) */}
      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Configuration des Salons de l'Accueil (`server/rooms.local.json`)
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 16 }}>
          Personnalisez le nom, le mode, la taille de l'arène, la capacité maximale de joueurs et la fréquence du reset automatique de chaque salon d'accueil.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {baseRooms.map((room, index) => (
            <div
              key={index}
              style={{
                display: 'grid',
                gridTemplateColumns: '2fr 1.5fr 1fr 1fr 1fr auto',
                gap: 10,
                alignItems: 'center',
                background: 'rgba(0,0,0,0.02)',
                padding: 10,
                borderRadius: 8,
                border: '1px solid var(--border-strong)',
              }}
            >
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  NOM DU SALON
                </label>
                <input
                  value={room.name}
                  onChange={(e) => updateRoom(index, { name: e.target.value })}
                  placeholder="Nom du salon (ex: Vanilla #1)"
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  MODE DE JEU
                </label>
                <select
                  value={room.modId}
                  onChange={(e) => updateRoom(index, { modId: e.target.value })}
                  style={{
                    padding: 8,
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--border-strong)',
                    width: '100%',
                  }}
                >
                  {!modes.includes(room.modId) && room.modId && (
                    <option value={room.modId}>{room.modId}</option>
                  )}
                  {modes.map((modId) => (
                    <option key={modId} value={modId}>
                      {modId}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  TAILLE CARTE (PX)
                </label>
                <input
                  type="number"
                  value={room.mapSize ?? 15000}
                  onChange={(e) => updateRoom(index, { mapSize: Number(e.target.value) })}
                  placeholder="15000"
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  JOUEURS MAX
                </label>
                <input
                  type="number"
                  value={room.maxPlayers ?? 30}
                  onChange={(e) => updateRoom(index, { maxPlayers: Number(e.target.value) })}
                  placeholder="30"
                />
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, display: 'block', marginBottom: 2 }}>
                  RESET (MIN)
                </label>
                <input
                  type="number"
                  value={room.resetDurationMin ?? 120}
                  onChange={(e) => updateRoom(index, { resetDurationMin: Number(e.target.value) })}
                  placeholder="120 (0 = non)"
                />
              </div>

              <div style={{ paddingTop: 16 }}>
                <button
                  className="btn-ghost btn-danger"
                  type="button"
                  onClick={() => removeRoom(index)}
                  title="Supprimer ce salon"
                >
                  <span className="material-symbols-outlined" style={{ fontSize: 18 }}>
                    delete
                  </span>
                </button>
              </div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
          <button className="btn-ghost" type="button" onClick={addRoom}>
            <span className="material-symbols-outlined" aria-hidden="true">
              add
            </span>{' '}
            Ajouter un salon d'accueil
          </button>
          <button
            className="btn-primary"
            type="button"
            onClick={saveBaseRooms}
            disabled={savingBaseRooms}
          >
            Enregistrer les salons d'accueil
          </button>
        </div>

        {baseRoomsError && <p className="error-text">{baseRoomsError}</p>}
        {baseRoomsStatus && <p className="status-text">{baseRoomsStatus}</p>}
      </section>
    </div>
  );
}
