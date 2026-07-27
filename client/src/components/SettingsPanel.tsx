import { useState } from 'react';
import { loadFpsCap, MAX_FPS_CAP, MIN_FPS_CAP, saveFpsCap } from '../settings.js';
import Panel from './Panel.js';

interface SettingsPanelProps {
  onClose: () => void;
}

/** Paramètres client (nouveau) : réglages locaux à l'appareil, pas liés au compte joueur — pour
 * l'instant seulement le plafond FPS du rendu en jeu (voir GameView.tsx), lu au moment d'entrer
 * en partie donc appliqué à la prochaine partie, pas en cours de partie. */
export default function SettingsPanel({ onClose }: SettingsPanelProps) {
  const [fpsCap, setFpsCap] = useState(() => loadFpsCap());

  return (
    <Panel title="Paramètres" onClose={onClose}>
      <section className="lobby-section">
        <div className="section-header">
          <span className="section-title">Limite d'images par seconde</span>
          <span className="stat-value">{fpsCap} fps</span>
        </div>
        <input
          type="range"
          min={MIN_FPS_CAP}
          max={MAX_FPS_CAP}
          step={1}
          value={fpsCap}
          onChange={(event) => {
            const next = Number(event.target.value);
            setFpsCap(next);
            saveFpsCap(next);
          }}
        />
        <p className="account-status" style={{ marginTop: 10 }}>
          De {MIN_FPS_CAP} à {MAX_FPS_CAP} fps — utile pour économiser la batterie ou lisser
          l'affichage sur un écran plus lent. Pris en compte à la prochaine partie.
        </p>
      </section>
    </Panel>
  );
}
