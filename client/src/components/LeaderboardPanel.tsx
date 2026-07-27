import Panel from './Panel.js';

interface LeaderboardPanelProps {
  onClose: () => void;
}

/** Classements (nouveau, placeholder — §4.4/§10 cahier_des_charges_ui_ux.md) : nécessite un
 * endpoint d'agrégation côté serveur qui n'existe pas encore. */
export default function LeaderboardPanel({ onClose }: LeaderboardPanelProps) {
  return (
    <Panel title="Classements" onClose={onClose}>
      <div className="placeholder">
        <span className="placeholder-tag">Bientôt disponible</span>
        <p>
          Les classements arrivent bientôt — en attendant, retrouve tes meilleurs scores par mode
          dans ton profil (panneau Compte).
        </p>
      </div>
    </Panel>
  );
}
