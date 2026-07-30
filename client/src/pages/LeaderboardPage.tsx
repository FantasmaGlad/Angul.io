import { SKIN_IMAGE_MAP } from '@angulio/shared';
import { useEffect, useState } from 'react';
import { fetchAvailableModes, fetchLeaderboard, type LeaderboardEntry } from '../lobby.js';
import { modeMeta } from '../modes.js';
import PageLayout from './PageLayout.js';

const LEADERBOARD_LIMIT = 50;

function avatarUrl(avatarColor: string | undefined): string | undefined {
  if (!avatarColor) return undefined;
  return (
    SKIN_IMAGE_MAP[avatarColor] ?? (avatarColor.startsWith('/') ? avatarColor : `/assets/Profil/${avatarColor}.png`)
  );
}

/** Classement public : onglet "Global" (XP totale, tous modes confondus) + un onglet par mode de
 * jeu actif (meilleur score de ce mode) — voir `GET /api/leaderboard` côté serveur. Remplace
 * l'ancien placeholder "Bientôt disponible", l'endpoint et les données existaient déjà
 * (xp/level/player_best_scores) mais n'étaient jamais exposés publiquement. */
export default function LeaderboardPage() {
  const [modes, setModes] = useState<string[]>(['vanilla', 'hardcore']);
  const [activeTab, setActiveTab] = useState('global');
  const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    void (async () => {
      try {
        const fetched = await fetchAvailableModes();
        if (fetched.length > 0) setModes(fetched);
      } catch {
        // Repli par défaut (déjà initialisé) — pas bloquant pour l'affichage du classement.
      }
    })();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    void (async () => {
      try {
        const result = await fetchLeaderboard(activeTab, LEADERBOARD_LIMIT);
        if (!cancelled) {
          setEntries(result);
          setError('');
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeTab]);

  const tabs = [
    { id: 'global', label: 'Global · XP' },
    { id: 'mass', label: 'Global · Meilleure Masse' },
    ...modes.map((modeId) => ({ id: modeId, label: modeMeta(modeId).label })),
  ];

  return (
    <PageLayout title="Classements" wide>
      <div className="leaderboard-page-tabs">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            type="button"
            className={`leaderboard-page-tab${activeTab === tab.id ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
      </div>

      <section className="lobby-section">
        <span className="section-title">
          {activeTab === 'global'
            ? 'Top Joueurs — XP Totale'
            : activeTab === 'mass'
            ? 'Top Joueurs — Meilleure Masse (Tous modes)'
            : `Top Joueurs — ${modeMeta(activeTab).label}`}
        </span>

        {error && <p className="error-text">{error}</p>}

        {!error && loading && <p className="account-status" style={{ marginTop: 12 }}>Chargement du classement…</p>}

        {!error && !loading && entries.length === 0 && (
          <div className="placeholder" style={{ marginTop: 14 }}>
            <span className="placeholder-tag">Aucun score</span>
            <p>Aucun joueur classé pour le moment sur cet onglet — sois le premier à marquer des points.</p>
          </div>
        )}

        {!error && !loading && entries.length > 0 && (
          <div className="leaderboard-page-table" style={{ marginTop: 14 }}>
            {entries.map((entry) => {
              const url = avatarUrl(entry.avatarColor);
              return (
                <div
                  key={`${entry.rank}-${entry.pseudo}`}
                  className={`leaderboard-page-row${entry.rank <= 3 ? ' top3' : ''}`}
                >
                  <span className="leaderboard-page-rank">#{entry.rank}</span>
                  {url ? (
                    <img src={url} alt="" className="leaderboard-page-avatar" />
                  ) : (
                    <span className="leaderboard-page-avatar-fallback">
                      {entry.pseudo.charAt(0).toUpperCase()}
                    </span>
                  )}
                  <span className="leaderboard-page-pseudo">{entry.pseudo}</span>
                  <span className="account-badge-pill">Niveau {entry.level}</span>
                  <span className="leaderboard-page-score">
                    {entry.score.toLocaleString('fr-FR')} {activeTab === 'global' ? 'XP' : 'Masse'}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </PageLayout>
  );
}
