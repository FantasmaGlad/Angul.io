import { useState } from 'react';
import { clearSession, login, register, saveSession, type AuthResult } from '../auth.js';
import { navigate } from '../router.js';
import PageLayout from './PageLayout.js';

interface AccountPageProps {
  authSession: AuthResult | undefined;
  onAuthChange: (session: AuthResult | undefined) => void;
}

/** Compte joueur (Lot 3.2/3.3/3.6) — entièrement optionnel, le pseudo de l'accueil reste
 * utilisable seul pour une partie en invité. Profil et Paramètres sont désormais des sous-pages
 * séparées, accessibles depuis la nav (TopNav.tsx) — cette page ne gère plus que
 * connexion/inscription/déconnexion. */
export default function AccountPage({ authSession, onAuthChange }: AccountPageProps) {
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [pseudo, setPseudo] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const handleSubmit = (): void => {
    void (async () => {
      setError('');
      try {
        const result =
          mode === 'login' ? await login(pseudo, password) : await register(pseudo, password);
        saveSession(result);
        setPassword('');
        onAuthChange(result);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  const handleLogout = (): void => {
    clearSession();
    onAuthChange(undefined);
  };

  return (
    <PageLayout title="Mon Compte">
      {authSession ? (
        <div className="account-dashboard">
          <div className="account-card-header">
            <div className="account-card-profile">
              <div className="account-avatar-badge" style={{ width: 42, height: 42, fontSize: 16 }}>
                {authSession.pseudo[0]?.toUpperCase() ?? 'J'}
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: 16 }}>{authSession.pseudo}</div>
                <span className="account-badge-pill premium">Joueur Connecté</span>
              </div>
            </div>
            <button className="btn-ghost" type="button" onClick={handleLogout}>
              <span className="material-symbols-outlined" style={{ fontSize: 16, marginRight: 4, verticalAlign: 'middle' }}>logout</span>
              Déconnexion
            </button>
          </div>

          <div className="lobby-section">
            <span className="section-title">Gestion &amp; Raccourcis du Compte</span>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
              <button
                className="btn-primary"
                type="button"
                onClick={() => navigate('/profil')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '12px 18px', width: '100%' }}
              >
                <span className="material-symbols-outlined">person</span>
                Personnaliser mon profil &amp; bannière de mort
              </button>

              <button
                className="btn-ghost"
                type="button"
                onClick={() => navigate('/')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 18px', width: '100%' }}
              >
                <span className="material-symbols-outlined">sports_esports</span>
                Lancer une partie
              </button>

              <button
                className="btn-ghost"
                type="button"
                onClick={() => navigate('/parametres')}
                style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, padding: '10px 18px', width: '100%' }}
              >
                <span className="material-symbols-outlined">settings</span>
                Réglages du jeu
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div>
          <div style={{ marginBottom: 16, textAlign: 'center' }}>
            <span className="section-title">
              {mode === 'login' ? 'Connexion au Compte' : 'Créer un Compte Joueur'}
            </span>
            <p className="view-subtitle" style={{ marginTop: 4 }}>
              Accédez à vos statistiques, choisissez votre skin et personnalisez votre écran de mort.
            </p>
          </div>

          <input
            className="clean-input"
            value={pseudo}
            onChange={(event) => setPseudo(event.target.value)}
            placeholder="Pseudo de votre compte"
            maxLength={20}
            style={{ marginBottom: 12 }}
          />
          <input
            className="clean-input"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Mot de passe"
            maxLength={72}
            style={{ marginBottom: 16 }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') handleSubmit();
            }}
          />
          <button
            className="btn-primary"
            type="button"
            onClick={handleSubmit}
            style={{ width: '100%', padding: '12px 18px', fontSize: 14 }}
          >
            {mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>

          <div style={{ marginTop: 16, textAlign: 'center' }}>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mode === 'login'
                ? "Pas encore de compte ? S'inscrire"
                : 'Déjà inscrit ? Se connecter'}
            </button>
          </div>
        </div>
      )}
      {error && <p className="error-text" style={{ marginTop: 12, textAlign: 'center' }}>{error}</p>}
    </PageLayout>
  );
}
