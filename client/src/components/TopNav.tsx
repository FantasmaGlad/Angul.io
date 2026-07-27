import type { PanelName } from '../App.js';

interface TopNavProps {
  onOpenPanel: (panel: PanelName) => void;
  accountActive: boolean;
  pseudo: string;
  level: number | undefined;
}

/** Barre de navigation supérieure de l'accueil (refonte UI/UX, mockup fourni) — remplace
 * l'ancienne grille de 6 boutons de Home.tsx. Le cercle de marque et le cercle de compte sont de
 * simples formes CSS pleines (pas d'asset image — cohérent avec structure.md §3, "aucun asset
 * graphique produit à la main"). */
export default function TopNav({ onOpenPanel, accountActive, pseudo, level }: TopNavProps) {
  return (
    <header className="top-nav">
      <button
        type="button"
        className="brand-mark"
        aria-label="Angul.io"
        onClick={() => onOpenPanel('about')}
      />
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
        <span className="account-avatar" aria-hidden="true" />
        {accountActive ? (
          <span className="account-info">
            <span className="account-pseudo">{pseudo}</span>
            {/* "Clan" : même traitement que le "Guilde" du HUD (GameView.tsx) — espace réservé
                statique, aucun système de clan/guilde n'est spécifié (cahier_des_charges_ui_ux.md
                §0/§12, décision encore ouverte). */}
            <span className="account-clan">Clan —</span>
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
