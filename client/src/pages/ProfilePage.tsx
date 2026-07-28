import { AVATAR_PALETTE } from '@angulio/shared';
import { useEffect, useState } from 'react';
import { fetchProfile, updateAvatarColor, type AccountProfile } from '../auth.js';
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
