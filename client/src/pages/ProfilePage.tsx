import {
  MAX_DEATH_MESSAGE_LENGTH,
  SKIN_IMAGE_MAP,
  SKINS,
  isCustomImageBanner,
} from '@angulio/shared';
import { useEffect, useRef, useState } from 'react';
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

interface AvatarSwiperProps {
  activeSkin: string;
  onPickColor: (skin: string) => void;
  disabled: boolean;
}

function AvatarSwiper({ activeSkin, onPickColor, disabled }: AvatarSwiperProps) {
  const trackRef = useRef<HTMLDivElement>(null);

  const scroll = (direction: 'left' | 'right') => {
    if (!trackRef.current) return;
    const amount = direction === 'left' ? -280 : 280;
    trackRef.current.scrollBy({ left: amount, behavior: 'smooth' });
  };

  return (
    <div className="avatar-swiper-wrapper">
      <button
        type="button"
        className="swiper-arrow-btn"
        onClick={() => scroll('left')}
        aria-label="Défiler vers la gauche"
      >
        <span className="material-symbols-outlined">chevron_left</span>
      </button>

      <div className="avatar-swiper-track" ref={trackRef}>
        {SKINS.map((skin) => (
          <button
            key={skin}
            type="button"
            className={`avatar-swiper-card${activeSkin === skin ? ' selected' : ''}`}
            disabled={disabled}
            aria-label={`Choisir le skin ${skin}`}
            onClick={() => onPickColor(skin)}
          >
            <img
              src={SKIN_IMAGE_MAP[skin]}
              alt={skin}
              style={{ width: 68, height: 68, objectFit: 'contain' }}
            />
            <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text)' }}>{skin}</span>
            {activeSkin === skin && (
              <span className="account-badge-pill premium" style={{ fontSize: 9, padding: '2px 6px' }}>
                Actif
              </span>
            )}
          </button>
        ))}
      </div>

      <button
        type="button"
        className="swiper-arrow-btn"
        onClick={() => scroll('right')}
        aria-label="Défiler vers la droite"
      >
        <span className="material-symbols-outlined">chevron_right</span>
      </button>
    </div>
  );
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

  const xpProg = profile ? calculateXpProgress(profile.xp) : null;

  const handleLogout = (): void => {
    localStorage.removeItem('angulio.session');
    window.location.href = '/';
  };

  return (
    <PageLayout title="Profil Joueur" wide={true}>
      {error && <p className="error-text">{error}</p>}

      {!authToken && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          <section className="lobby-section">
            <span className="section-title">Compte Invité</span>
            <p className="account-status" style={{ marginTop: 6 }}>
              Vous jouez actuellement en tant qu'invité. Votre skin sélectionné est actif pour vos prochaines parties. Connectez-vous pour enregistrer vos scores et personnaliser votre écran de mort !
            </p>
            <button
              className="btn-primary-action"
              type="button"
              onClick={() => navigate('/compte')}
              style={{ marginTop: 12 }}
            >
              Se connecter / S'inscrire
            </button>
          </section>

          <section className="lobby-section">
            <span className="section-title">Choix du Skin d'Avatar (Carrousel)</span>
            <AvatarSwiper
              activeSkin={activeSkin}
              onPickColor={handlePickColor}
              disabled={savingColor !== null}
            />
          </section>
        </div>
      )}

      {profile && (
        <>
          <div className="profile-header-banner">
            <div className="profile-header-user">
              <img
                src={SKIN_IMAGE_MAP[activeSkin] ?? SKIN_IMAGE_MAP.Banane}
                alt={activeSkin}
                style={{ width: 56, height: 56, borderRadius: '50%', border: '2px solid var(--accent)' }}
              />
              <div>
                <div style={{ fontWeight: 800, fontSize: 18, color: 'var(--text)' }}>
                  Joueur : {profile.pseudo}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                  <span className="account-badge-pill premium">Niveau {profile.level}</span>
                  <span className="account-badge-pill">{profile.premium ? 'Compte Premium' : 'Compte Membre'}</span>
                </div>
              </div>
            </div>

            <button className="btn-ghost" type="button" onClick={handleLogout}>
              <span className="material-symbols-outlined" style={{ fontSize: 18, marginRight: 6, verticalAlign: 'middle' }}>
                logout
              </span>
              Déconnexion
            </button>
          </div>

          <div className="profile-dashboard-grid">
            {/* Colonne de Gauche : Skins & Statistiques */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <section className="lobby-section">
                <span className="section-title">Choix du Skin d'Avatar</span>
                <AvatarSwiper
                  activeSkin={activeSkin}
                  onPickColor={handlePickColor}
                  disabled={savingColor !== null}
                />
              </section>

              {xpProg && (
                <section className="lobby-section">
                  <span className="section-title">Progression de Niveau</span>
                  <div className="xp-progress-card" style={{ marginTop: 10 }}>
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
                </section>
              )}

              <section className="lobby-section">
                <span className="section-title">Statistiques du Compte</span>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 10 }}>
                  <div className="stat-row">
                    <span className="stat-label">Niveau Actuel</span>
                    <span className="stat-value">{profile.level}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">XP Cumulé</span>
                    <span className="stat-value">{profile.xp} XP</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Statut du Compte</span>
                    <span className="stat-value">{profile.premium ? 'Premium' : 'Standard'}</span>
                  </div>
                  <div className="stat-row">
                    <span className="stat-label">Cosmétiques Débloqués</span>
                    <span className="stat-value">
                      {profile.cosmetics.length > 0 ? profile.cosmetics.join(', ') : 'Aucun'}
                    </span>
                  </div>
                </div>
              </section>

              <section className="lobby-section">
                <span className="section-title">Meilleurs Scores</span>
                <ul className="profile-scores" style={{ marginTop: 10 }}>
                  {profile.bestScores.length === 0 ? (
                    <li style={{ color: 'var(--text-soft)' }}>Aucune partie enregistrée pour le moment.</li>
                  ) : (
                    profile.bestScores.map((score) => (
                      <li key={score.modeId}>
                        <span>{modeMeta(score.modeId).label}</span>
                        <strong>{score.bestScore} pts</strong>
                      </li>
                    ))
                  )}
                </ul>
              </section>
            </div>

            {/* Colonne de Droite : Écran de Mort & Customisation */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
              <section className="lobby-section">
                <span className="section-title">Écran de Mort Personnalisé</span>

                <label className="field" style={{ marginTop: 12 }}>
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
                      setDeathBannerDraft(val);
                    }}
                  />
                </div>

                <span className="field-label" style={{ marginTop: 18, display: 'block' }}>
                  Aperçu en Direct de l'Écran de Mort
                </span>
                <div className="death-preview-card">
                  <div
                    className="death-preview-banner"
                    style={{
                      background: isCustomImageBanner(deathBannerDraft)
                        ? `url("${deathBannerDraft}") center/cover no-repeat`
                        : 'linear-gradient(135deg, rgba(30, 32, 34, 0.95), rgba(20, 22, 24, 0.95))',
                      minHeight: 100,
                      position: 'relative',
                      overflow: 'hidden',
                      borderRadius: 'var(--radius-md)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      color: '#ffffff',
                      border: '1px solid var(--border-strong)',
                    }}
                  >
                    {isCustomImageBanner(deathBannerDraft) && (
                      <div style={{ position: 'absolute', inset: 0, background: 'rgba(0, 0, 0, 0.45)' }} />
                    )}
                    <div style={{ position: 'relative', zIndex: 1, textAlign: 'center' }}>
                      <span style={{ fontWeight: 800, fontSize: 16, textShadow: '0 2px 4px rgba(0,0,0,0.6)' }}>
                        VOUS ÊTES MORT !
                      </span>
                    </div>
                  </div>
                  <p className="death-preview-message" style={{ textAlign: 'center', margin: '12px 0 8px 0', fontStyle: 'italic' }}>
                    "{deathMessageDraft || 'Bien joué ! À la prochaine.'}"
                  </p>
                  <div className="death-preview-stats">
                    <span>Masse finale : 1 420</span>
                    <span>Rang : #3</span>
                    <span>Temps : 04m 12s</span>
                  </div>
                </div>

                {deathScreenError && <p className="error-text" style={{ marginTop: 10 }}>{deathScreenError}</p>}
                <button
                  className="btn-primary-action"
                  type="button"
                  disabled={savingDeathScreen}
                  onClick={handleSaveDeathScreen}
                  style={{ marginTop: 14, width: '100%', padding: '12px 18px' }}
                >
                  {savingDeathScreen ? 'Enregistrement…' : 'Enregistrer les modifications'}
                </button>
                {deathScreenSaved && <p className="status-text" style={{ marginTop: 8, textAlign: 'center' }}>Enregistré avec succès.</p>}
              </section>
            </div>
          </div>
        </>
      )}
    </PageLayout>
  );
}
