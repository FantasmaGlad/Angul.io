import { modeMeta } from '../modes.js';
import type { RoomSummary } from '../lobby.js';

interface ModeRoomListProps {
  modes: string[];
  rooms: RoomSummary[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  onJoinRoom: (roomId: string) => void;
}

/** Colonne gauche de l'accueil (refonte UI/UX, mockup fourni) : sélecteur de mode + classement
 * des salons publics de ce mode (par nombre de joueurs décroissant). Distincte du classement
 * global tous modes confondus de `PlayPanel.tsx` (colonne centre). */
export default function ModeRoomList({
  modes,
  rooms,
  selectedMode,
  onSelectMode,
  onJoinRoom,
}: ModeRoomListProps) {
  const filtered = rooms
    .filter((room) => room.modId === selectedMode)
    .sort((a, b) => b.playerCount - a.playerCount);

  return (
    <section className="home-column mode-room-list">
      <label className="mode-select-field">
        <span className="field-label">Mode de jeu</span>
        <select value={selectedMode} onChange={(event) => onSelectMode(event.target.value)}>
          {modes.map((modeId) => (
            <option key={modeId} value={modeId}>
              {modeMeta(modeId).label}
            </option>
          ))}
        </select>
      </label>

      <ol className="rank-list">
        {filtered.length === 0 ? (
          <li className="rank-list-empty">Aucun salon public pour ce mode.</li>
        ) : (
          filtered.map((room, index) => (
            <li key={room.id}>
              <button type="button" className="rank-row" onClick={() => onJoinRoom(room.id)}>
                <span className="rank-index">{index + 1}</span>
                <span className="rank-name">{room.name}</span>
                <span className="rank-count">
                  {room.playerCount}/{room.maxPlayers}
                </span>
              </button>
            </li>
          ))
        )}
      </ol>
    </section>
  );
}
