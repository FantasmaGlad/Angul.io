import { navigate } from '../router.js';

interface TopNavProps {
  accountActive: boolean;
  pseudo: string;
  level: number | undefined;
  /** Couleur d'avatar choisie (refonte UI/UX, avatar procédural) — `undefined` tant qu'aucun
   * choix explicite n'a été fait, voir ProfilePage.tsx. */
  avatarColor: string | undefined;
}

export default function TopNav({ accountActive, pseudo, level, avatarColor }: TopNavProps) {
  const initial = accountActive && pseudo ? pseudo.charAt(0).toUpperCase() : '?';

  return (
    <header className="top-nav">
      <button
        type="button"
        className="brand-mark-btn"
        aria-label="Angul.io Accueil"
        onClick={() => navigate('/')}
      >
        <span className="brand-logo-text">ANGUL.IO</span>
      </button>

      <nav className="top-nav-links">
        <button type="button" onClick={() => navigate('/classement')}>
          Classement
        </button>
        <button type="button" onClick={() => window.open('/wiki', '_blank')}>
          Wiki
        </button>
        <button type="button" onClick={() => navigate('/a-propos')}>
          À Propos
        </button>
      </nav>

      <button
        type="button"
        className="account-cluster"
        onClick={() => navigate(accountActive ? '/profil' : '/compte')}
        aria-label={accountActive ? `Compte : ${pseudo}` : 'Se connecter'}
      >
        <span
          className="account-avatar-badge"
          style={accountActive && avatarColor ? { background: avatarColor } : undefined}
          aria-hidden="true"
        >
          {initial}
        </span>
        {accountActive ? (
          <span className="account-info">
            <span className="account-pseudo">{pseudo}</span>
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
