import { useState } from 'react';
import { audioManager } from '../audio.js';

/** Réglages sonores (musique/effets) — réglage local à l'appareil (voir audio.ts), déplacé des
 * paramètres du joueur (demande utilisateur : la section FPS y était auparavant). */
export default function AudioSettings() {
  const [musicVolume, setMusicVolume] = useState(() => audioManager.getMusicVolume());
  const [sfxVolume, setSfxVolume] = useState(() => audioManager.getSfxVolume());

  const handleMusicChange = (vol: number): void => {
    setMusicVolume(vol);
    audioManager.setMusicVolume(vol);
  };

  const handleSfxChange = (vol: number): void => {
    setSfxVolume(vol);
    audioManager.setSfxVolume(vol);
  };

  return (
    <section className="lobby-section">
      <span className="section-title">Sons &amp; Musiques</span>
      <div className="audio-settings-card">
        <div className="audio-settings-row">
          <div className="audio-control-item">
            <div className="audio-control-label">
              <span className="material-symbols-outlined">music_note</span>
              Musique
            </div>
            <div className="audio-slider-wrapper">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={musicVolume}
                className="audio-slider"
                onChange={(e) => handleMusicChange(parseFloat(e.target.value))}
              />
              <span className="audio-value-badge">{Math.round(musicVolume * 100)}%</span>
            </div>
            <div className="audio-preset-btns">
              <button type="button" className="audio-preset-btn" onClick={() => handleMusicChange(0)}>Muet</button>
              <button type="button" className="audio-preset-btn" onClick={() => handleMusicChange(0.5)}>50%</button>
              <button type="button" className="audio-preset-btn" onClick={() => handleMusicChange(1)}>100%</button>
            </div>
          </div>

          <div className="audio-control-item">
            <div className="audio-control-label">
              <span className="material-symbols-outlined">volume_up</span>
              Effets Sonores
            </div>
            <div className="audio-slider-wrapper">
              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={sfxVolume}
                className="audio-slider"
                onChange={(e) => handleSfxChange(parseFloat(e.target.value))}
              />
              <span className="audio-value-badge">{Math.round(sfxVolume * 100)}%</span>
            </div>
            <div className="audio-preset-btns">
              <button type="button" className="audio-preset-btn" onClick={() => handleSfxChange(0)}>Muet</button>
              <button type="button" className="audio-preset-btn" onClick={() => handleSfxChange(0.5)}>50%</button>
              <button type="button" className="audio-preset-btn" onClick={() => handleSfxChange(1)}>100%</button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
