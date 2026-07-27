import type { CSSProperties } from 'react';
import { modeMeta } from '../modes.js';
import Panel from './Panel.js';

interface ModesPanelProps {
  onClose: () => void;
  modes: string[];
}

/** Modes de jeu (nouveau, §4.3 cahier_des_charges_ui_ux.md) : nom/description/couleur définis
 * côté client (modes.ts) tant que `GET /api/modes` ne renvoie que des ids bruts (§10). */
export default function ModesPanel({ onClose, modes }: ModesPanelProps) {
  return (
    <Panel title="Modes de jeu" onClose={onClose}>
      <div className="mode-list">
        {modes.map((modeId) => {
          const meta = modeMeta(modeId);
          const style = { '--mode-color': meta.color } as CSSProperties;
          return (
            <div key={modeId} className="mode-card" style={style}>
              <p className="mode-card-name">{meta.label}</p>
              <p className="mode-card-desc">{meta.description}</p>
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
