import { useEffect, useState } from 'react';
import {
  applyBaseRooms,
  diffBaseRooms,
  getBaseRooms,
  getBotBehavior,
  getModConfig,
  listBotBehaviors,
  listModes,
  updateBotBehavior,
  updateModConfig,
  type ApiFieldError,
  type BaseRoomConfig,
  type RoomDiffResult,
} from '../adminApi.js';
import JsonConfigEditor from './JsonConfigEditor.js';

interface ConfigurationViewProps {
  token: string;
  onAuthError: (error: unknown) => void;
}

export default function ConfigurationView({ token, onAuthError }: ConfigurationViewProps) {
  // Salons permanents
  const [modes, setModes] = useState<string[]>([]);
  const [modDefaults, setModDefaults] = useState<
    Record<string, { mapSize: number; maxPlayers: number; resetDurationMin: number }>
  >({});
  const [baseRooms, setBaseRooms] = useState<BaseRoomConfig[]>([]);
  const [baseRoomsError, setBaseRoomsError] = useState('');
  const [baseRoomsStatus, setBaseRoomsStatus] = useState('');
  const [diffingBaseRooms, setDiffingBaseRooms] = useState(false);
  const [applyingBaseRooms, setApplyingBaseRooms] = useState(false);

  // Modale de diff
  const [showDiffModal, setShowDiffModal] = useState(false);
  const [pendingDiff, setPendingDiff] = useState<RoomDiffResult[]>([]);

  // Panneau Édition JSON Mods
  const [selectedModForJson, setSelectedModForJson] = useState<string>('');
  const [modConfigJson, setModConfigJson] = useState<unknown>(undefined);

  // Panneau Édition JSON Profils Bots
  const [botBehaviorIds, setBotBehaviorIds] = useState<string[]>([]);
  const [selectedBehaviorId, setSelectedBehaviorId] = useState<string>('');
  const [behaviorConfigJson, setBehaviorConfigJson] = useState<unknown>(undefined);

  // Initialisation des données
  useEffect(() => {
    void (async () => {
      try {
        const modesList = await listModes();
        setModes(modesList);
        if (modesList[0] && !selectedModForJson) {
          setSelectedModForJson(modesList[0]);
        }

        // Chargement dynamique des propriétés par défaut de chaque mode
        const configs = await Promise.all(
          modesList.map(async (modId) => {
            try {
              const cfg = await getModConfig(token, modId);
              const mapSize = cfg.arena?.width ?? 15000;
              const maxPlayers = cfg.room?.maxPlayers ?? 30;
              const resetDurationMin =
                cfg.room?.resetSchedule?.type === 'everyNMinutes'
                  ? cfg.room.resetSchedule.minutes
                  : cfg.room?.resetSchedule === null
                    ? 0
                    : 120;
              return [modId, { mapSize, maxPlayers, resetDurationMin }] as const;
            } catch {
              return [modId, { mapSize: 15000, maxPlayers: 30, resetDurationMin: 120 }] as const;
            }
          }),
        );
        setModDefaults(Object.fromEntries(configs));
      } catch (err) {
        setBaseRoomsError((err as Error).message);
      }
    })();

    void (async () => {
      try {
        setBaseRooms(await getBaseRooms(token));
      } catch (err) {
        setBaseRoomsError((err as Error).message);
        onAuthError(err);
      }
    })();

    void (async () => {
      try {
        const behaviors = await listBotBehaviors(token);
        setBotBehaviorIds(behaviors);
        if (behaviors[0] && !selectedBehaviorId) {
          setSelectedBehaviorId(behaviors[0]);
        }
      } catch {
        // Optionnel : ne bloque pas la vue principale si indisponible
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Chargement de la config JSON du mod sélectionné
  useEffect(() => {
    if (!selectedModForJson) return;
    void (async () => {
      try {
        const cfg = await getModConfig(token, selectedModForJson);
        setModConfigJson(cfg);
      } catch {
        setModConfigJson(undefined);
      }
    })();
  }, [token, selectedModForJson]);

  // Chargement du profil de bot sélectionné
  useEffect(() => {
    if (!selectedBehaviorId) return;
    void (async () => {
      try {
        const cfg = await getBotBehavior(token, selectedBehaviorId);
        setBehaviorConfigJson(cfg);
      } catch {
        setBehaviorConfigJson(undefined);
      }
    })();
  }, [token, selectedBehaviorId]);

  const updateRoom = (index: number, patch: Partial<BaseRoomConfig>): void => {
    setBaseRooms((rooms) =>
      rooms.map((room, i) => {
        if (i !== index) return room;
        const updated = { ...room, ...patch };
        const defaults = patch.modId ? modDefaults[patch.modId] : undefined;
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
    const defaults = modDefaults[defaultMod] ?? {
      mapSize: 15000,
      maxPlayers: 30,
      resetDurationMin: 120,
    };
    setBaseRooms((rooms) => [
      ...rooms,
      {
        name: '',
        modId: defaultMod,
        mapSize: defaults.mapSize,
        maxPlayers: defaults.maxPlayers,
        resetDurationMin: defaults.resetDurationMin,
      },
    ]);
  };

  const handlePrepareApply = async (): Promise<void> => {
    const trimmed = baseRooms.map((room) => ({
      ...room,
      name: room.name.trim(),
      modId: room.modId,
      mapSize: Number(room.mapSize) || 15000,
      maxPlayers: Number(room.maxPlayers) || 30,
      resetDurationMin: Number(room.resetDurationMin) || 0,
    }));

    if (trimmed.some((room) => !room.name || !room.modId)) {
      setBaseRoomsError('Chaque salon nécessite un nom non vide et un mode.');
      return;
    }

    setDiffingBaseRooms(true);
    setBaseRoomsError('');
    setBaseRoomsStatus('');

    try {
      const diff = await diffBaseRooms(token, trimmed);
      setPendingDiff(diff);
      setShowDiffModal(true);
    } catch (err) {
      setBaseRoomsError((err as Error).message);
    } finally {
      setDiffingBaseRooms(false);
    }
  };

  const handleConfirmApply = async (): Promise<void> => {
    const trimmed = baseRooms.map((room) => ({
      ...room,
      name: room.name.trim(),
      modId: room.modId,
      mapSize: Number(room.mapSize) || 15000,
      maxPlayers: Number(room.maxPlayers) || 30,
      resetDurationMin: Number(room.resetDurationMin) || 0,
    }));

    setApplyingBaseRooms(true);
    try {
      const res = await applyBaseRooms(token, trimmed);
      setBaseRooms(res.rooms);
      setShowDiffModal(false);
      setBaseRoomsStatus(
        'Changements appliqués avec succès aux salons vivants et sauvegardés dans server/rooms.local.json.',
      );
    } catch (err) {
      setBaseRoomsError((err as Error).message);
      setShowDiffModal(false);
    } finally {
      setApplyingBaseRooms(false);
    }
  };

  const handleSaveModJson = async (
    parsed: unknown,
  ): Promise<{ success: boolean; note?: string; errors?: ApiFieldError[] }> => {
    return updateModConfig(token, selectedModForJson, parsed);
  };

  const handleSaveBehaviorJson = async (
    parsed: unknown,
  ): Promise<{ success: boolean; note?: string; errors?: ApiFieldError[] }> => {
    const res = await updateBotBehavior(token, selectedBehaviorId, parsed);
    return { success: res.success, note: `Profil de bot "${res.behaviorId}" enregistré.` };
  };

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Configuration des Salons Permanents & Paramètres</h2>
          <p className="view-subtitle">
            Édition fine des salons d'accueil (synchro à chaud), configurations de mods et profils
            de bots.
          </p>
        </div>
      </div>

      {/* SALONS PERMANENTS (ACCUEIL) */}
      <section className="panel">
        <span className="section-title" style={{ marginTop: 0 }}>
          Salons d'Accueil Permanents (`server/rooms.local.json`)
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 16 }}>
          Personnalisez le nom, le mode, la taille de l'arène, la capacité maximale et le reset.
          Les modifications sont appliquées à chaud en direct.
        </p>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {baseRooms.map((room, index) => (
            <div
              key={room.id ?? `draft-${index}`}
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
            onClick={() => void handlePrepareApply()}
            disabled={diffingBaseRooms}
          >
            {diffingBaseRooms ? 'Calcul du diff…' : 'Appliquer les changements'}
          </button>
        </div>

        {baseRoomsError && <p className="error-text" style={{ marginTop: 12 }}>{baseRoomsError}</p>}
        {baseRoomsStatus && <p className="status-text" style={{ marginTop: 12 }}>{baseRoomsStatus}</p>}
      </section>

      {/* PANNEAU JSON MODS */}
      <section className="panel" style={{ marginTop: 24 }}>
        <span className="section-title" style={{ marginTop: 0 }}>
          Éditeur de Configuration des Mods (`server/configs/&lt;modId&gt;.json`)
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
          Modifiez les paramètres physiques, règles de division et de spawn de chaque mode. Validation stricte du schéma.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <label style={{ fontWeight: 600, fontSize: 13 }}>Sélectionner un mode :</label>
          <select
            value={selectedModForJson}
            onChange={(e) => setSelectedModForJson(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-strong)',
              minWidth: 200,
            }}
          >
            {modes.map((modId) => (
              <option key={modId} value={modId}>
                {modId}
              </option>
            ))}
          </select>
        </div>

        {modConfigJson !== undefined ? (
          <JsonConfigEditor
            title={`Mode : ${selectedModForJson}`}
            value={modConfigJson}
            onSave={handleSaveModJson}
          />
        ) : (
          <p className="view-subtitle" style={{ marginTop: 12 }}>Chargement de la configuration du mode…</p>
        )}
      </section>

      {/* PANNEAU JSON BOTS */}
      <section className="panel" style={{ marginTop: 24 }}>
        <span className="section-title" style={{ marginTop: 0 }}>
          Éditeur de Profils de Comportement des Bots (`server/configs/bots/*.json`)
        </span>
        <p className="view-subtitle" style={{ marginTop: 4, marginBottom: 12 }}>
          Ajustez l'agressivité, la fuite et l'esquive des murs pour les profils d'IA.
        </p>

        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
          <label style={{ fontWeight: 600, fontSize: 13 }}>Profil de comportement :</label>
          <select
            value={selectedBehaviorId}
            onChange={(e) => setSelectedBehaviorId(e.target.value)}
            style={{
              padding: '6px 12px',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--border-strong)',
              minWidth: 200,
            }}
          >
            {botBehaviorIds.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </select>
        </div>

        {behaviorConfigJson !== undefined ? (
          <JsonConfigEditor
            title={`Profil Bot : ${selectedBehaviorId}`}
            value={behaviorConfigJson}
            onSave={handleSaveBehaviorJson}
          />
        ) : (
          <p className="view-subtitle" style={{ marginTop: 12 }}>Chargement du profil de bot…</p>
        )}
      </section>

      {/* MODALE DE CONFIRMATION DU DIFF */}
      {showDiffModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.6)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
            backdropFilter: 'blur(4px)',
          }}
        >
          <div
            style={{
              background: 'var(--bg-panel, #252836)',
              border: '1px solid var(--border-strong, #3b3f54)',
              borderRadius: 12,
              padding: 24,
              maxWidth: 650,
              width: '90%',
              maxHeight: '80vh',
              overflowY: 'auto',
              boxShadow: '0 20px 25px -5px rgba(0, 0, 0, 0.5)',
            }}
          >
            <h3 style={{ marginTop: 0, marginBottom: 8, fontSize: 18 }}>
              Confirmation des changements de salons d'accueil
            </h3>
            <p style={{ fontSize: 13, color: 'var(--text-secondary, #9ca3af)', marginBottom: 16 }}>
              Voici la liste des impacts identifiés avant application. Les réorganisations s'exécutent en direct.
            </p>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 20 }}>
              {pendingDiff.map((entry, idx) => {
                let badgeBg = 'rgba(156, 163, 175, 0.2)';
                let badgeColor = '#9ca3af';
                let label = 'Inchangé';
                let hasWarning = false;

                if (entry.status === 'created') {
                  badgeBg = 'rgba(59, 130, 246, 0.2)';
                  badgeColor = '#60a5fa';
                  label = 'Sera créé';
                } else if (entry.status === 'hot-reconfigured') {
                  badgeBg = 'rgba(34, 197, 94, 0.2)';
                  badgeColor = '#4ade80';
                  label = 'Reconfiguré à chaud (aucune expulsion)';
                } else if (entry.status === 'recreated') {
                  badgeBg = 'rgba(249, 115, 22, 0.2)';
                  badgeColor = '#fb923c';
                  label = `Recréé — expulse ${entry.affectedPlayers} joueur(s)`;
                  hasWarning = true;
                } else if (entry.status === 'closed') {
                  badgeBg = 'rgba(239, 68, 68, 0.2)';
                  badgeColor = '#f87171';
                  label = `Fermé — expulse ${entry.affectedPlayers} joueur(s)`;
                  hasWarning = true;
                }

                return (
                  <div
                    key={idx}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '10px 14px',
                      borderRadius: 8,
                      background: hasWarning ? 'rgba(239, 68, 68, 0.08)' : 'rgba(0, 0, 0, 0.15)',
                      border: hasWarning ? '1px solid rgba(239, 68, 68, 0.3)' : '1px solid var(--border-subtle, #333)',
                    }}
                  >
                    <div style={{ fontWeight: 600, fontSize: 14 }}>{entry.name}</div>
                    <span
                      style={{
                        padding: '4px 10px',
                        borderRadius: 12,
                        fontSize: 12,
                        fontWeight: 600,
                        background: badgeBg,
                        color: badgeColor,
                      }}
                    >
                      {label}
                    </span>
                  </div>
                );
              })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => setShowDiffModal(false)}
                disabled={applyingBaseRooms}
              >
                Annuler
              </button>
              <button
                className="btn-primary"
                type="button"
                onClick={() => void handleConfirmApply()}
                disabled={applyingBaseRooms}
              >
                {applyingBaseRooms ? 'Application en cours…' : 'Confirmer et appliquer'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
