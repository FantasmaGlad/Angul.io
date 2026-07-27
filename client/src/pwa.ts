/** Lot 7.2 — enregistrement du service worker (public/service-worker.js). Best-effort : un
 * navigateur qui ne supporte pas les service workers, ou un échec d'enregistrement, ne doit
 * jamais empêcher le jeu de fonctionner normalement (même principe que le reste du projet —
 * l'authentification, les comptes, etc. sont tous additifs, jamais bloquants). */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/service-worker.js').catch(() => {
      // Ignoré : voir commentaire ci-dessus.
    });
  });
}
