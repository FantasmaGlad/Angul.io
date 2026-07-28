import { modeMeta } from '../modes.js';
import type { RoomSummary } from '../lobby.js';

interface ModeRoomListProps {
  modes: string[];
  rooms: RoomSummary[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  onJoinRoom: (roomId: string) => void;
}

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
      <div className="mode-selector-header">
        <span className="section-title">SELECTION DU MODE</span>
        <div className="mode-tabs-vertical">
          {modes.map((modeId) => {
            const meta = modeMeta(modeId);
            const count = rooms
              .filter((r) => r.modId === modeId)
              .reduce((sum, r) => sum + r.playerCount, 0);
            const isSelected = selectedMode === modeId;

            return (
              <button
                key={modeId}
                type="button"
                className={`mode-tab-item ${isSelected ? 'active' : ''}`}
                onClick={() => onSelectMode(modeId)}
              >
                <div className="mode-tab-info">
                  <span className="mode-tab-label">{meta.label}</span>
                  <span className="mode-tab-count">{count} joueurs</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="mode-rooms-container">
        <span className="section-subtitle">SALONS DISPONIBLES</span>
        <ol className="rank-list">
          {filtered.length === 0 ? (
            <li className="rank-list-empty">Aucun salon public actif pour ce mode.</li>
          ) : (
            filtered.map((room, index) => (
              <li key={room.id}>
                <button type="button" className="rank-row" onClick={() => onJoinRoom(room.id)}>
                  <span className="rank-index">#{index + 1}</span>
                  <span className="rank-name">{room.name}</span>
                  <span className="rank-count">
                    {room.playerCount}/{room.maxPlayers}
                  </span>
                </button>
              </li>
            ))
          )}
        </ol>
      </div>
    </section>
  );
}
