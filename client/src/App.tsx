import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { getRandomSkin } from '@angulio/shared';
import { fetchProfile, loadSession, type AuthResult } from './auth.js';
import { audioManager } from './audio.js';
import AssetPreloader from './components/AssetPreloader.js';
import Home from './components/Home.js';
import GameView from './components/GameView.js';
import { navigate, usePath } from './router.js';
import {
  fetchAvailableModes,
  fetchPublicRooms,
  fetchServerStats,
  type RoomSummary,
} from './lobby.js';

// Sous-pages code-splittées (React.lazy) : pas nécessaires au chemin critique "jouer vite"
// (§4.1 cahier_des_charges_ui_ux.md) — leur JS n'est chargé que si l'utilisateur navigue
// effectivement vers la page correspondante. Chacune a sa propre URL (voir router.ts), à la
// place des anciennes modales superposées (Panel.tsx/ProfileModal.tsx supprimés).
const AccountPage = lazy(() => import('./pages/AccountPage.js'));
const WikiPage = lazy(() => import('./components/WikiPage.js'));
const ProfilePage = lazy(() => import('./pages/ProfilePage.js'));
const LeaderboardPage = lazy(() => import('./pages/LeaderboardPage.js'));
const SupportPage = lazy(() => import('./pages/SupportPage.js'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.js'));
const AboutPage = lazy(() => import('./pages/AboutPage.js'));

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
  const [showPreloader, setShowPreloader] = useState(true);
  const [nickname, setNickname] = useState('');
  const [session, setSession] = useState<GameSession | null>(null);
  // Transition d'entrée en jeu (demande utilisateur) : le temps que l'UI d'accueil "zoome en
  // arrière" et que le fond spectateur "zoome en avant" avant de monter GameView — voir
  // `enterGame` et Home.tsx/styles.css (`.home-ui.leaving`, `.spectator-background.zooming`).
  const [leaving, setLeaving] = useState(false);
  const path = usePath();
  const [homeError, setHomeError] = useState('');

  const [authSession, setAuthSession] = useState<AuthResult | undefined>(() => loadSession());
  const [isPremium, setIsPremium] = useState(false);
  const [level, setLevel] = useState<number | undefined>(undefined);
  const [avatarColor, setAvatarColor] = useState<string | undefined>(undefined);
  const [guestSkin] = useState<string>(() => {
    try {
      const saved = localStorage.getItem('angulio.guestSkin');
      if (saved) return saved;
    } catch {}
    return getRandomSkin();
  });

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

  // Sélectionne par défaut le mode réellement actif (le plus de joueurs en ce moment), pas le
  // premier de la liste (ordre alphabétique des fichiers de config côté serveur) — évite qu'un
  // nouvel arrivant tombe sur "aucun salon disponible" alors qu'une partie tourne dans un autre
  // mode.
  useEffect(() => {
    if (modes.length === 0 || modes.includes(selectedMode)) return;
    const playersByMode = new Map<string, number>();
    for (const room of rooms) {
      playersByMode.set(room.modId, (playersByMode.get(room.modId) ?? 0) + room.playerCount);
    }
    const mostActive = [...modes].sort(
      (a, b) => (playersByMode.get(b) ?? 0) - (playersByMode.get(a) ?? 0),
    )[0];
    setSelectedMode(mostActive ?? modes[0]!);
  }, [modes, rooms, selectedMode]);

  // Lot 6.4 : statut Premium du compte connecté, inconnu (`false`) tant que le profil n'a pas
  // été chargé — évite d'afficher le formulaire "Créer un salon" à quelqu'un qui n'a pas le
  // droit de l'utiliser (le serveur le refuserait de toute façon, 403).
  useEffect(() => {
    if (!authSession) {
      setIsPremium(false);
      setLevel(undefined);
      setAvatarColor(undefined);
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
          setAvatarColor(profile.avatarColor);
        }
      } catch {
        if (!cancelled) {
          setIsPremium(false);
          setLevel(undefined);
          setAvatarColor(undefined);
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
      navigate('/');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const enterGame = useCallback(
    (roomIdOrInviteCode: string, inviteCodeToShow?: string) => {
      const musicUrl = roomIdOrInviteCode.toLowerCase().includes('hardcore')
        ? '/assets/Sons/Musiques/Hardcore.m4a'
        : '/assets/Sons/Musiques/vanilla.m4a';
      audioManager.playMusic(musicUrl);

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
        const modeRooms = freshRooms.filter((room) => room.modId === selectedMode);
        const targetRoom =
          modeRooms.find((room) => room.permanent) ??
          [...modeRooms].sort((a, b) => b.playerCount - a.playerCount)[0] ??
          freshRooms.find((room) => room.permanent) ??
          freshRooms[0];
        if (!targetRoom) {
          setHomeError('Aucun salon public pour le moment — réessaie plus tard.');
          return;
        }
        enterGame(targetRoom.id);
      } catch {
        setHomeError('Impossible de contacter le serveur.');
      }
    })();
  }, [enterGame, selectedMode]);

  const defaultRoomId = rooms.find((room) => room.permanent)?.id ?? rooms[0]?.id;

  const handleExit = useCallback(
    (message?: string) => {
      setSession(null);
      if (message) setHomeError(message);
      void refreshLobby();
    },
    [refreshLobby],
  );

  // Transfert forcé par un admin (§3.3 cahier_des_charges_admin.md) — GameView remonte
  // entièrement (voir `key` ci-dessous) plutôt que de rouvrir sa connexion en place : son effet
  // principal ne dépend que du montage (voir GameView.tsx), un simple changement de prop ne
  // rouvrirait pas de nouvelle connexion WebSocket.
  const handleForceRoomChange = useCallback((roomId: string) => {
    setSession((previous) => (previous ? { ...previous, roomIdOrInviteCode: roomId } : previous));
  }, []);

  const isWikiRoute = path === '/wiki' || path === '/wiki/';

  if (isWikiRoute) {
    return (
      <Suspense fallback={null}>
        <WikiPage modes={modes} />
      </Suspense>
    );
  }

  if (session) {
    return (
      <GameView
        key={session.roomIdOrInviteCode}
        roomIdOrInviteCode={session.roomIdOrInviteCode}
        inviteCodeToShow={session.inviteCodeToShow}
        nickname={session.nickname}
        authToken={authSession?.token}
        onExit={handleExit}
        onForceRoomChange={handleForceRoomChange}
      />
    );
  }

  const effectiveAvatarColor = avatarColor ?? guestSkin;

  const knownSubPaths = [
    '/compte',
    '/profil',
    '/parametres',
    '/classement',
    '/soutenir',
    '/a-propos',
  ];
  if (knownSubPaths.includes(path)) {
    return (
      <Suspense fallback={null}>
        {path === '/compte' && (
          <AccountPage authSession={authSession} onAuthChange={setAuthSession} />
        )}
        {path === '/profil' && (
          <ProfilePage
            authToken={authSession?.token}
            onAvatarColorChange={setAvatarColor}
            currentSkin={effectiveAvatarColor}
          />
        )}
        {path === '/parametres' && <SettingsPage />}
        {path === '/classement' && <LeaderboardPage />}
        {path === '/soutenir' && <SupportPage />}
        {path === '/a-propos' && <AboutPage />}
      </Suspense>
    );
  }

  return (
    <>
      {showPreloader && <AssetPreloader onComplete={() => setShowPreloader(false)} />}
      <Home
        nickname={nickname}
        onNicknameChange={setNickname}
        onPlay={handlePlay}
        leaving={leaving}
        homeError={homeError}
        accountActive={authSession !== undefined}
        pseudo={authSession?.pseudo ?? ''}
        level={level}
        avatarColor={effectiveAvatarColor}
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
    </>
  );
}
