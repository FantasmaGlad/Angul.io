import type { PropsWithChildren } from 'react';

interface PlaceholderViewProps {
  title: string;
  subtitle: string;
}

/** Emplacement "à venir" (Dashboard/Modération/Classements — §10 cahier_des_charges_ui_ux.md) :
 * le contenu backend correspondant n'existe pas encore, expliqué en clair plutôt que caché. */
export default function PlaceholderView({
  title,
  subtitle,
  children,
}: PropsWithChildren<PlaceholderViewProps>) {
  return (
    <div className="view">
      <div className="top-bar">
        <div>
          <h2>{title}</h2>
          <p className="view-subtitle">{subtitle}</p>
        </div>
      </div>
      <div className="panel placeholder">
        <span className="placeholder-tag">Bientôt disponible</span>
        <p>{children}</p>
      </div>
    </div>
  );
}
