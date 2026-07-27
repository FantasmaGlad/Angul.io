import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchProfile, loadSession, type AuthResult } from './auth.js';
import Home from './components/Home.js';
import GameView from './components/GameView.js';
import {
  fetchAvailableModes,
  fetchPublicRooms,
  fetchServerStats,
  type RoomSummary,
} from './lobby.js';

// Panneaux secondaires code-splittés (React.lazy) : pas nécessaires au chemin critique "jouer
// vite" (§4.1 cahier_des_charges_ui_ux.md) — leur JS n'est chargé que si l'utilisateur ouvre
// effectivement le panneau correspondant, ce qui réduit le coût d'exécution initial (§
// optimisation demandée). Les salons/modes eux-mêmes ne sont plus dans ce périmètre (refonte
// UI/UX) : ils sont désormais visibles en permanence sur l'accueil (voir Home.tsx), pas cachés
// dans un panneau modal — RoomsPanel.tsx a été supprimé, son contenu redistribué dans
// ModeRoomList/PlayPanel/CreateRoomPanel.
const AccountPanel = lazy(() => import('./components/AccountPanel.js'));
const ModesPanel = lazy(() => import('./components/ModesPanel.js'));
const LeaderboardPanel = lazy(() => import('./components/LeaderboardPanel.js'));
const SupportPanel = lazy(() => import('./components/SupportPanel.js'));
const SettingsPanel = lazy(() => import('./components/SettingsPanel.js'));
const AboutPanel = lazy(() => import('./components/AboutPanel.js'));
const ProfileModal = lazy(() => import('./components/ProfileModal.js'));

export type PanelName = 'account' | 'modes' | 'leaderboard' | 'support' | 'settings' | 'about';

/** Intervalle de rafraîchissement léger des salons/modes/compteur de joueurs pendant que
 * l'accueil est affiché (refonte UI/UX : ces listes sont désormais visibles en permanence, pas
 * seulement au moment d'ouvrir un panneau) — assez espacé pour rester négligeable en charge
 * réseau, assez court pour que l'accueil ne semble pas figé. */
const HOME_REFRESH_INTERVAL_MS = 10_000;

/** Durée de la transition "on lance une partie" (demande utilisateur) : l'interface d'accueil
 * zoome en arrière/s'estompe pendant que le fond spectateur zoome en avant, avant de monter
 * GameView — doit correspondre à la durée des transitions CSS `.home-ui.leaving`/
 * `.spectator-background.zooming` dans styles.css. */
const HOME_LEAVE_TRANSITION_MS = 450;

interface GameSession {
  roomIdOrInviteCode: string;
  inviteCodeToShow: string | undefined;
  nickname: string;
}

