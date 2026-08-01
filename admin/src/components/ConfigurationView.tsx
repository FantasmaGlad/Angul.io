import { useEffect, useState } from 'react';
import {
  getBaseRooms,
  getModConfig,
  listModes,
  reloadServerSync,
  updateBaseRooms,
  updateModConfig,
  type BaseRoomConfig,
} from '../adminApi.js';

interface ConfigurationViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

export default function ConfigurationView({ token, onAuthError }: ConfigurationViewProps) {
  const [modes, setModes] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [baseRooms, setBaseRooms] = useState<BaseRoomConfig[]>([]);
  const [baseRoomsError, setBaseRoomsError] = useState('');
  const [baseRoomsStatus, setBaseRoomsStatus] = useState('');
  const [savingBaseRooms, setSavingBaseRooms] = useState(false);

  // Serveur & Synchronisation
  const [syncStatus, setSyncStatus] = useState('');
  const [syncError, setSyncError] = useState('');
  const [reloadingServer, setReloadingServer] = useState(false);

  // Édition de mod
  const [selectedModId, setSelectedModId] = useState<string>('vanilla');
  const [modConfig, setModConfig] = useState<any>(null);
  const [loadingModConfig, setLoadingModConfig] = useState(false);
  const [modConfigStatus, setModConfigStatus] = useState('');
  const [modConfigError, setModConfigError] = useState('');
  const [savingModConfig, setSavingModConfig] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const loadedModes = await listModes();
        setModes(loadedModes);
        if (loadedModes.length > 0) {
          setSelectedModId(loadedModes[0]!);
        }
      } catch (err) {
        setError((err as Error).message);
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

  // Charge la config du mod sélectionné
  useEffect(() => {
    if (!selectedModId) return;
    setLoadingModConfig(true);
    setModConfigStatus('');
    setModConfigError('');
    void getModConfig(token, selectedModId)
      .then((cfg) => setModConfig(cfg))
      .catch((err: unknown) => setModConfigError((err as Error).message))
      .finally(() => setLoadingModConfig(false));
  }, [token, selectedModId]);

  const updateRoom = (index: number, patch: Partial<BaseRoomConfig>): void => {
    setBaseRooms((rooms) => rooms.map((room, i) => (i === index ? { ...room, ...patch } : room)));
  };

  const removeRoom = (index: number): void => {
    setBaseRooms((rooms) => rooms.filter((_, i) => i !== index));
  };

  const addRoom = (): void => {
    setBaseRooms((rooms) => [...rooms, { name: '', modId: modes[0] ?? '' }]);
  };

  const saveBaseRooms = (): void => {
    const trimmed = baseRooms.map((room) => ({ name: room.name.trim(), modId: room.modId }));
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
        setBaseRoomsStatus(result.note ?? 'Sauvegardé dans server/rooms.local.json (non-synchronisé avec git).');
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

  const handleSaveModConfig = (): void => {
    if (!selectedModId || !modConfig) return;
    setSavingModConfig(true);
    setModConfigError('');
    setModConfigStatus('');
    void updateModConfig(token, selectedModId, modConfig)
      .then((res) => setModConfigStatus(res.note))
      .catch((err: unknown) => setModConfigError((err as Error).message))
      .finally(() => setSavingModConfig(false));
  };

  const updateNestedModConfig = (path: string[], value: any): void => {
    setModConfig((prev: any) => {
      if (!prev) return prev;
      const copy = JSON.parse(JSON.stringify(prev));
      let current = copy;
      for (let i = 0; i < path.length - 1; i++) {
        const key = path[i]!;
        if (!current[key]) current[key] = {};
        current = current[key];
      }
      current[path[path.length - 1]!] = value;
      return copy;
    });
  };

  return (
    <div className="view">
      <div className="top-bar" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2>Configuration v6.1</h2>
          <p className="view-subtitle">Salons permanents de l'accueil, rechargement serveur & édition fine des mods.</p>
        </div>
        <button
          className="btn-primary"
          type="button"
          onClick={handleServerReload}
          disabled={reloadingServer}
          style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 16px' }}
        >
          <span className={`material-symbols-outlined ${reloadingServer ? 'spinning' : ''}`}>sync</span>
          {reloadingServer ? 'Synchronisation…' : 'Synchroniser & Redémarrer les Salons'}
        </button>
      </div>

      {syncStatus && <div className="status-text" style={{ padding: '8px 12px', background: 'rgba(46, 139, 87, 0.15)', borderRadius: 8, marginBottom: 12 }}>{syncStatus}</div>}
      {syncError && <div className="error-text" style={{ padding: '8px 12px', background: 'rgba(255, 0, 0, 0.15)', borderRadius: 8, marginBottom: 12 }}>{syncError}</div>}

      {/* SALONS PERMANENTS (ACCUEIL) */}
      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Salons permanents (accueil) — Persistent dans `server/rooms.local.json`
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
          Sauvegardés hors git (`rooms.local.json`) pour préserver vos salons lors des déploiements et mises à jour.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {baseRooms.map((room, index) => (
            <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <input
                value={room.name}
                onChange={(e) => updateRoom(index, { name: e.target.value })}
                placeholder="Nom du salon"
                style={{ flex: 1 }}
              />
              <select
                value={room.modId}
                onChange={(e) => updateRoom(index, { modId: e.target.value })}
                style={{ padding: 8, borderRadius: 'var(--radius-md)', border: '1px solid var(--border-strong)' }}
              >
                {!modes.includes(room.modId) && room.modId && <option value={room.modId}>{room.modId}</option>}
                {modes.map((modId) => (
                  <option key={modId} value={modId}>
                    {modId}
                  </option>
                ))}
              </select>
              <button className="btn-ghost btn-danger" type="button" onClick={() => removeRoom(index)}>
                <span className="material-symbols-outlined" style={{ fontSize: 16 }}>delete</span>
              </button>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12 }}>
          <button className="btn-ghost" type="button" onClick={addRoom}>
            <span className="material-symbols-outlined" aria-hidden="true">add</span> Ajouter un salon
          </button>
          <button className="btn-primary" type="button" onClick={saveBaseRooms} disabled={savingBaseRooms}>
            Enregistrer les salons d'accueil
          </button>
        </div>
        <p className="error-text">{baseRoomsError}</p>
        <p className="status-text">{baseRoomsStatus}</p>
      </section>

      {/* ÉDITION FINE DES PARAMÈTRES DU MOD */}
      <section className="panel">
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <div>
            <span className="section-title" style={{ marginTop: 0 }}>Éditeur de Mod (ParametricModConfig)</span>
            <p className="view-subtitle" style={{ marginTop: 2 }}>
              Sélectionnez un mod pour modifier ses constantes physiques, sa carte, sa nourriture et ses bots.
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <label style={{ fontWeight: 600 }}>Mod : </label>
            <select
              value={selectedModId}
              onChange={(e) => setSelectedModId(e.target.value)}
              style={{ padding: '6px 12px', borderRadius: 'var(--radius-md)', fontWeight: 600 }}
            >
              {modes.map((modId) => (
                <option key={modId} value={modId}>
                  {modId}
                </option>
              ))}
            </select>
          </div>
        </div>

        {loadingModConfig ? (
          <p>Chargement du mod {selectedModId}…</p>
        ) : !modConfig ? (
          <p className="error-text">Impossible de charger le mod.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            {/* Formulaire arène & physique */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16 }}>
              {/* ARÈNE */}
              <fieldset style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>Arène (`arena`)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Largeur (px):
                    <input
                      type="number"
                      value={modConfig.arena?.width ?? 15000}
                      onChange={(e) => updateNestedModConfig(['arena', 'width'], Number(e.target.value))}
                      style={{ width: 120 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Hauteur (px):
                    <input
                      type="number"
                      value={modConfig.arena?.height ?? 15000}
                      onChange={(e) => updateNestedModConfig(['arena', 'height'], Number(e.target.value))}
                      style={{ width: 120 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Type de bord:
                    <select
                      value={modConfig.arena?.borderType ?? 'STRICT_WALL'}
                      onChange={(e) => updateNestedModConfig(['arena', 'borderType'], e.target.value)}
                      style={{ width: 130 }}
                    >
                      <option value="STRICT_WALL">STRICT_WALL</option>
                      <option value="ELASTIC_BOUNCE">ELASTIC_BOUNCE</option>
                      <option value="TOROIDAL">TOROIDAL</option>
                      <option value="TOXIC_ZONE">TOXIC_ZONE</option>
                    </select>
                  </label>
                </div>
              </fieldset>

              {/* PHYSIQUE */}
              <fieldset style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>Physique (`physics`)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Vitesse initiale V0:
                    <input
                      type="number"
                      value={modConfig.physics?.v0 ?? 300}
                      onChange={(e) => updateNestedModConfig(['physics', 'v0'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Multiplicateur vitesse:
                    <input
                      type="number"
                      step="0.1"
                      value={modConfig.physics?.speedMultiplier ?? 1.0}
                      onChange={(e) => updateNestedModConfig(['physics', 'speedMultiplier'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Exposant masse/vitesse:
                    <input
                      type="number"
                      step="0.01"
                      value={modConfig.physics?.speedMassExponent ?? 0.44}
                      onChange={(e) => updateNestedModConfig(['physics', 'speedMassExponent'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Vitesse plancher:
                    <input
                      type="number"
                      value={modConfig.physics?.velocityFloor ?? 40}
                      onChange={(e) => updateNestedModConfig(['physics', 'velocityFloor'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                </div>
              </fieldset>

              {/* JOUEURS */}
              <fieldset style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>Joueurs (`player`)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Masse initiale M0:
                    <input
                      type="number"
                      value={modConfig.player?.startMass ?? 50}
                      onChange={(e) => updateNestedModConfig(['player', 'startMass'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Splits max (Smax):
                    <input
                      type="number"
                      value={modConfig.player?.maxSplits ?? 16}
                      onChange={(e) => updateNestedModConfig(['player', 'maxSplits'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Masse min split:
                    <input
                      type="number"
                      value={modConfig.player?.minSplitMass ?? 100}
                      onChange={(e) => updateNestedModConfig(['player', 'minSplitMass'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Activer Split:
                    <input
                      type="checkbox"
                      checked={modConfig.player?.splitEnabled ?? true}
                      onChange={(e) => updateNestedModConfig(['player', 'splitEnabled'], e.target.checked)}
                    />
                  </label>
                </div>
              </fieldset>

              {/* NOURRITURE */}
              <fieldset style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>Nourriture (`food`)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Densité (par 1000x1000px²):
                    <input
                      type="number"
                      value={modConfig.food?.density ?? 60}
                      onChange={(e) => updateNestedModConfig(['food', 'density'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Respawn / sec:
                    <input
                      type="number"
                      value={modConfig.food?.respawnRatePerSecond ?? 20}
                      onChange={(e) => updateNestedModConfig(['food', 'respawnRatePerSecond'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Masse éjection:
                    <input
                      type="number"
                      value={modConfig.eject?.amount ?? 5}
                      onChange={(e) => updateNestedModConfig(['eject', 'amount'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                </div>
              </fieldset>

              {/* BOTS */}
              <fieldset style={{ border: '1px solid var(--border-strong)', borderRadius: 8, padding: 12 }}>
                <legend style={{ fontWeight: 700, padding: '0 6px' }}>Robots (`bots`)</legend>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Activer les bots:
                    <input
                      type="checkbox"
                      checked={modConfig.bots?.enabled ?? true}
                      onChange={(e) => updateNestedModConfig(['bots', 'enabled'], e.target.checked)}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Profil de comportement:
                    <input
                      type="text"
                      value={modConfig.bots?.behaviorId ?? 'default'}
                      onChange={(e) => updateNestedModConfig(['bots', 'behaviorId'], e.target.value)}
                      style={{ width: 120 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Bots ambiants (0 humain):
                    <input
                      type="number"
                      value={modConfig.bots?.ambientTargetCount ?? 6}
                      onChange={(e) => updateNestedModConfig(['bots', 'ambientTargetCount'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                  <label style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    Plafond total bots (maxTotal):
                    <input
                      type="number"
                      value={modConfig.bots?.maxTotal ?? 15}
                      onChange={(e) => updateNestedModConfig(['bots', 'maxTotal'], Number(e.target.value))}
                      style={{ width: 100 }}
                    />
                  </label>
                </div>
              </fieldset>
            </div>

            <div style={{ display: 'flex', gap: 12, marginTop: 8 }}>
              <button
                className="btn-primary"
                type="button"
                onClick={handleSaveModConfig}
                disabled={savingModConfig}
              >
                Enregistrer la configuration du mod {selectedModId}
              </button>
            </div>
            {modConfigStatus && <p className="status-text">{modConfigStatus}</p>}
            {modConfigError && <p className="error-text">{modConfigError}</p>}
          </div>
        )}
      </section>
    </div>
  );
}
