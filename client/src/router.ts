import { useEffect, useState } from 'react';

/** Routeur maison minimal (refonte UI/UX : sous-pages plutôt que modales superposées) — pas de
 * dépendance ajoutée, cohérent avec le fait que le projet n'utilisait déjà que
 * `window.location.pathname` à la main pour ses sous-pages (voir App.tsx). `pushState` ne déclenche pas
 * nativement `popstate` : `navigate` le redéclenche lui-même pour que `usePath` se resynchronise
 * dans le même onglet (pas seulement au bouton précédent/suivant du navigateur). */
export function navigate(path: string): void {
  if (window.location.pathname === path) return;
  window.history.pushState(null, '', path);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

export function usePath(): string {
  const [path, setPath] = useState(() => window.location.pathname);

  useEffect(() => {
    const onPopState = (): void => setPath(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  return path;
}
