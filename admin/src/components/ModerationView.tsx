import { useEffect, useState } from 'react';
import { searchAccounts, type AdminAccountView } from '../adminApi.js';

interface ModerationViewProps {
  token: string;
  onAuthError: (error: unknown) => void;
}

/** Module Modération (§11 cahier_des_charges_admin.md) — v1 : liste des comptes actuellement
 * bannis (réutilise la recherche Joueurs déjà existante, filtre `banned`). Le détail complet
 * prévu par §11.1 (motif, date d'expiration, admin auteur) et le journal d'audit append-only
 * (§11.2) demandent un nouveau stockage côté serveur — colonnes absentes du schéma actuel
 * (`server/db/schema.sql`), non ajoutées ici : Phase 3 de la feuille de route (§16), la plus
 * lourde après le canva, à traiter dans un chantier dédié plutôt qu'en incidental de la refonte
 * UI. Cette vue reste utile en l'état (qui est banni, maintenant) en attendant. */
export default function ModerationView({ token, onAuthError }: ModerationViewProps) {
  const [rows, setRows] = useState<AdminAccountView[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const response = await searchAccounts(token, {
          banned: true,
          sortBy: 'lastLoginAt',
          sortDir: 'desc',
          limit: 100,
        });
        setRows(response.rows);
      } catch (err) {
        const message = (err as Error).message;
        setError(message);
        onAuthError(err);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>Modération</h2>
          <p className="view-subtitle">Actions &amp; sanctions actives — comptes actuellement bannis.</p>
        </div>
      </div>

      <section className="panel">
        <p className="view-subtitle" style={{ marginTop: 0, marginBottom: 12 }}>
          Motif, durée et admin auteur arrivent avec le journal d'audit (§11.2, en attente d'un
          nouveau stockage serveur) — cette liste reste la source de vérité "qui est banni" en
          attendant.
        </p>
        <table className="data-table">
          <thead>
            <tr>
              <th>Pseudo</th>
              <th>Dernière connexion</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={2}>Chargement…</td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={2}>Aucun compte banni.</td>
              </tr>
            ) : (
              rows.map((account) => (
                <tr key={account.id}>
                  <td>
                    {account.pseudo} <span className="id-tag">#{account.id}</span>
                  </td>
                  <td>
                    {account.lastLoginAt ? new Date(account.lastLoginAt).toLocaleString() : 'Jamais'}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
        <p className="error-text">{error}</p>
      </section>
    </div>
  );
}
