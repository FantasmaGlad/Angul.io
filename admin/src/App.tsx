import { useCallback, useState } from 'react';
import { adminLogin, clearAdminSession, loadAdminSession, saveAdminSession } from './adminApi.js';
import AccountsView from './components/AccountsView.js';
import PlaceholderView from './components/PlaceholderView.js';
import PremiumView from './components/PremiumView.js';
import Sidebar from './components/Sidebar.js';

export type ViewName = 'dashboard' | 'accounts' | 'moderation' | 'premium' | 'leaderboard';

export default function App() {
  const [token, setToken] = useState<string | undefined>(() => loadAdminSession());
  const [view, setView] = useState<ViewName>('accounts');
  const [password, setPassword] = useState('');
  const [loginError, setLoginError] = useState('');

  const handleLogin = useCallback(() => {
    void (async () => {
      setLoginError('');
      try {
        const newToken = await adminLogin(password);
        saveAdminSession(newToken);
        setPassword('');
        setToken(newToken);
      } catch (error) {
        setLoginError((error as Error).message);
      }
    })();
  }, [password]);

  const handleLogout = useCallback(() => {
    clearAdminSession();
    setToken(undefined);
  }, []);

  const handleAuthError = useCallback((message: string) => {
    if (!message.includes('authentifié')) return;
    clearAdminSession();
    setToken(undefined);
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
            type="password"
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
        {view === 'dashboard' && (
          <PlaceholderView
            title="Dashboard"
            subtitle="Vue d'ensemble en temps réel des salons et joueurs actifs."
          >
            Nécessite un endpoint admin exposant les salons actifs (y compris privés) et le nombre
            de joueurs connectés, qui n'existe pas encore côté serveur (voir
            cahier_des_charges_ui_ux.md §10).
          </PlaceholderView>
        )}
        {view === 'accounts' && <AccountsView token={token} onAuthError={handleAuthError} />}
        {view === 'moderation' && (
          <PlaceholderView
            title="Modération"
            subtitle="Historique des bannissements et corrections manuelles."
          >
            Les bannissements et corrections restent possibles dès aujourd'hui depuis "Comptes",
            mais leur historique n'est pas encore tracé côté serveur (voir
            cahier_des_charges_ui_ux.md §10).
          </PlaceholderView>
        )}
        {view === 'premium' && <PremiumView token={token} onAuthError={handleAuthError} />}
        {view === 'leaderboard' && (
          <PlaceholderView
            title="Classements"
            subtitle="Vue de gestion des classements, correction des scores contestés."
          >
            Nécessite un endpoint d'agrégation des meilleurs scores tous comptes confondus, qui
            n'existe pas encore côté serveur (voir cahier_des_charges_ui_ux.md §10).
          </PlaceholderView>
        )}
      </main>
    </div>
  );
}
