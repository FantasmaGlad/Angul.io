import Panel from './Panel.js';

interface AboutPanelProps {
  onClose: () => void;
}

/** À Propos (nouveau, refonte UI/UX — lien de la nouvelle barre de navigation supérieure). */
export default function AboutPanel({ onClose }: AboutPanelProps) {
  return (
    <Panel title="À Propos" onClose={onClose}>
      <p className="account-status">
        <strong>Angul.io</strong> — plateforme de jeu multijoueur temps réel inspirée d'Agar.io,
        avec un système de salons et de modes de jeu scriptables.
      </p>
      <div className="stat-row">
        <span className="stat-label">Version</span>
        <span className="stat-value">1.1</span>
      </div>
      <div className="stat-row">
        <span className="stat-label">Licence</span>
        <span className="stat-value">AGPL-3.0-or-later</span>
      </div>
      <p className="account-status" style={{ marginTop: 14 }}>
        Code source ouvert : toute réutilisation doit rester open source et citer le projet
        d'origine.
      </p>
    </Panel>
  );
}
