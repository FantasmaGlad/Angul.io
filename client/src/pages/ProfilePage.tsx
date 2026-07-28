import {
  AVATAR_PALETTE,
  DEATH_BANNERS,
  MAX_DEATH_MESSAGE_LENGTH,
  deathBannerById,
} from '@angulio/shared';
import { useEffect, useState } from 'react';
import {
  fetchProfile,
  updateAvatarColor,
  updateDeathScreen,
  type AccountProfile,
} from '../auth.js';
import { modeMeta } from '../modes.js';
import PageLayout from './PageLayout.js';

interface ProfilePageProps {
  authToken: string;
  /** Notifie App.tsx du changement (refonte UI/UX, avatar procédural) pour que le badge de
   * TopNav.tsx reflète la nouvelle couleur sans attendre un rechargement de page. */
  onAvatarColorChange: (color: string) => void;
}

/** Profil (sous-page dédiée, refonte UI/UX — remplace l'ancien `ProfileModal.tsx`, qui
 * s'affichait par-dessus le panneau Compte au lieu d'avoir sa propre URL). */
export default function ProfilePage({ authToken, onAvatarColorChange }: ProfilePageProps) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [error, setError] = useState('');
  const [savingColor, setSavingColor] = useState<string | null>(null);

  const [deathMessageDraft, setDeathMessageDraft] = useState('');
  const [deathBannerDraft, setDeathBannerDraft] = useState('');
  const [deathScreenError, setDeathScreenError] = useState('');
  const [savingDeathScreen, setSavingDeathScreen] = useState(false);
  const [deathScreenSaved, setDeathScreenSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const result = await fetchProfile(authToken);
        if (!cancelled) setProfile(result);
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authToken]);

  // Brouillon initialisé une fois le profil chargé (fetch async) — modifiable librement avant
  // "Enregistrer les modifications", sans écrire à chaque frappe (cahier des charges fourni).
  useEffect(() => {
    if (!profile) return;
    setDeathMessageDraft(profile.deathMessage);
    setDeathBannerDraft(profile.deathBannerId);
  }, [profile]);

  const handlePickColor = (color: string): void => {
    if (color === profile?.avatarColor) return;
    setSavingColor(color);
    void (async () => {
      try {
        const updated = await updateAvatarColor(authToken, color);
        setProfile(updated);
        onAvatarColorChange(color);
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSavingColor(null);
      }
    })();
  };

  const handleSaveDeathScreen = (): void => {
    setSavingDeathScreen(true);
    setDeathScreenSaved(false);
    void (async () => {
      try {
        const updated = await updateDeathScreen(authToken, deathMessageDraft, deathBannerDraft);
        setProfile(updated);
        setDeathScreenError('');
        setDeathScreenSaved(true);
      } catch (err) {
        setDeathScreenError((err as Error).message);
      } finally {
        setSavingDeathScreen(false);
      }
    })();
  };

  const previewBanner = deathBannerById(deathBannerDraft || 'default_skull');

  return (
    <PageLayout title="Profil">
      {error && <p className="error-text">{error}</p>}
      {profile && (
        <>
          <p className="account-status">{profile.pseudo}</p>

          <section className="lobby-section">
            <span className="section-title">Couleur d'avatar (blob en jeu)</span>
            <div className="avatar-swatch-grid">
              {AVATAR_PALETTE.map((color) => (
                <button
                  key={color}
                  type="button"
                  className={`avatar-swatch${profile.avatarColor === color ? ' selected' : ''}`}
                  style={{ background: color }}
                  disabled={savingColor !== null}
                  aria-label={`Choisir la couleur ${color}`}
                  onClick={() => handlePickColor(color)}
                />
              ))}
            </div>
          </section>

          <div className="stat-row">
            <span className="stat-label">Niveau</span>
            <span className="stat-value">{profile.level}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">XP</span>
            <span className="stat-value">{profile.xp}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Premium</span>
            <span className="stat-value">{profile.premium ? 'Oui' : 'Non'}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">Cosmétiques</span>
            <span className="stat-value">
              {profile.cosmetics.length > 0 ? profile.cosmetics.join(', ') : 'Aucun'}
            </span>
          </div>
          <section className="lobby-section">
            <span className="section-title">Écran de mort personnalisé</span>

            <label className="field">
              <span className="field-label-row">
                <span className="field-label">Message de défaite</span>
                <span className="char-counter">
                  {deathMessageDraft.length} / {MAX_DEATH_MESSAGE_LENGTH}
                </span>
              </span>
              <input
                className="clean-input"
                value={deathMessageDraft}
                maxLength={MAX_DEATH_MESSAGE_LENGTH}
                onChange={(event) => setDeathMessageDraft(event.target.value)}
                placeholder="Bien joué ! À la prochaine."
              />
            </label>

            <span className="field-label" style={{ marginTop: 14, display: 'block' }}>
              Bannière de mort
            </span>
            <div className="death-banner-grid">
              {DEATH_BANNERS.map((banner) => {
                const locked = profile.level < banner.unlockLevel;
                return (
                  <button
                    key={banner.id}
                    type="button"
                    className={`death-banner-option${deathBannerDraft === banner.id ? ' selected' : ''}${locked ? ' locked' : ''}`}
                    style={{
                      background: `linear-gradient(135deg, ${banner.gradient[0]}, ${banner.gradient[1]})`,
                    }}
                    disabled={locked}
                    onClick={() => setDeathBannerDraft(banner.id)}
                  >
                    <span className="death-banner-icon">{banner.icon}</span>
                    <span className="death-banner-label">{banner.label}</span>
                    {locked && (
                      <span className="death-banner-lock-badge">Niveau {banner.unlockLevel}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <span className="field-label" style={{ marginTop: 14, display: 'block' }}>
              Prévisualisation en direct
            </span>
            <div className="death-preview-card">
              <div
                className="death-preview-banner"
                style={{
                  background: `linear-gradient(135deg, ${previewBanner.gradient[0]}, ${previewBanner.gradient[1]})`,
                }}
              >
                <span>{previewBanner.icon}</span>
                <span>VOUS ÊTES MORT !</span>
              </div>
              <p className="death-preview-message">
                "{deathMessageDraft || 'Bien joué ! À la prochaine.'}"
              </p>
              <div className="death-preview-stats">
                <span>Masse finale : 1 420</span>
                <span>Rang : #3</span>
                <span>Temps : 04m 12s</span>
              </div>
            </div>

            {deathScreenError && <p className="error-text">{deathScreenError}</p>}
            <button
              className="btn-primary-action"
              type="button"
              disabled={savingDeathScreen}
              onClick={handleSaveDeathScreen}
              style={{ marginTop: 12 }}
            >
              {savingDeathScreen ? 'Enregistrement…' : 'Enregistrer les modifications'}
            </button>
            {deathScreenSaved && <p className="status-text">Enregistré.</p>}
          </section>

          <section className="lobby-section">
            <span className="section-title">Meilleurs scores</span>
            <ul className="profile-scores">
              {profile.bestScores.length === 0 ? (
                <li>Aucune partie jouée pour le moment.</li>
              ) : (
                profile.bestScores.map((score) => (
                  <li key={score.modeId}>
                    <span>{modeMeta(score.modeId).label}</span>
                    <span>{score.bestScore}</span>
                  </li>
                ))
              )}
            </ul>
          </section>
        </>
      )}
    </PageLayout>
  );
}
