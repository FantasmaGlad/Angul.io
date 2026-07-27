import type { ChangeEvent } from 'react';
import type { RoomSummary } from '../lobby.js';
import { DEFAULT_BLOB_COLOR } from '../render.js';

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

/** Colonne centrale de l'accueil (refonte UI/UX, mockup fourni) : compteur de joueurs connectés,
 * pseudo du blob (indépendant du compte), bouton "Rejoindre" (rejoint le salon permanent — voir
 * App.tsx), puis un classement global des salons les plus peuplés, tous modes confondus. */
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
      <p className="players-online">
        <span className="players-online-count">{playersOnline ?? '—'}</span>
        <span className="players-online-label">Joueurs Connectés</span>
      </p>

      <label className="field">
        <span className="field-label">Pseudo</span>
        <input
          value={nickname}
          onChange={(event: ChangeEvent<HTMLInputElement>) => onNicknameChange(event.target.value)}
          placeholder="Pseudo"
          maxLength={20}
        />
      </label>

      <span
        className="blob-color-swatch"
        style={{ background: DEFAULT_BLOB_COLOR }}
        role="img"
        aria-label="Couleur du blob (fixe pour l'instant)"
      />

      <button className="btn-primary play-button" type="button" onClick={onPlay}>
        Rejoindre
      </button>
      <p className="error-text">{homeError}</p>

      <ol className="rank-list">
        {topRooms.length === 0 ? (
          <li className="rank-list-empty">Aucun salon public pour le moment.</li>
        ) : (
          topRooms.map((room, index) => (
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
