import { useEffect, useState } from 'react';
import { getBaseRooms, listModes, updateBaseRooms, type BaseRoomConfig } from '../adminApi.js';

interface ConfigurationViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

/** Module Configuration (§13 cahier_des_charges_admin.md) :
 * - Profils de mods chargés (`server/configs/*.json`) : consultation seule — l'édition fine des
 *   paramètres d'un mod (taille d'arène, vitesse, densité de nourriture...) demande une route
 *   admin dédiée, pas encore construite (Phase 4, §16).
 * - Salons permanents de l'accueil (`server/rooms.json`, §8.4) : liste ET mode attribué à chacun
 *   sont ÉDITABLES ici (retour utilisateur : "vérifie que les salons principaux ne sont pas
 *   hardcodés... et qu'ils peuvent être modifiés via un json relié à l'interface admin") — un
 *   changement ne prend effet qu'au prochain redémarrage du serveur (les salons déjà démarrés ne
 *   sont pas recréés/fermés à la volée, voir server/src/roomsConfig.ts) : le bandeau de
 *   confirmation le dit explicitement pour ne pas laisser croire à un effet immédiat. */
export default function ConfigurationView({ token, onAuthError }: ConfigurationViewProps) {
  const [modes, setModes] = useState<string[]>([]);
  const [error, setError] = useState('');

  const [baseRooms, setBaseRooms] = useState<BaseRoomConfig[]>([]);
  const [baseRoomsError, setBaseRoomsError] = useState('');
  const [baseRoomsStatus, setBaseRoomsStatus] = useState('');
  const [savingBaseRooms, setSavingBaseRooms] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        setModes(await listModes());
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
        setBaseRoomsStatus(result.note);
      })
      .catch((err: unknown) => setBaseRoomsError((err as Error).message))
      .finally(() => setSavingBaseRooms(false));
  };

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Configuration</h2>
          <p className="view-subtitle">Salons permanents de l'accueil et profils de mods disponibles.</p>
        </div>
      </div>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Salons permanents (accueil)
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
          Liste et mode de chaque salon créé au démarrage du serveur — un changement ne s'applique
          qu'au prochain redémarrage.
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
            Enregistrer
          </button>
        </div>
        <p className="error-text">{baseRoomsError}</p>
        <p className="status-text">{baseRoomsStatus}</p>
      </section>

      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Profils de mods chargés
        </span>
        <ul className="config-list">
          {modes.length === 0 && !error ? (
            <li>Chargement…</li>
          ) : (
            modes.map((modId) => (
              <li key={modId}>
                <span style={{ fontWeight: 700 }}>{modId}</span>
                <span className="badge">server/configs/{modId}.json</span>
              </li>
            ))
          )}
        </ul>
        <p className="error-text">{error}</p>
      </section>

      <section className="panel">
        <div className="placeholder">
          <span className="placeholder-tag">Bientôt disponible</span>
          <p>
            L'édition fine des paramètres d'un mod (taille d'arène, vitesse, nourriture, bots...)
            demande une route admin dédiée, prévue en Phase 4 de la feuille de route (§16), pas
            encore construite.
          </p>
        </div>
      </section>
    </div>
  );
}
