import { useState } from 'react';
import { loadHideEatFlash, saveHideEatFlash } from '../settings.js';

/** Réglages d'affichage et d'effets visuels locaux. */
export default function DisplaySettings() {
  const [hideEatFlash, setHideEatFlash] = useState(() => loadHideEatFlash());

  const handleToggleHideEatFlash = (hide: boolean): void => {
    setHideEatFlash(hide);
    saveHideEatFlash(hide);
  };

  return (
    <section className="lobby-section">
      <span className="section-title">Affichage &amp; Effets Visuels</span>
      <div className="audio-settings-card">
        <div className="audio-control-item" style={{ flex: 1 }}>
          <div className="audio-control-label">
            <span className="material-symbols-outlined">visibility_off</span>
            Flash rouge lors de l'absorption d'un blob
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 8 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13.5 }}>
              <input
                type="checkbox"
                checked={hideEatFlash}
                onChange={(e) => handleToggleHideEatFlash(e.target.checked)}
                style={{ width: 18, height: 18, accentColor: '#3b82f6', cursor: 'pointer' }}
              />
              Masquer le flash rouge en direct
            </label>
          </div>
        </div>
      </div>
    </section>
  );
}
