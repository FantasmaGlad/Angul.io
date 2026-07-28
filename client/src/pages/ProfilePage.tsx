import {
  DEATH_BANNERS,
  MAX_DEATH_MESSAGE_LENGTH,
  SKIN_IMAGE_MAP,
  SKINS,
  deathBannerById,
} from '@angulio/shared';
import { useEffect, useState } from 'react';
import {
  fetchProfile,
  updateAvatarColor,
  updateDeathScreen,
  type AccountProfile,
} from '../auth.js';
import FpsModeSelector from '../components/FpsModeSelector.js';
import { modeMeta } from '../modes.js';
import { navigate } from '../router.js';
import PageLayout from './PageLayout.js';

interface ProfilePageProps {
  authToken: string | undefined;
  onAvatarColorChange: (color: string) => void;
  currentSkin?: string;
}

export default function ProfilePage({ authToken, onAvatarColorChange, currentSkin }: ProfilePageProps) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [error, setError] = useState('');
  const [savingColor, setSavingColor] = useState<string | null>(null);

  const [deathMessageDraft, setDeathMessageDraft] = useState('');
  const [deathBannerDraft, setDeathBannerDraft] = useState('');
  const [deathScreenError, setDeathScreenError] = useState('');
  const [savingDeathScreen, setSavingDeathScreen] = useState(false);
  const [deathScreenSaved, setDeathScreenSaved] = useState(false);

  useEffect(() => {
    if (!authToken) {
      setProfile(null);
      return;
    }
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

  useEffect(() => {
    if (!profile) return;
    setDeathMessageDraft(profile.deathMessage);
    setDeathBannerDraft(profile.deathBannerId);
  }, [profile]);

  const activeSkin = profile?.avatarColor ?? currentSkin ?? 'Banane';

  const handlePickColor = (color: string): void => {
    onAvatarColorChange(color);
    try {
      localStorage.setItem('angulio.guestSkin', color);
    } catch {}

    if (!authToken || color === profile?.avatarColor) return;
    setSavingColor(color);
    void (async () => {
      try {
        const updated = await updateAvatarColor(authToken, color);
        setProfile(updated);
        setError('');
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setSavingColor(null);
      }
    })();
  };

  const handleSaveDeathScreen = (): void => {
    if (!authToken) return;
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

      <section className="lobby-section">
        <span className="section-title">Choix du Skin d'Avatar</span>
        <div className="avatar-swatch-grid">
          {SKINS.map((skin) => (
            <button
              key={skin}
              type="button"
              className={`avatar-swatch${activeSkin === skin ? ' selected' : ''}`}
              disabled={savingColor !== null}
              aria-label={`Choisir le skin ${skin}`}
              onClick={() => handlePickColor(skin)}
            >
              <img src={SKIN_IMAGE_MAP[skin]} alt={skin} className="avatar-skin-img" />
              <span className="avatar-skin-name">{skin}</span>
            </button>
          ))}
        </div>
      </section>

      <FpsModeSelector />

      {!authToken && (
        <section className="lobby-section">
          <span className="section-title">Compte Invité</span>
          <p className="account-status">
            Tu joues actuellement en tant qu'invité. Ton skin sélectionné est actif pour tes prochaines parties. Connecte-toi pour enregistrer tes scores et personnaliser ton écran de mort !
          </p>
          <button
            className="btn-primary-action"
            type="button"
            onClick={() => navigate('/compte')}
          >
            Se connecter / S'inscrire
          </button>
        </section>
      )}

      {profile && (
        <>
          <section className="lobby-section">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
              <span className="section-title">Joueur : {profile.pseudo}</span>
              <button
                className="btn-ghost"
                type="button"
                onClick={() => navigate('/compte')}
              >
                Gérer le compte / Déconnexion
              </button>
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
