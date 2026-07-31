import { useEffect, useState } from 'react';
import { audioManager } from '../audio.js';
import type { RoomSummary } from '../lobby.js';
import { enterMobileFullscreenLandscape } from '../mobileScreen.js';
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

  useEffect(() => {
    audioManager.playMusic('/assets/Sons/Musiques/lobby.mp3');
  }, []);

  // Plein écran + verrouillage paysage à CHAQUE tap sur l'accueil mobile (demande utilisateur :
  // pouvoir passer en plein écran en tapant le jeu/le logo, sans devoir lancer une partie) —
  // jamais un seul essai (`once: true`, retiré) : le tout premier tap peut échouer silencieusement
  // (ex. navigateur qui ne compte pas le focus d'un champ texte comme un geste valide pour
  // `requestFullscreen`), sans ce retrait le joueur n'aurait alors plus AUCUN moyen de retenter
  // avant de lancer une partie. `enterMobileFullscreenLandscape` est idempotente si déjà en plein
  // écran (voir mobileScreen.ts) : aucun effet de bord à le retenter à chaque tap. `capture: true`
  // pour être notifié même si un enfant arrête la propagation (ex. `stopPropagation` d'un tiroir) ;
  // sans effet sur desktop (voir le garde `isTouchDevice()` interne à
  // `enterMobileFullscreenLandscape`).
  useEffect(() => {
    const onPointerDown = (): void => {
      enterMobileFullscreenLandscape();
    };
    document.addEventListener('pointerdown', onPointerDown, { capture: true });
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, { capture: true });
    };
  }, []);

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

  const [leftDrawerOpen, setLeftDrawerOpen] = useState(false);
  const [rightDrawerOpen, setRightDrawerOpen] = useState(false);

  const spectatorRoomId = activeSpectatorRoomId ?? defaultRoomId;

  return (
    <div className="home-shell">
      {/* Fond spectateur : élément séparé de `.home-ui` ci-dessous pour pouvoir zoomer l'un
          "en avant" pendant que l'autre zoome "en arrière" (transition d'entrée en jeu). */}
      <SpectatorBackground roomId={spectatorRoomId} zooming={leaving} />

      <div className={`home-ui${leaving ? ' leaving' : ''}`}>
        <TopNav
          accountActive={accountActive}
          pseudo={pseudo}
          level={level}
          avatarColor={avatarColor}
        />

        {/* Languette tiroir gauche : Salons & Modes */}
        <button
          type="button"
          className={`drawer-handle left-handle${leftDrawerOpen ? ' active' : ''}`}
          onClick={() => {
            setLeftDrawerOpen(!leftDrawerOpen);
            setRightDrawerOpen(false);
          }}
          title="Afficher les salons publics et modes de jeu"
        >
          <span className="material-symbols-outlined">stadia_controller</span>
          <span>Salons ({rooms.length})</span>
        </button>

        {/* Languette tiroir droit : Salon Privé & Code */}
        <button
          type="button"
          className={`drawer-handle right-handle${rightDrawerOpen ? ' active' : ''}`}
          onClick={() => {
            setRightDrawerOpen(!rightDrawerOpen);
            setLeftDrawerOpen(false);
          }}
          title="Rejoindre par code ou créer un salon privé"
        >
          <span className="material-symbols-outlined">vpn_key</span>
          <span>Salon Privé</span>
        </button>

        {/* Backdrop sombre flouté si un tiroir est ouvert */}
        {(leftDrawerOpen || rightDrawerOpen) && (
          <div
            className="drawer-backdrop"
            onClick={() => {
              setLeftDrawerOpen(false);
              setRightDrawerOpen(false);
            }}
          />
        )}

        <main className="home-columns">
          {/* Tiroir Latéral Gauche */}
          <div className={`drawer-container left-drawer${leftDrawerOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="drawer-close-btn"
              onClick={() => setLeftDrawerOpen(false)}
              title="Fermer"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <ModeRoomList
              modes={modes}
              rooms={rooms}
              selectedMode={selectedMode}
              onSelectMode={onSelectMode}
              onJoinRoom={(roomId) => {
                setLeftDrawerOpen(false);
                onJoinRoom(roomId);
              }}
            />
          </div>

          {/* Console de Jeu Centrale (Hero) */}
          <PlayPanel
            playersOnline={playersOnline}
            nickname={nickname}
            onNicknameChange={onNicknameChange}
            onPlay={onPlay}
            homeError={homeError}
            rooms={rooms}
            onJoinRoom={onJoinRoom}
          />

          {/* Tiroir Latéral Droit */}
          <div className={`drawer-container right-drawer${rightDrawerOpen ? ' open' : ''}`}>
            <button
              type="button"
              className="drawer-close-btn"
              onClick={() => setRightDrawerOpen(false)}
              title="Fermer"
            >
              <span className="material-symbols-outlined">close</span>
            </button>
            <CreateRoomPanel
              modes={modes}
              authToken={authToken}
              isPremium={isPremium}
              isLoggedIn={isLoggedIn}
              onJoinRoom={(roomId, code) => {
                setRightDrawerOpen(false);
                onJoinRoom(roomId, code);
              }}
            />
          </div>
        </main>

        <BottomBar />
      </div>
    </div>
  );
}
