import type { PropsWithChildren } from 'react';
import { navigate } from '../router.js';

interface PageLayoutProps {
  title: string;
  wide?: boolean;
}

export default function PageLayout({ title, wide = false, children }: PropsWithChildren<PageLayoutProps>) {
  return (
    <div className="subpage">
      <header className={`subpage-header${wide ? ' wide' : ''}`}>
        <button
          type="button"
          className="subpage-back"
          onClick={() => navigate('/')}
          aria-label="Retour à l'accueil"
          title="Retour à l'accueil"
        >
          <span className="material-symbols-outlined">arrow_back</span>
        </button>
        <h1 className="subpage-title">{title}</h1>
      </header>
      <div className={`subpage-body${wide ? ' wide' : ''}`}>{children}</div>
    </div>
  );
}
