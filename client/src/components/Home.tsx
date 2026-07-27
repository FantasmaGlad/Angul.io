import type { ChangeEvent } from 'react';
import type { PanelName } from '../App.js';

interface HomeProps {
  nickname: string;
  onNicknameChange: (value: string) => void;
  onPlay: () => void;
  homeError: string;
  onOpenPanel: (panel: PanelName) => void;
  accountActive: boolean;
}

const NAV_ITEMS: Array<{ panel: PanelName; label: string }> = [
  { panel: 'account', label: 'Compte' },
  { panel: 'rooms', label: 'Salons' },
  { panel: 'modes', label: 'Modes' },
  { panel: 'leaderboard', label: 'Classements' },
  { panel: 'support', label: 'Soutenir' },
  { panel: 'settings', label: 'Paramètres' },
];

/** Accueil minimal — "jouer vite" (§3.1/§4.1 cahier_des_charges_ui_ux.md) : pseudo + bouton
 * Jouer, tout le reste dans des sous-panneaux ouverts depuis la barre de navigation. */
export default function Home({
  nickname,
  onNicknameChange,
  onPlay,
  homeError,
  onOpenPanel,
  accountActive,
}: HomeProps) {
  return (
    <div className="home-overlay">
      <div className="home-card">
        <h1 className="home-logo">Angul.io</h1>
        <p className="home-tagline">Grossis, sépare-toi, dévore.</p>

        <label className="field">
          <span className="field-label">Pseudo</span>
          <input
            value={nickname}
            onChange={(event: ChangeEvent<HTMLInputElement>) =>
              onNicknameChange(event.target.value)
            }
            placeholder="Pseudo"
            maxLength={20}
          />
        </label>

        <button className="btn-primary" type="button" onClick={onPlay} style={{ width: '100%' }}>
          Jouer
        </button>
        <p className="error-text">{homeError}</p>

        <nav className="home-nav">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.panel}
              type="button"
              className={
                item.panel === 'account' && accountActive
                  ? 'nav-link is-account-active'
                  : 'nav-link'
              }
              onClick={() => onOpenPanel(item.panel)}
            >
              {item.label}
            </button>
          ))}
        </nav>
      </div>
    </div>
  );
}