export default function App() {
  const [nickname, setNickname] = useState('');
  const [session, setSession] = useState<GameSession | null>(null);
  // Transition d'entrée en jeu (demande utilisateur) : le temps que l'UI d'accueil "zoome en
  // arrière" et que le fond spectateur "zoome en avant" avant de monter GameView — voir
  // `enterGame` et Home.tsx/styles.css (`.home-ui.leaving`, `.spectator-background.zooming`).
  const [leaving, setLeaving] = useState(false);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [homeError, setHomeError] = useState('');

  const [authSession, setAuthSession] = useState<AuthResult | undefined>(() => loadSession());
  const [isPremium, setIsPremium] = useState(false);
  const [level, setLevel] = useState<number | undefined>(undefined);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [selectedMode, setSelectedMode] = useState('');
  const [playersOnline, setPlayersOnline] = useState<number | undefined>(undefined);
  const [lobbyError, setLobbyError] = useState('');

  const refreshLobby = useCallback(async () => {
    try {
      const [roomsResult, modesResult, statsResult] = await Promise.all([
        fetchPublicRooms(),
        fetchAvailableModes(),
        fetchServerStats(),
      ]);
      setRooms(roomsResult);
      setModes(modesResult);
      setPlayersOnline(statsResult.playersOnline);
      setLobbyError('');
    } catch {
      setLobbyError('Impossible de contacter le serveur pour lister les salons.');
    }
  }, []);

  useEffect(() => {
    void refreshLobby();
  }, [refreshLobby]);

  // Les salons/modes/le compteur de joueurs sont désormais visibles en permanence sur l'accueil
  // (refonte UI/UX, pas seulement dans un panneau ouvert à la demande) : un rafraîchissement
  // périodique léger les garde vivants pendant que l'accueil est affiché, arrêté dès qu'une
  // partie démarre (`session` non nul) — inutile de continuer à interroger le lobby en jeu.
  useEffect(() => {
    if (session) return;
    const intervalId = setInterval(() => void refreshLobby(), HOME_REFRESH_INTERVAL_MS);
    return () => clearInterval(intervalId);
  }, [session, refreshLobby]);

  // Sélectionne un mode par défaut dès que la liste est connue (colonne gauche, ModeRoomList).
  useEffect(() => {
    if (modes.length > 0 && !modes.includes(selectedMode)) setSelectedMode(modes[0]!);
  }, [modes, selectedMode]);

  // Lot 6.4 : statut Premium du compte connecté, inconnu (`false`) tant que le profil n'a pas
  // été chargé — évite d'afficher le formulaire "Créer un salon" à quelqu'un qui n'a pas le
  // droit de l'utiliser (le serveur le refuserait de toute façon, 403).
  useEffect(() => {
    if (!authSession) {
      setIsPremium(false);
      setLevel(undefined);
      return;
    }
    setNickname((current) => current || authSession.pseudo);
    let cancelled = false;
    void (async () => {
      try {
        const profile = await fetchProfile(authSession.token);
        if (!cancelled) {
          setIsPremium(profile.premium);
          setLevel(profile.level);
        }
      } catch {
        if (!cancelled) {
          setIsPremium(false);
          setLevel(undefined);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authSession]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setProfileOpen(false);
      setOpenPanel(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const enterGame = useCallback(
    (roomIdOrInviteCode: string, inviteCodeToShow?: string) => {
      setOpenPanel(null);
      setLeaving(true);
      const nicknameToUse = nickname.trim() || 'Joueur';
      // Laisse jouer la transition CSS (zoom out de l'UI, zoom in du fond spectateur, voir
      // Home.tsx) avant de monter GameView — un montage immédiat couperait l'animation.
      setTimeout(() => {
        setSession({ roomIdOrInviteCode, inviteCodeToShow, nickname: nicknameToUse });
        setLeaving(false);
      }, HOME_LEAVE_TRANSITION_MS);
    },
    [nickname],
  );

  // "Rejoindre" en un clic (§4.1 cahier_des_charges_ui_ux.md, demande utilisateur : rejoint
  // toujours le salon vanilla par défaut, celui toujours en ligne) : cible explicitement le
  // salon `permanent` plutôt que le premier de la liste (qui ne fonctionnait que par coïncidence
  // d'ordre — voir RoomSummary.permanent, server/src/engine/roomManager.ts).
  const handlePlay = useCallback(() => {
    void (async () => {
      setHomeError('');
      try {
        const freshRooms = await fetchPublicRooms();
        setRooms(freshRooms);
        const defaultRoom = freshRooms.find((room) => room.permanent) ?? freshRooms[0];
        if (!defaultRoom) {
          setHomeError('Aucun salon public pour le moment — réessaie plus tard.');
          return;
        }
        enterGame(defaultRoom.id);
      } catch {
        setHomeError('Impossible de contacter le serveur.');
      }
    })();
  }, [enterGame]);

  const defaultRoomId = rooms.find((room) => room.permanent)?.id ?? rooms[0]?.id;

  const handleExit = useCallback(
    (message: string) => {
      setSession(null);
      setHomeError(message);
      void refreshLobby();
    },
    [refreshLobby],
  );

  if (session) {
    return (
      <GameView
        roomIdOrInviteCode={session.roomIdOrInviteCode}
        inviteCodeToShow={session.inviteCodeToShow}
        nickname={session.nickname}
        authToken={authSession?.token}
        onExit={handleExit}
      />
    );
  }

  return (
    <>
      <Home
        nickname={nickname}
        onNicknameChange={setNickname}
        onPlay={handlePlay}
        leaving={leaving}
        homeError={homeError}
        onOpenPanel={setOpenPanel}
        onOpenSupport={() => setOpenPanel('support')}
        accountActive={authSession !== undefined}
        pseudo={authSession?.pseudo ?? ''}
        level={level}
        modes={modes}
        rooms={rooms}
        selectedMode={selectedMode}
        onSelectMode={setSelectedMode}
        onJoinRoom={enterGame}
        playersOnline={playersOnline}
        authToken={authSession?.token}
        isPremium={isPremium}
        isLoggedIn={authSession !== undefined}
        defaultRoomId={defaultRoomId}
      />
      {lobbyError && <p className="lobby-error-toast">{lobbyError}</p>}
      <div
        className={`panel-backdrop${openPanel ? ' visible' : ''}`}
        onClick={() => setOpenPanel(null)}
      />
      <Suspense fallback={null}>
        {openPanel === 'account' && (
          <AccountPanel
            onClose={() => setOpenPanel(null)}
            authSession={authSession}
            onAuthChange={setAuthSession}
            onOpenProfile={() => setProfileOpen(true)}
            onOpenSettings={() => setOpenPanel('settings')}
          />
        )}
        {openPanel === 'modes' && <ModesPanel onClose={() => setOpenPanel(null)} modes={modes} />}
        {openPanel === 'leaderboard' && <LeaderboardPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === 'support' && <SupportPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === 'settings' && <SettingsPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === 'about' && <AboutPanel onClose={() => setOpenPanel(null)} />}
        {profileOpen && authSession && (
          <ProfileModal authToken={authSession.token} onClose={() => setProfileOpen(false)} />
        )}
      </Suspense>
    </>
  );
}
