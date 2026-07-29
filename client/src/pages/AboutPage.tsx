import PageLayout from './PageLayout.js';

export default function AboutPage() {
  return (
    <PageLayout title="À Propos">
      <p className="account-status">
        <strong>Angul.io</strong> — plateforme de jeu multijoueur temps réel inspirée d'Agar.io,
        avec un système de salons et de modes de jeu scriptables.
      </p>

      <div className="stat-row">
        <span className="stat-label">Licence</span>
        <span className="stat-value">AGPL-3.0-or-later</span>
      </div>
      <p className="account-status" style={{ marginTop: 14 }}>
        Code source ouvert : toute réutilisation doit rester open source et citer le projet
        d'origine.
      </p>
    </PageLayout>
  );
}
