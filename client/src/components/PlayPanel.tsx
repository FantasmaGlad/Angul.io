import type { ChangeEvent } from 'react';
import type { RoomSummary } from '../lobby.js';

const GLOBAL_RANKING_SIZE = 5;

interface PlayPanelProps {
  playersOnline: number | undefined;
  nickname: string;
  onNicknameChange: (value: string) => void;
  onPlay: () => void;
  homeError: string;
  rooms: RoomSummary[];
  onJoinRoom: (roomId: string) => void;
}

export default function PlayPanel({
  playersOnline,
  nickname,
  onNicknameChange,
  onPlay,
  homeError,
  rooms,
  onJoinRoom,
}: PlayPanelProps) {
  const topRooms = [...rooms]
    .sort((a, b) => b.playerCount - a.playerCount)
    .slice(0, GLOBAL_RANKING_SIZE);

  return (
    <section className="home-column play-panel">
      <div className="players-online-header">
        <span className="players-online-count">{playersOnline ?? '—'}</span>
        <span className="players-online-label">JOUEURS EN LIGNE</span>
      </div>

      <div className="launcher-form">
        <label className="field">
          <span className="field-label">PSEUDO DE JEU</span>
          <input
            className="clean-input"
            value={nickname}
            onChange={(event: ChangeEvent<HTMLInputElement>) => onNicknameChange(event.target.value)}
            placeholder="Entrez votre pseudo..."
            maxLength={20}
          />
        </label>

        <button className="play-button-main" type="button" onClick={onPlay}>
          JOUER MAINTENANT
        </button>
        {homeError && <p className="error-text">{homeError}</p>}
      </div>

      <div className="rank-list-container">
        <span className="section-subtitle">SALONS PUBLICS POPULAIRES</span>
        <ol className="rank-list">
          {topRooms.length === 0 ? (
            <li className="rank-list-empty">Aucun salon public pour le moment.</li>
          ) : (
            topRooms.map((room, index) => (
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
