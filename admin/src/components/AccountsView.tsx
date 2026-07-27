import { useState } from 'react';
import {
  getAccount,
  searchAccounts,
  updateAccount,
  type AdminAccountDetail,
  type AdminAccountView,
} from '../adminApi.js';

interface AccountsViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

/** Comptes joueurs (Lot 5.2-5.4) : recherche, correction XP/niveau, cosmétiques, bannissement. */
export default function AccountsView({ token, onAuthError }: AccountsViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminAccountView[]>([]);
  const [searchError, setSearchError] = useState('');

  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [level, setLevel] = useState('');
  const [xp, setXp] = useState('');
  const [premium, setPremium] = useState(false);
  const [banned, setBanned] = useState(false);
  const [cosmetics, setCosmetics] = useState('');
  const [detailError, setDetailError] = useState('');
  const [detailStatus, setDetailStatus] = useState('');

  const runSearch = (): void => {
    void (async () => {
      try {
        setResults(await searchAccounts(token, query.trim()));
        setSearchError('');
      } catch (error) {
        // Un token expiré/révoqué (ex. redémarrage serveur, sessions en mémoire) ramène à
        // l'écran de connexion plutôt que d'afficher une liste vide silencieuse.
        const message = (error as Error).message;
        setSearchError(message);
        onAuthError(message);
      }
    })();
  };

  const loadDetail = (id: number): void => {
    void (async () => {
      setDetailError('');
      setDetailStatus('');
      try {
        const account = await getAccount(token, id);
        setDetail(account);
        setLevel(String(account.level));
        setXp(String(account.xp));
        setPremium(account.premium);
        setBanned(account.banned);
        setCosmetics(account.cosmetics.join(', '));
      } catch (error) {
        setDetailError((error as Error).message);
      }
    })();
  };

  const handleSave = (): void => {
    void (async () => {
      if (!detail) return;
      setDetailError('');
      setDetailStatus('');
      try {
        const updated = await updateAccount(token, detail.id, {
          level: Number(level),
          xp: Number(xp),
          premium,
          banned,
          cosmetics: cosmetics
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0),
        });
        setDetail({ ...detail, ...updated });
        setDetailStatus('Enregistré.');
        runSearch();
      } catch (error) {
        setDetailError((error as Error).message);
      }
    })();
  };

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Comptes joueurs</h2>
          <p className="view-subtitle">
            Recherche, correction XP/niveau, cosmétiques, bannissement.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="search-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch();
            }}
            placeholder="Rechercher un pseudo…"
          />
          <button className="btn-ghost" type="button" onClick={runSearch}>
            Rechercher
          </button>
        </div>
        <ul className="result-list">
          {results.length === 0 ? (
            <li>Aucun compte trouvé.</li>
          ) : (
            results.map((account) => (
              <li key={account.id} className="result-item" onClick={() => loadDetail(account.id)}>
                <span>{account.pseudo}</span>
                <span className="badge">
                  {[account.premium ? 'Premium' : '', account.banned ? 'Banni' : '']
                    .filter(Boolean)
                    .join(' · ')}
                </span>
              </li>
            ))
          )}
        </ul>
        <p className="error-text">{searchError}</p>
      </section>

      {detail && (
        <section className="panel">
          <h2 style={{ fontSize: 16 }}>
            {detail.pseudo} (#{detail.id})
          </h2>

          <div className="field-grid">
            <div>
              <label htmlFor="detail-level">Niveau</label>
              <input
                id="detail-level"
                type="number"
                min={1}
                step={1}
                value={level}
                onChange={(event) => setLevel(event.target.value)}
              />
            </div>
            <div>
              <label htmlFor="detail-xp">XP</label>
              <input
                id="detail-xp"
                type="number"
                min={0}
                step={1}
                value={xp}
                onChange={(event) => setXp(event.target.value)}
              />
            </div>
          </div>

          <div className="checkbox-row">
            <div>
              <input
                id="detail-premium"
                type="checkbox"
                checked={premium}
                onChange={(event) => setPremium(event.target.checked)}
              />
              <label htmlFor="detail-premium">Premium</label>
            </div>
            <div>
              <input
                id="detail-banned"
                type="checkbox"
                checked={banned}
                onChange={(event) => setBanned(event.target.checked)}
              />
              <label htmlFor="detail-banned">Banni</label>
            </div>
          </div>

          <span className="section-title">Cosmétiques (séparés par des virgules)</span>
          <input
            value={cosmetics}
            onChange={(event) => setCosmetics(event.target.value)}
            placeholder="ex. chapeau, aura_or"
            style={{ width: '100%', marginTop: 6 }}
          />

          <span className="section-title">Meilleurs scores</span>
          <ul className="result-list">
            {detail.bestScores.length === 0 ? (
              <li>Aucune partie jouée.</li>
            ) : (
              detail.bestScores.map((score) => (
                <li key={score.modeId}>
                  <span>{score.modeId}</span>
                  <span>{score.bestScore}</span>
                </li>
              ))
            )}
          </ul>

          <button className="btn-primary save-button" type="button" onClick={handleSave}>
            Enregistrer
          </button>
          <p className="error-text">{detailError}</p>
          <p className="status-text">{detailStatus}</p>
        </section>
      )}
    </div>
  );
}
