import { useCallback, useState } from 'react';
import { adminLogin, clearAdminSession, loadAdminSession, saveAdminSession } from './adminApi.js';
import ConfigurationView from './components/ConfigurationView.js';
import CreativeView from './components/CreativeView.js';
import DashboardView from './components/DashboardView.js';
import EconomyView from './components/EconomyView.js';
import ModerationView from './components/ModerationView.js';
import PlayersView from './components/PlayersView.js';
import RoomsView from './components/RoomsView.js';
import Sidebar from './components/Sidebar.js';

export type ViewName =
  | 'dashboard'
  | 'joueurs'
  | 'salons'
  | 'creatif'
  | 'moderation'
  | 'economie'
  | 'configuration';

export default function App() {
  const [token, setToken] = useState<string | undefined>(() => loadAdminSession());
  const [view, setView] = useState<ViewName>('dashboard');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  // Doit rester AVANT le `if (!token) return ...` ci-dessous (Rules of Hooks) : un Hook appelé
  // conditionnellement (absent au rendu "écran de login", présent une fois connecté) fait
  // planter React à la connexion ("Rendered more hooks than during the previous render") — bug
  // corrigé ici, l'admin restait blanc (aucun contenu, aucune erreur visible côté utilisateur)
  // dès qu'un login réussissait.
  const [selectedCreativeRoomId, setSelectedCreativeRoomId] = useState<string | undefined>(undefined);

  const handleLogin = useCallback(() => {
    void (async () => {
      setLoginError('');
      try {
        const newToken = await adminLogin(username, password);
        saveAdminSession(newToken);
        setPassword('');
        setToken(newToken);
      } catch (error) {
        setLoginError((error as Error).message);
      }
    })();
  }, [username, password]);

  const handleLogout = useCallback(() => {
    clearAdminSession();
    setToken(undefined);
  }, []);

  const handleAuthError = useCallback((message: string) => {
    if (!message.includes('authentifié')) return;
    clearAdminSession();
    setToken(undefined);
  }, []);

  const handleSelectCreativeRoom = useCallback((roomId: string) => {
    setSelectedCreativeRoomId(roomId);
    setView('creatif');
  }, []);

  if (!token) {
    return (
      <div className="login-overlay">
        <form
          className="panel"
          onSubmit={(event) => {
            event.preventDefault();
            handleLogin();
          }}
        >
          <h1>Angul.io — Admin</h1>
          <p style={{ color: 'var(--text-soft)', fontSize: 12.5, margin: '6px 0 0' }}>
            Accès réservé (cahier des charges §5.4)
          </p>
          <input
            className="login-password-input"
            type="text"
            autoComplete="username"
            placeholder="Nom d'utilisateur"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
          />
          <input
            className="login-password-input"
            type="password"
            autoComplete="current-password"
            placeholder="Mot de passe admin"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
          <button className="btn-primary login-button" type="submit">
            Se connecter
          </button>
          <p className="error-text">{loginError}</p>
        </form>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onChangeView={setView} onLogout={handleLogout} />
      <main className="main-content">
        {view === 'dashboard' && (
          <DashboardView
            token={token}
            onAuthError={handleAuthError}
            onOpenRoom={handleSelectCreativeRoom}
          />
        )}
        {view === 'joueurs' && <PlayersView token={token} onAuthError={handleAuthError} />}
        {view === 'salons' && (
          <RoomsView
            token={token}
            onAuthError={handleAuthError}
            onSelectCreativeRoom={handleSelectCreativeRoom}
          />
        )}
        {view === 'creatif' && (
          <CreativeView
            token={token}
            onAuthError={handleAuthError}
            initialRoomId={selectedCreativeRoomId}
          />
        )}
        {view === 'moderation' && <ModerationView token={token} onAuthError={handleAuthError} />}
        {view === 'economie' && <EconomyView />}
        {view === 'configuration' && <ConfigurationView token={token} onAuthError={handleAuthError} />}
      </main>
    </div>
  );
}
