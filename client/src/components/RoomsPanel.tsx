import { useEffect, useState } from 'react';
import { createRoom, type RoomSummary } from '../lobby.js';
import { modeMeta } from '../modes.js';
import Panel from './Panel.js';

interface RoomsPanelProps {
  onClose: () => void;
  rooms: RoomSummary[];
  modes: string[];
  lobbyError: string;
  onRefresh: () => Promise<void>;
  authToken: string | undefined;
  isPremium: boolean;
  isLoggedIn: boolean;
  onJoinRoom: (roomIdOrInviteCode: string, inviteCodeToShow?: string) => void;
  onOpenSupport: () => void;
}

/** Salons (Lot 2.2/2.3, §4.2 cahier_des_charges_ui_ux.md) : liste publique, création (réservée
 * Premium — Lot 6.4), rejoindre via code. */
export default function RoomsPanel({
  onClose,
  rooms,
  modes,
  lobbyError,
  onRefresh,
  authToken,
  isPremium,
  isLoggedIn,
  onJoinRoom,
  onOpenSupport,
}: RoomsPanelProps) {
  const [roomName, setRoomName] = useState('');
  const [selectedMode, setSelectedMode] = useState('');
  const [isPrivate, setIsPrivate] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [formError, setFormError] = useState('');

  useEffect(() => {
    if (modes.length > 0 && !modes.includes(selectedMode)) setSelectedMode(modes[0]!);
  }, [modes, selectedMode]);

  const canCreateRoom = isLoggedIn && isPremium;

  const handleCreate = (): void => {
    void (async () => {
      const name = roomName.trim();
      if (!name) {
        setFormError('Le nom du salon est requis.');
        return;
      }
      try {
        // Un salon privé ne se rejoint jamais par son id brut (roomManager.ts) : seul le code
        // d'invitation y donne accès, y compris pour son propre créateur.
        const room = await createRoom(
          name,
          selectedMode,
          isPrivate ? 'private' : 'public',
          authToken,
        );
        onJoinRoom(room.inviteCode ?? room.id, room.inviteCode);
      } catch (error) {
        setFormError((error as Error).message);
      }
    })();
  };

  const handleJoinCode = (): void => {
    const code = joinCode.trim();
    if (!code) {
      setFormError("Le code d'invitation est requis.");
      return;
    }
    onJoinRoom(code);
  };

  return (
    <Panel title="Salons" onClose={onClose}>
      <section className="lobby-section">
        <div className="section-header">
          <span className="section-title">Salons publics</span>
          <button className="btn-ghost" type="button" onClick={() => void onRefresh()}>
            Actualiser
          </button>
        </div>
        <ul className="room-list">
          {rooms.length === 0 ? (
            <li>Aucun salon public pour le moment — créez-en un ci-dessous.</li>
          ) : (
            rooms.map((room) => (
              <li key={room.id}>
                <span className="room-label">
                  <span className="mode-dot" style={{ background: modeMeta(room.modId).color }} />
                  <span>
                    {room.name} — {room.playerCount} joueur(s)
                  </span>
                </span>
                <button type="button" onClick={() => onJoinRoom(room.id)}>
                  Rejoindre
                </button>
              </li>
            ))
          )}
        </ul>
      </section>

      <section className="lobby-section">
        <span className="section-title">Créer un salon</span>
        {canCreateRoom ? (
          <div>
            <input
              value={roomName}
              onChange={(event) => setRoomName(event.target.value)}
              placeholder="Nom du salon"
              maxLength={40}
              style={{ marginBottom: 12 }}
            />
            <div className="field-row">
              <select
                value={selectedMode}
                onChange={(event) => setSelectedMode(event.target.value)}
              >
                {modes.map((modeId) => (
                  <option key={modeId} value={modeId}>
                    {modeMeta(modeId).label}
                  </option>
                ))}
              </select>
              <label className="checkbox-field">
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(event) => setIsPrivate(event.target.checked)}
                />
                <span>Privé</span>
              </label>
            </div>
            <button
              className="btn-primary"
              type="button"
              onClick={handleCreate}
              style={{ width: '100%' }}
            >
              Créer et rejoindre
            </button>
          </div>
        ) : (
          <p className="account-status">
            Réservé aux comptes <strong>Premium</strong> (don libre, voir{' '}
            <button className="btn-ghost" type="button" onClick={onOpenSupport}>
              Soutenir
            </button>
            ).
          </p>
        )}
      </section>

      <section className="lobby-section">
        <span className="section-title">Rejoindre via code</span>
        <div className="field-row">
          <input
            value={joinCode}
            onChange={(event) => setJoinCode(event.target.value)}
            placeholder="Code d'invitation"
            maxLength={6}
            inputMode="numeric"
          />
          <button className="btn-ghost" type="button" onClick={handleJoinCode}>
            Rejoindre
          </button>
        </div>
      </section>

      <p className="error-text">{formError || lobbyError}</p>
    </Panel>
  );
}
