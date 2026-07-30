import { SKIN_IMAGE_MAP } from '@angulio/shared';
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
  const skinUrl = avatarColor
    ? SKIN_IMAGE_MAP[avatarColor] ?? (avatarColor.startsWith('/') ? avatarColor : `/assets/Profil/${avatarColor}.png`)
    : undefined;

  return (
    <header className="top-nav">
      <button
        type="button"
        className="brand-mark-btn"
        aria-label="Angul.io Accueil"
        onClick={() => navigate('/')}
      >
        <img src="/icons/icon-192.png" alt="" className="brand-logo-icon" />
        <span className="brand-logo-text">ANGUL.IO</span>
      </button>

      <nav className="top-nav-links">
        <button type="button" onClick={() => navigate('/classement')}>
          <span className="material-symbols-outlined nav-icon" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>leaderboard</span>
          Classement
        </button>
        <button type="button" onClick={() => navigate('/a-propos')}>
          <span className="material-symbols-outlined nav-icon" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>info</span>
          À Propos
        </button>
        <button type="button" onClick={() => navigate('/parametres')}>
          <span className="material-symbols-outlined nav-icon" style={{ fontSize: '18px', verticalAlign: 'middle', marginRight: '4px' }}>settings</span>
          Réglages
        </button>
      </nav>

      <button
        type="button"
        className="account-cluster"
        onClick={() => navigate(accountActive ? '/profil' : '/compte')}
        aria-label={accountActive ? `Profil : ${pseudo}` : 'Connexion / Créer un compte'}
      >
        <span className="account-avatar-badge" aria-hidden="true">
          {skinUrl ? (
            <img src={skinUrl} alt="" className="account-avatar-img" />
          ) : (
            initial
          )}
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
