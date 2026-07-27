import { useEffect, useState } from 'react';
import { fetchProfile, type AccountProfile } from '../auth.js';
import { modeMeta } from '../modes.js';

interface ProfileModalProps {
  authToken: string;
  onClose: () => void;
}

/** Profil (ouvert depuis le panneau Compte, superposé — §4.5 cahier_des_charges_ui_ux.md). */
export default function ProfileModal({ authToken, onClose }: ProfileModalProps) {
  const [profile, setProfile] = useState<AccountProfile | null>(null);
  const [error, setError] = useState('');

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

  return (
    <div className="profile-overlay">
      <div className="profile-panel">
        <div className="panel-header">
          <h1>Profil</h1>
          <button className="panel-close" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
        {error && <p className="error-text">{error}</p>}
        {profile && (
          <>
            <p className="account-status">{profile.pseudo}</p>
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
      </div>
    </div>
  );
}
