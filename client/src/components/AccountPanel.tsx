import { useState } from 'react';
import { clearSession, login, register, saveSession, type AuthResult } from '../auth.js';
import Panel from './Panel.js';

interface AccountPanelProps {
  onClose: () => void;
  authSession: AuthResult | undefined;
  onAuthChange: (session: AuthResult | undefined) => void;
  onOpenProfile: () => void;
}

/** Compte joueur (Lot 3.2/3.3/3.6) — entièrement optionnel, le pseudo de l'accueil reste
 * utilisable seul pour une partie en invité. */
export default function AccountPanel({
  onClose,
  authSession,
  onAuthChange,
  onOpenProfile,
}: AccountPanelProps) {
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
    <Panel title="Compte" onClose={onClose}>
      {authSession ? (
        <div>
          <p className="account-status">
            Connecté(e) : <strong>{authSession.pseudo}</strong>
          </p>
          <div className="field-row">
            <button className="btn-ghost" type="button" onClick={onOpenProfile}>
              Profil
            </button>
            <button className="btn-ghost" type="button" onClick={handleLogout}>
              Déconnexion
            </button>
          </div>
        </div>
      ) : (
        <div>
          <input
            value={pseudo}
            onChange={(event) => setPseudo(event.target.value)}
            placeholder="Pseudo du compte"
            maxLength={20}
            style={{ marginBottom: 12 }}
          />
          <input
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            type="password"
            placeholder="Mot de passe"
            maxLength={72}
            style={{ marginBottom: 12 }}
          />
          <button
            className="btn-primary"
            type="button"
            onClick={handleSubmit}
            style={{ width: '100%' }}
          >
            {mode === 'login' ? 'Se connecter' : "S'inscrire"}
          </button>
          <div className="field-row" style={{ marginTop: 10, marginBottom: 0 }}>
            <button
              className="btn-ghost"
              type="button"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
              }}
            >
              {mode === 'login' ? "S'inscrire" : 'Se connecter'}
            </button>
          </div>
        </div>
      )}
      <p className="error-text">{error}</p>
    </Panel>
  );
}
