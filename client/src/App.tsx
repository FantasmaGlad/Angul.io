import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { fetchProfile, loadSession, type AuthResult } from './auth.js';
import Home from './components/Home.js';
import GameView from './components/GameView.js';
import { fetchAvailableModes, fetchPublicRooms, type RoomSummary } from './lobby.js';

// Panneaux secondaires code-splittés (React.lazy) : pas nécessaires au chemin critique "jouer
// vite" (§4.1 cahier_des_charges_ui_ux.md) — leur JS n'est chargé que si l'utilisateur ouvre
// effectivement le panneau correspondant, ce qui réduit le coût d'exécution initial (§
// optimisation demandée).
const AccountPanel = lazy(() => import('./components/AccountPanel.js'));
const RoomsPanel = lazy(() => import('./components/RoomsPanel.js'));
const ModesPanel = lazy(() => import('./components/ModesPanel.js'));
const LeaderboardPanel = lazy(() => import('./components/LeaderboardPanel.js'));
const SupportPanel = lazy(() => import('./components/SupportPanel.js'));
const ProfileModal = lazy(() => import('./components/ProfileModal.js'));

export type PanelName = 'account' | 'rooms' | 'modes' | 'leaderboard' | 'support';

interface GameSession {
  roomIdOrInviteCode: string;
  inviteCodeToShow: string | undefined;
  nickname: string;
}

export default function App() {
  const [nickname, setNickname] = useState('');
  const [session, setSession] = useState<GameSession | null>(null);
  const [openPanel, setOpenPanel] = useState<PanelName | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const [homeError, setHomeError] = useState('');

  const [authSession, setAuthSession] = useState<AuthResult | undefined>(() => loadSession());
  const [isPremium, setIsPremium] = useState(false);

  const [rooms, setRooms] = useState<RoomSummary[]>([]);
  const [modes, setModes] = useState<string[]>([]);
  const [lobbyError, setLobbyError] = useState('');

  const refreshLobby = useCallback(async () => {
    try {
      const [roomsResult, modesResult] = await Promise.all([
        fetchPublicRooms(),
        fetchAvailableModes(),
      ]);
      setRooms(roomsResult);
      setModes(modesResult);
      setLobbyError('');
    } catch {
      setLobbyError('Impossible de contacter le serveur pour lister les salons.');
    }
  }, []);

  useEffect(() => {
    void refreshLobby();
  }, [refreshLobby]);

  // Lot 6.4 : statut Premium du compte connecté, inconnu (`false`) tant que le profil n'a pas
  // été chargé — évite d'afficher le formulaire "Créer un salon" à quelqu'un qui n'a pas le
  // droit de l'utiliser (le serveur le refuserait de toute façon, 403).
  useEffect(() => {
    if (!authSession) {
      setIsPremium(false);
      return;
    }
    setNickname((current) => current || authSession.pseudo);
    let cancelled = false;
    void (async () => {
      try {
        const premium = (await fetchProfile(authSession.token)).premium;
        if (!cancelled) setIsPremium(premium);
      } catch {
        if (!cancelled) setIsPremium(false);
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
      setSession({ roomIdOrInviteCode, inviteCodeToShow, nickname: nickname.trim() || 'Joueur' });
    },
    [nickname],
  );

  // "Jouer" en un clic (§4.1, §12 cahier_des_charges_ui_ux.md — décision par défaut tant que le
  // choix exact n'est pas confirmé) : rejoint directement le premier salon public disponible.
  const handlePlay = useCallback(() => {
    void (async () => {
      setHomeError('');
      try {
        const freshRooms = await fetchPublicRooms();
        setRooms(freshRooms);
        if (freshRooms.length === 0) {
          setHomeError(
            'Aucun salon public pour le moment — ouvre "Salons" pour en créer un (Premium) ou réessaie plus tard.',
          );
          setOpenPanel('rooms');
          return;
        }
        enterGame(freshRooms[0]!.id);
      } catch {
        setHomeError('Impossible de contacter le serveur.');
      }
    })();
  }, [enterGame]);

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
        homeError={homeError}
        onOpenPanel={setOpenPanel}
        accountActive={authSession !== undefined}
      />
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
          />
        )}
        {openPanel === 'rooms' && (
          <RoomsPanel
            onClose={() => setOpenPanel(null)}
            rooms={rooms}
            modes={modes}
            lobbyError={lobbyError}
            onRefresh={refreshLobby}
            authToken={authSession?.token}
            isPremium={isPremium}
            isLoggedIn={authSession !== undefined}
            onJoinRoom={enterGame}
            onOpenSupport={() => setOpenPanel('support')}
          />
        )}
        {openPanel === 'modes' && <ModesPanel onClose={() => setOpenPanel(null)} modes={modes} />}
        {openPanel === 'leaderboard' && <LeaderboardPanel onClose={() => setOpenPanel(null)} />}
        {openPanel === 'support' && <SupportPanel onClose={() => setOpenPanel(null)} />}
        {profileOpen && authSession && (
          <ProfileModal authToken={authSession.token} onClose={() => setProfileOpen(false)} />
        )}
      </Suspense>
    </>
  );
}
