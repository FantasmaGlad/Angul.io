import PageLayout from './PageLayout.js';

/** Classements (placeholder — nécessite un endpoint d'agrégation côté serveur qui n'existe pas
 * encore). */
export default function LeaderboardPage() {
  return (
    <PageLayout title="Classements">
      <div className="placeholder">
        <span className="placeholder-tag">Bientôt disponible</span>
        <p>
          Les classements arrivent bientôt — en attendant, retrouve tes meilleurs scores par mode
          dans ton profil.
        </p>
      </div>
    </PageLayout>
  );
}
