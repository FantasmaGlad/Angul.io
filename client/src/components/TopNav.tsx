import type { PanelName } from '../App.js';

interface TopNavProps {
  onOpenPanel: (panel: PanelName) => void;
  accountActive: boolean;
  pseudo: string;
  level: number | undefined;
}

export default function TopNav({ onOpenPanel, accountActive, pseudo, level }: TopNavProps) {
  const initial = accountActive && pseudo ? pseudo.charAt(0).toUpperCase() : '?';

  return (
    <header className="top-nav">
      <button
        type="button"
        className="brand-mark-btn"
        aria-label="Angul.io Accueil"
        onClick={() => onOpenPanel('about')}
      >
        <span className="brand-logo-text">ANGUL.IO</span>
      </button>

      <nav className="top-nav-links">
        <button type="button" onClick={() => onOpenPanel('leaderboard')}>
          Classement
        </button>
        <button type="button" onClick={() => onOpenPanel('modes')}>
          Modes de Jeux
        </button>
        <button type="button" onClick={() => onOpenPanel('about')}>
          À Propos
        </button>
      </nav>

      <button
        type="button"
        className="account-cluster"
        onClick={() => onOpenPanel('account')}
        aria-label={accountActive ? `Compte : ${pseudo}` : 'Se connecter'}
      >
        <span className="account-avatar-badge" aria-hidden="true">
          {initial}
        </span>
        {accountActive ? (
          <span className="account-info">
            <span className="account-pseudo">{pseudo}</span>
            <span className="account-clan">Joueur</span>
          </span>
        ) : (
          <span className="account-info">
            <span className="account-pseudo">Connexion</span>
          </span>
        )}
        {accountActive && level !== undefined && (
          <span className="account-level">Niveau {level}</span>
        )}
      </button>
    </header>
  );
}
