import { useState } from 'react';
import {
  clampFpsSliderIndex,
  FPS_SLIDER_STEPS,
  loadFpsSliderIndex,
  loadVsyncEnabled,
  saveFpsSliderIndex,
  saveVsyncEnabled,
} from '../settings.js';

function labelForStep(step: number | 'unlimited'): string {
  return step === 'unlimited' ? 'Illimité' : `${step} fps`;
}

/** Section "fps" du profil (demande utilisateur) : Vsync (bouton) + slider de paliers façon
 * Minecraft — réglage local à l'appareil (voir settings.ts), pris en compte à la prochaine
 * partie, le rendu en jeu (GameView.tsx) ne relit ce choix qu'à l'entrée en partie. Le slider
 * reste visible mais grisé quand Vsync est actif : Vsync l'emporte alors sur le cran choisi
 * (comme sur Minecraft), pas de double plafond qui se contredirait. */
export default function FpsModeSelector() {
  const [vsyncEnabled, setVsyncEnabled] = useState(() => loadVsyncEnabled());
  const [sliderIndex, setSliderIndex] = useState(() => loadFpsSliderIndex());

  const handleToggleVsync = (): void => {
    const next = !vsyncEnabled;
    setVsyncEnabled(next);
    saveVsyncEnabled(next);
  };

  const handleSliderChange = (rawIndex: number): void => {
    const next = clampFpsSliderIndex(rawIndex);
    setSliderIndex(next);
    saveFpsSliderIndex(next);
  };

  return (
    <section className="lobby-section">
      <div className="section-header">
        <span className="section-title">FPS</span>
        <button
          type="button"
          className={`fps-vsync-toggle${vsyncEnabled ? ' enabled' : ''}`}
          onClick={handleToggleVsync}
          aria-pressed={vsyncEnabled}
        >
          Vsync : {vsyncEnabled ? 'Activé' : 'Désactivé'}
        </button>
      </div>

      <div className="fps-slider-row" aria-disabled={vsyncEnabled}>
        <input
          type="range"
          min={0}
          max={FPS_SLIDER_STEPS.length - 1}
          step={1}
          value={sliderIndex}
          disabled={vsyncEnabled}
          onChange={(event) => handleSliderChange(Number(event.target.value))}
        />
        <span className="fps-slider-value">{labelForStep(FPS_SLIDER_STEPS[sliderIndex]!)}</span>
      </div>

      <p className="account-status" style={{ marginTop: 10 }}>
        {vsyncEnabled
          ? "Vsync actif : calé sur le taux de rafraîchissement de l'écran, le slider est ignoré."
          : "Plafond choisi ci-dessus — \"Illimité\" reste borné par ce que ton écran peut réellement afficher."}
        {' '}
        Pris en compte à la prochaine partie.
      </p>
    </section>
  );
}
