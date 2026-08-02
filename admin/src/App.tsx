import { useCallback, useState } from 'react';
import { AdminApiError, adminLogin, clearAdminSession, loadAdminSession, saveAdminSession } from './adminApi.js';
import ConfigurationView from './components/ConfigurationView.js';
import DashboardView from './components/DashboardView.js';
import EconomyView from './components/EconomyView.js';
import ModerationView from './components/ModerationView.js';
import PlayersView from './components/PlayersView.js';
import RoomsView from './components/RoomsView.js';
import RoomStudio from './components/RoomStudio.js';
import Sidebar from './components/Sidebar.js';

export type ViewName =
  | 'dashboard'
  | 'joueurs'
  | 'salons'
  | 'moderation'
  | 'economie'
  | 'configuration';

/** Onglet "Salons" fusionné (A11, plan-implementation-admin.md §5.1 — ex-onglets séparés "Salons
 * & Écrans" et "Studio de contrôle") : deux niveaux, liste puis studio d'un salon précis. Porté
 * directement par `App.tsx` plutôt qu'un composant parent dédié, même pattern que
 * `selectedCreativeRoomId` avant la fusion (minimise le diff, cf. plan-implementation-admin.md). */
type SalonsMode = { level: 'list' } | { level: 'studio'; roomId: string };

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
  const [salonsMode, setSalonsMode] = useState<SalonsMode>({ level: 'list' });

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

  const handleAuthError = useCallback((error: unknown) => {
    if (!(error instanceof AdminApiError) || error.status !== 401) return;
    clearAdminSession();
    setToken(undefined);
  }, []);

  const handleOpenStudio = useCallback((roomId: string) => {
    setSalonsMode({ level: 'studio', roomId });
    setView('salons');
  }, []);

  /** Cliquer "Salons" dans la navigation revient toujours au niveau liste (§7.1) — distinct de
   * `handleOpenStudio`, qui ouvre directement un studio précis (Tableau de bord, carte de salon). */
  const handleChangeView = useCallback((next: ViewName) => {
    if (next === 'salons') setSalonsMode({ level: 'list' });
    setView(next);
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
            Accès réservé
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
      <Sidebar view={view} onChangeView={handleChangeView} onLogout={handleLogout} />
      <main className="main-content">
        {view === 'dashboard' && (
          <DashboardView
            token={token}
            onAuthError={handleAuthError}
            onOpenRoom={handleOpenStudio}
            onGoToConfiguration={() => setView('configuration')}
          />
        )}
        {view === 'joueurs' && <PlayersView token={token} onAuthError={handleAuthError} />}
        {view === 'salons' && salonsMode.level === 'list' && (
          <RoomsView token={token} onAuthError={handleAuthError} onOpenStudio={handleOpenStudio} />
        )}
        {view === 'salons' && salonsMode.level === 'studio' && (
          <RoomStudio
            token={token}
            onAuthError={handleAuthError}
            initialRoomId={salonsMode.roomId}
            onBack={() => setSalonsMode({ level: 'list' })}
          />
        )}
        {view === 'moderation' && <ModerationView token={token} onAuthError={handleAuthError} />}
        {view === 'economie' && <EconomyView />}
        {view === 'configuration' && <ConfigurationView token={token} onAuthError={handleAuthError} />}
      </main>
    </div>
  );
}
