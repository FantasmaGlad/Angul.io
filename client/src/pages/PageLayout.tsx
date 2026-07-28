import type { PropsWithChildren } from 'react';
import { navigate } from '../router.js';

interface PageLayoutProps {
  title: string;
}

/** Coquille commune à toutes les sous-pages (Compte/Profil/Paramètres/Classement/Soutenir/À
 * Propos — refonte UI/UX) : chacune a sa propre URL et un bouton retour, à la place des
 * anciennes modales superposées (`Panel.tsx`, `ProfileModal.tsx`) qui s'empilaient les unes sur
 * les autres sans clic-extérieur ni URL propre. */
export default function PageLayout({ title, children }: PropsWithChildren<PageLayoutProps>) {
  return (
    <div className="subpage">
      <header className="subpage-header">
        <button type="button" className="subpage-back" onClick={() => navigate('/')}>
          ← Retour à l'accueil
        </button>
        <h1 className="subpage-title">{title}</h1>
      </header>
      <div className="subpage-body">{children}</div>
    </div>
  );
}
