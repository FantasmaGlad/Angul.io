import { useState } from 'react';
import { searchAccounts, updateAccount, type AdminAccountView } from '../adminApi.js';

interface PremiumViewProps {
  token: string;
  onAuthError: (message: string) => void;
}

/** Premium & dons (nouveau, §5.5 cahier_des_charges_ui_ux.md) : raccourci de recherche +
 * activation rapide — réutilise l'action déjà existante (PATCH /api/admin/players/:id), pas de
 * nouveau backend. */
export default function PremiumView({ token, onAuthError }: PremiumViewProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<AdminAccountView[]>([]);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');

  const runSearch = (): void => {
    void (async () => {
      setError('');
      setStatus('');
      try {
        setResults(await searchAccounts(token, query.trim()));
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        onAuthError(message);
      }
    })();
  };

  const activate = (id: number): void => {
    void (async () => {
      setError('');
      setStatus('');
      try {
        const updated = await updateAccount(token, id, { premium: true });
        setResults((current) => current.map((a) => (a.id === id ? { ...a, premium: true } : a)));
        setStatus(`Premium activé pour ${updated.pseudo}.`);
      } catch (err) {
        setError((err as Error).message);
      }
    })();
  };

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Premium &amp; dons</h2>
          <p className="view-subtitle">
            Un don Ko-fi arrive → recherche le pseudo indiqué dans le message de don → active.
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
              <li key={account.id}>
                <div className="premium-row">
                  <span className="pseudo">{account.pseudo}</span>
                  <button
                    className="btn-activate"
                    type="button"
                    disabled={account.premium}
                    onClick={() => activate(account.id)}
                  >
                    {account.premium ? 'Premium (Actif)' : 'Activer Premium'}

                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
        <p className="error-text">{error}</p>
        <p className="status-text">{status}</p>
      </section>
    </div>
  );
}
