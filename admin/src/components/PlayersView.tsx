import { useEffect, useState } from 'react';
import {
  getAccount,
  resetBestScore,
  searchAccounts,
  updateAccount,
  type AdminAccountDetail,
  type AdminAccountView,
  type AdminSearchQuery,
} from '../adminApi.js';

interface PlayersViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

const PAGE_SIZE = 20;

/** Onglet "Joueurs" (§3.1-3.2 cahier_des_charges_admin.md) — recherche/filtres/tri paginés,
 * édition complète d'un compte (droit de lecture/écriture total). */
export default function PlayersView({ token, onAuthError }: PlayersViewProps) {
  const [q, setQ] = useState('');
  const [ip, setIp] = useState('');
  const [premiumOnly, setPremiumOnly] = useState(false);
  const [bannedOnly, setBannedOnly] = useState(false);
  const [sortBy, setSortBy] = useState<NonNullable<AdminSearchQuery['sortBy']>>('pseudo');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');
  const [offset, setOffset] = useState(0);

  const [results, setResults] = useState<AdminAccountView[]>([]);
  const [total, setTotal] = useState(0);
  const [searchError, setSearchError] = useState('');

  const [detail, setDetail] = useState<AdminAccountDetail | null>(null);
  const [pseudo, setPseudo] = useState('');
  const [level, setLevel] = useState('');
  const [xp, setXp] = useState('');
  const [premium, setPremium] = useState(false);
  const [banned, setBanned] = useState(false);
  const [avatarColor, setAvatarColor] = useState('');
  const [deathMessage, setDeathMessage] = useState('');
  const [deathBannerId, setDeathBannerId] = useState('');
  const [cosmetics, setCosmetics] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [detailError, setDetailError] = useState('');
  const [detailStatus, setDetailStatus] = useState('');

  const runSearch = (nextOffset = offset): void => {
    void (async () => {
      try {
        const response = await searchAccounts(token, {
          q: q.trim() || undefined,
          ip: ip.trim() || undefined,
          premium: premiumOnly || undefined,
          banned: bannedOnly || undefined,
          sortBy,
          sortDir,
          limit: PAGE_SIZE,
          offset: nextOffset,
        });
        setResults(response.rows);
        setTotal(response.total);
        setOffset(nextOffset);
        setSearchError('');
      } catch (error) {
        const message = (error as Error).message;
        setSearchError(message);
        onAuthError(message);
      }
    })();
  };

  // Liste chargée dès l'ouverture de l'onglet (§3.1 : "pratique pour parcourir la base") —
  // plutôt que d'attendre un premier clic sur "Rechercher".
  useEffect(() => {
    runSearch(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const loadDetail = (id: number): void => {
    void (async () => {
      setDetailError('');
      setDetailStatus('');
      setNewPassword('');
      try {
        const account = await getAccount(token, id);
        setDetail(account);
        setPseudo(account.pseudo);
        setLevel(String(account.level));
        setXp(String(account.xp));
        setPremium(account.premium);
        setBanned(account.banned);
        setAvatarColor(account.avatarColor ?? '');
        setDeathMessage(account.deathMessage);
        setDeathBannerId(account.deathBannerId);
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
          pseudo: pseudo !== detail.pseudo ? pseudo : undefined,
          level: Number(level),
          xp: Number(xp),
          premium,
          banned,
          avatarColor: avatarColor || undefined,
          deathMessage: deathMessage || undefined,
          deathBannerId: deathBannerId || undefined,
          newPassword: newPassword || undefined,
          cosmetics: cosmetics
            .split(',')
            .map((c) => c.trim())
            .filter((c) => c.length > 0),
        });
        setDetail({ ...detail, ...updated });
        setNewPassword('');
        setDetailStatus('Enregistré.');
        runSearch();
      } catch (error) {
        setDetailError((error as Error).message);
      }
    })();
  };

  const handleResetBestScore = (modeId?: string): void => {
    void (async () => {
      if (!detail) return;
      try {
        await resetBestScore(token, detail.id, modeId);
        setDetail(await getAccount(token, detail.id));
        setDetailStatus('Meilleur(s) score(s) réinitialisé(s).');
      } catch (error) {
        setDetailError((error as Error).message);
      }
    })();
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Joueurs</h2>
          <p className="view-subtitle">
            Recherche par pseudo/ID/IP, filtres, tri, édition complète des comptes.
          </p>
        </div>
      </div>

      <section className="panel">
        <div className="search-row">
          <input
            value={q}
            onChange={(event) => setQ(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(0);
            }}
            placeholder="Pseudo ou ID…"
          />
          <input
            value={ip}
            onChange={(event) => setIp(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') runSearch(0);
            }}
            placeholder="Adresse IP…"
            style={{ maxWidth: 160 }}
          />
          <button className="btn-ghost" type="button" onClick={() => runSearch(0)}>
            Rechercher
          </button>
        </div>

        <div className="filter-row">
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={premiumOnly}
              onChange={(event) => setPremiumOnly(event.target.checked)}
            />
            Premium uniquement
          </label>
          <label className="filter-checkbox">
            <input
              type="checkbox"
              checked={bannedOnly}
              onChange={(event) => setBannedOnly(event.target.checked)}
            />
            Bannis uniquement
          </label>
          <select value={sortBy} onChange={(event) => setSortBy(event.target.value as typeof sortBy)}>
            <option value="pseudo">Trier : Pseudo</option>
            <option value="level">Trier : Niveau</option>
            <option value="xp">Trier : XP</option>
            <option value="bestScore">Trier : Meilleur score</option>
            <option value="createdAt">Trier : Date de création</option>
            <option value="lastLoginAt">Trier : Dernière connexion</option>
            <option value="totalPlaytimeSec">Trier : Temps de jeu total</option>
          </select>
          <select value={sortDir} onChange={(event) => setSortDir(event.target.value as 'asc' | 'desc')}>
            <option value="asc">Croissant</option>
            <option value="desc">Décroissant</option>
          </select>
          <button className="btn-ghost" type="button" onClick={() => runSearch(0)}>
            Appliquer
          </button>
        </div>

        <table className="data-table">
          <thead>
            <tr>
              <th>Pseudo</th>
              <th>Niveau</th>
              <th>XP</th>
              <th>Meilleur score</th>
              <th>Statut</th>
              <th>Dernière connexion</th>
            </tr>
          </thead>
          <tbody>
            {results.length === 0 ? (
              <tr>
                <td colSpan={6}>Aucun compte trouvé.</td>
              </tr>
            ) : (
              results.map((account) => (
                <tr key={account.id} className="data-row" onClick={() => loadDetail(account.id)}>
                  <td>
                    {account.pseudo} <span className="id-tag">#{account.id}</span>
                  </td>
                  <td>{account.level}</td>
                  <td>{account.xp}</td>
                  <td>{account.bestScore ?? '—'}</td>
                  <td>
                    {[account.premium ? 'Premium' : '', account.banned ? 'Banni' : '']
                      .filter(Boolean)
                      .join(' · ') || '—'}
                  </td>
                  <td>
                    {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : 'Jamais'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>

        <div className="pagination-row">
          <button
            className="btn-ghost"
            type="button"
            disabled={offset === 0}
            onClick={() => runSearch(Math.max(0, offset - PAGE_SIZE))}
          >
            ← Précédent
          </button>
          <span>
            Page {currentPage} / {totalPages} ({total} comptes)
          </span>
          <button
            className="btn-ghost"
            type="button"
            disabled={offset + PAGE_SIZE >= total}
            onClick={() => runSearch(offset + PAGE_SIZE)}
          >
            Suivant →
          </button>
        </div>
        <p className="error-text">{searchError}</p>
      </section>

      {detail && (
        <section className="panel">
          <h2 style={{ fontSize: 16 }}>
            {detail.pseudo} (#{detail.id})
          </h2>

          <div className="field-grid">
            <div>
              <label htmlFor="detail-pseudo">Pseudo</label>
              <input id="detail-pseudo" value={pseudo} onChange={(e) => setPseudo(e.target.value)} />
            </div>
            <div>
              <label htmlFor="detail-newpass">Nouveau mot de passe</label>
              <input
                id="detail-newpass"
                type="text"
                placeholder="Laisser vide pour ne pas changer"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="detail-level">Niveau</label>
              <input
                id="detail-level"
                type="number"
                min={1}
                step={1}
                value={level}
                onChange={(e) => setLevel(e.target.value)}
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
                onChange={(e) => setXp(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="detail-avatar">Couleur d'avatar</label>
              <input
                id="detail-avatar"
                placeholder="#rrggbb"
                value={avatarColor}
                onChange={(e) => setAvatarColor(e.target.value)}
              />
            </div>
            <div>
              <label htmlFor="detail-banner">Bannière de mort</label>
              <input
                id="detail-banner"
                value={deathBannerId}
                onChange={(e) => setDeathBannerId(e.target.value)}
              />
            </div>
          </div>

          <span className="section-title">Message de mort personnalisé</span>
          <input
            value={deathMessage}
            onChange={(e) => setDeathMessage(e.target.value)}
            style={{ width: '100%', marginTop: 6 }}
          />

          <div className="checkbox-row">
            <div>
              <input
                id="detail-premium"
                type="checkbox"
                checked={premium}
                onChange={(e) => setPremium(e.target.checked)}
              />
              <label htmlFor="detail-premium">Premium</label>
            </div>
            <div>
              <input
                id="detail-banned"
                type="checkbox"
                checked={banned}
                onChange={(e) => setBanned(e.target.checked)}
              />
              <label htmlFor="detail-banned">Banni</label>
            </div>
          </div>

          <span className="section-title">Cosmétiques (séparés par des virgules)</span>
          <input
            value={cosmetics}
            onChange={(e) => setCosmetics(e.target.value)}
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
                  <button
                    className="btn-ghost"
                    type="button"
                    onClick={() => handleResetBestScore(score.modeId)}
                  >
                    Réinitialiser
                  </button>
                </li>
              ))
            )}
          </ul>
          {detail.bestScores.length > 0 && (
            <button
              className="btn-ghost"
              type="button"
              onClick={() => handleResetBestScore(undefined)}
              style={{ marginTop: 8 }}
            >
              Tout réinitialiser
            </button>
          )}

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
