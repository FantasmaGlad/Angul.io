import { useEffect, useState } from 'react';
import type { RoomSummary } from '../lobby.js';
import BottomBar from './BottomBar.js';
import CreateRoomPanel from './CreateRoomPanel.js';
import ModeRoomList from './ModeRoomList.js';
import PlayPanel from './PlayPanel.js';
import SpectatorBackground from './SpectatorBackground.js';
import TopNav from './TopNav.js';

interface HomeProps {
  nickname: string;
  onNicknameChange: (value: string) => void;
  onPlay: () => void;
  /** Transition "on lance une partie" (demande utilisateur, voir App.tsx `enterGame`) : l'UI
   * zoome en arrière/s'estompe pendant que le fond spectateur zoome en avant, juste avant de
   * monter GameView. */
  leaving: boolean;
  homeError: string;
  accountActive: boolean;
  pseudo: string;
  level: number | undefined;
  avatarColor: string | undefined;
  modes: string[];
  rooms: RoomSummary[];
  selectedMode: string;
  onSelectMode: (modeId: string) => void;
  onJoinRoom: (roomIdOrInviteCode: string, inviteCodeToShow?: string) => void;
  playersOnline: number | undefined;
  authToken: string | undefined;
  isPremium: boolean;
  isLoggedIn: boolean;
  defaultRoomId: string | undefined;
}

/** Accueil (refonte UI/UX, mockup fourni) : nav supérieure, 3 colonnes (salons par mode / jouer +
 * classement global / créer un salon privé), pied de page — et un fond animé montrant une vraie
 * vue en direct du salon permanent (voir SpectatorBackground.tsx). Contrairement à la version
 * précédente (carte centrée + panneaux modaux pour tout), les salons et modes sont désormais
 * visibles en permanence : ce contenu sort donc du périmètre code-splitté (React.lazy) de
 * App.tsx, cohérent avec le nouveau mockup où "jouer vite" inclut de voir les salons par
 * construction. */
export default function Home({
  nickname,
  onNicknameChange,
  onPlay,
  leaving,
  homeError,
  accountActive,
  pseudo,
  level,
  avatarColor,
  modes,
  rooms,
  selectedMode,
  onSelectMode,
  onJoinRoom,
  playersOnline,
  authToken,
  isPremium,
  isLoggedIn,
  defaultRoomId,
}: HomeProps) {
  const [activeSpectatorRoomId, setActiveSpectatorRoomId] = useState<string | undefined>(
    defaultRoomId,
  );

  // Hystérésis sur la sélection du salon spectateur : évite les bascules/reconnexions intempestives
  // de la WebSocket du fond spectateur lors des rafraîchissements réguliers (10s) du lobby
  // quand deux salons ont des effectifs proches.
  useEffect(() => {
    const candidateRooms = [...rooms]
      .filter((room) => room.modId === selectedMode)
      .sort((a, b) => b.playerCount - a.playerCount);

    const topRoom = candidateRooms[0];
    if (!topRoom) {
      if (defaultRoomId && activeSpectatorRoomId !== defaultRoomId) {
        setActiveSpectatorRoomId(defaultRoomId);
      }
      return;
    }

    if (!activeSpectatorRoomId) {
      setActiveSpectatorRoomId(topRoom.id);
      return;
    }

    const currentRoom = candidateRooms.find((r) => r.id === activeSpectatorRoomId);
    if (!currentRoom) {
      setActiveSpectatorRoomId(topRoom.id);
      return;
    }

    const HYSTERESIS_THRESHOLD = 3;
    if (
      topRoom.id !== currentRoom.id &&
      topRoom.playerCount >= currentRoom.playerCount + HYSTERESIS_THRESHOLD
    ) {
      setActiveSpectatorRoomId(topRoom.id);
    }
  }, [rooms, selectedMode, defaultRoomId, activeSpectatorRoomId]);

  const spectatorRoomId = activeSpectatorRoomId ?? defaultRoomId;

  return (
    <div className="home-shell">
      {/* Fond spectateur : élément séparé de `.home-ui` ci-dessous pour pouvoir zoomer l'un
          "en avant" pendant que l'autre zoome "en arrière" (transition d'entrée en jeu, voir
          styles.css `.spectator-background.zooming`/`.home-ui.leaving`). */}
      <SpectatorBackground roomId={spectatorRoomId} zooming={leaving} />
      <div className={`home-ui${leaving ? ' leaving' : ''}`}>
        <TopNav
          accountActive={accountActive}
          pseudo={pseudo}
          level={level}
          avatarColor={avatarColor}
        />
        <main className="home-columns">
          <ModeRoomList
            modes={modes}
            rooms={rooms}
            selectedMode={selectedMode}
            onSelectMode={onSelectMode}
            onJoinRoom={onJoinRoom}
          />
          <PlayPanel
            playersOnline={playersOnline}
            nickname={nickname}
            onNicknameChange={onNicknameChange}
            onPlay={onPlay}
            homeError={homeError}
            rooms={rooms}
            onJoinRoom={onJoinRoom}
          />
          <CreateRoomPanel
            modes={modes}
            authToken={authToken}
            isPremium={isPremium}
            isLoggedIn={isLoggedIn}
            onJoinRoom={onJoinRoom}
          />
        </main>
        <BottomBar />
      </div>
    </div>
  );
}
