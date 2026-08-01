import { useCallback, useState } from 'react';
import { adminLogin, clearAdminSession, loadAdminSession, saveAdminSession } from './adminApi.js';
import CreativeView from './components/CreativeView.js';
import PlayersView from './components/PlayersView.js';
import RoomsView from './components/RoomsView.js';
import Sidebar from './components/Sidebar.js';

export type ViewName = 'joueurs' | 'salons' | 'creatif';

export default function App() {
  const [token, setToken] = useState<string | undefined>(() => loadAdminSession());
  const [view, setView] = useState<ViewName>('joueurs');
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
        <div className="panel">
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
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleLogin();
            }}
          />
          <input
            className="login-password-input"
            type="password"
            autoComplete="current-password"
            placeholder="Mot de passe admin"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') handleLogin();
            }}
          />
          <button className="btn-primary login-button" type="button" onClick={handleLogin}>
            Se connecter
          </button>
          <p className="error-text">{loginError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell">
      <Sidebar view={view} onChangeView={setView} onLogout={handleLogout} />
      <main className="main-content">
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
      </main>
    </div>
  );
}
