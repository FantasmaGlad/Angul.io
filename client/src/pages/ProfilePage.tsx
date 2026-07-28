import {
  DEATH_BANNERS,
  MAX_DEATH_MESSAGE_LENGTH,
  SKIN_IMAGE_MAP,
  SKINS,
  deathBannerById,
  isCustomImageBanner,
} from '@angulio/shared';
import { useEffect, useState } from 'react';
import {
  fetchProfile,
  updateAvatarColor,
  updateDeathScreen,
  type AccountProfile,
} from '../auth.js';
import { modeMeta } from '../modes.js';
import { navigate } from '../router.js';
import PageLayout from './PageLayout.js';

interface ProfilePageProps {
  authToken: string | undefined;
  onAvatarColorChange: (color: string) => void;
  currentSkin?: string;
}

function calculateXpProgress(totalXp: number) {
  let level = 1;
  let remaining = Math.max(0, totalXp);
  let cost = 1000;
  while (remaining >= cost && level < 1000) {
    remaining -= cost;
    level += 1;
    cost = Math.round(cost * 1.2 - 150);
  }
  const pct = Math.min(100, Math.max(0, Math.floor((remaining / cost) * 100)));
  return { level, currentXpInLevel: remaining, costForNextLevel: cost, pct };
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
  const xpProg = profile ? calculateXpProgress(profile.xp) : null;

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

          {xpProg && (
            <div className="xp-progress-card">
              <div className="xp-progress-header">
                <span>Niveau {xpProg.level}</span>
                <span>{xpProg.pct}%</span>
              </div>
              <div className="xp-progress-track">
                <div className="xp-progress-fill" style={{ width: `${xpProg.pct}%` }} />
              </div>
              <span className="xp-progress-text">
                {xpProg.currentXpInLevel} / {xpProg.costForNextLevel} XP ({profile.xp} XP total)
              </span>
            </div>
          )}

          <div className="stat-row">
            <span className="stat-label">Niveau</span>
            <span className="stat-value">{profile.level}</span>
          </div>
          <div className="stat-row">
            <span className="stat-label">XP Total</span>
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

            <span className="field-label" style={{ marginTop: 16, display: 'block' }}>
              Image ou GIF personnalisé (tous formats)
            </span>
            <div className="custom-banner-uploader">
              <label htmlFor="banner-file-input">Téléverser une image ou GIF local :</label>
              <input
                id="banner-file-input"
                type="file"
                accept="image/*,.gif,.png,.jpg,.jpeg,.webp,.svg"
                style={{ display: 'none' }}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  if (file.size > 5 * 1024 * 1024) {
                    setDeathScreenError('Le fichier est trop volumineux (max 5 Mo).');
                    return;
                  }
                  const reader = new FileReader();
                  reader.onload = (event) => {
                    const result = event.target?.result as string;
                    if (result) {
                      setDeathBannerDraft(result);
                      setDeathScreenError('');
                    }
                  };
                  reader.readAsDataURL(file);
                }}
              />
              <button
                type="button"
                className="file-upload-btn"
                onClick={() => document.getElementById('banner-file-input')?.click()}
              >
                <span className="material-symbols-outlined">upload_file</span>
                Choisir une image ou un GIF (PNG, JPG, GIF, WEBP...)
              </button>

              <label htmlFor="banner-url-input" style={{ marginTop: 8 }}>Ou coller un lien URL d'image/GIF :</label>
              <input
                id="banner-url-input"
                className="clean-input"
                placeholder="https://exemple.com/image.gif"
                value={isCustomImageBanner(deathBannerDraft) ? deathBannerDraft : ''}
                onChange={(e) => {
                  const val = e.target.value.trim();
                  if (val) setDeathBannerDraft(val);
                }}
              />
            </div>

            <span className="field-label" style={{ marginTop: 14, display: 'block' }}>
              Thèmes prédéfinis
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
                    <span className="material-symbols-outlined" style={{ fontSize: '24px', marginRight: '6px', verticalAlign: 'middle' }}>
                      {banner.icon}
                    </span>
                    <span className="death-banner-label">{banner.label}</span>
                    {locked && (
                      <span className="death-banner-lock-badge">Niveau {banner.unlockLevel}</span>
                    )}
                  </button>
                );
              })}
            </div>

            <span className="field-label" style={{ marginTop: 16, display: 'block' }}>
              Prévisualisation en direct
            </span>
            <div className="death-preview-card">
              <div
                className="death-preview-banner"
                style={{
                  background: isCustomImageBanner(deathBannerDraft)
                    ? `url("${deathBannerDraft}") center/cover no-repeat`
                    : `linear-gradient(135deg, ${previewBanner.gradient[0]}, ${previewBanner.gradient[1]})`,
                  minHeight: 80,
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                {isCustomImageBanner(deathBannerDraft) && (
                  <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)' }} />
                )}
                <div style={{ position: 'relative', zIndex: 1 }}>
                  {!isCustomImageBanner(deathBannerDraft) && (
                    <span className="material-symbols-outlined" style={{ fontSize: '28px', display: 'block', marginBottom: '4px' }}>
                      {previewBanner.icon}
                    </span>
                  )}
                  <span style={{ fontWeight: 800, textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>
                    VOUS ÊTES MORT !
                  </span>
                </div>
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
