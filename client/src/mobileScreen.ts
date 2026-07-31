// La Screen Orientation API de verrouillage (`lock`/`unlock`) n'est pas encore dans lib.dom.d.ts
// de TypeScript (extension de facto Chrome/Android, jamais standardisée nulle part ailleurs —
// absente sur Safari, voir plus bas) : complétée ici par déclaration globale plutôt que de passer
// par un cast `any` (interdit par ce dépôt, voir eslint.config.js).
declare global {
  interface ScreenOrientation {
    lock(
      orientation:
        | 'landscape'
        | 'portrait'
        | 'landscape-primary'
        | 'landscape-secondary'
        | 'portrait-primary'
        | 'portrait-secondary'
        | 'natural'
        | 'any',
    ): Promise<void>;
    unlock(): void;
  }
}

/** Détecte un appareil à pointeur "grossier" (tactile) — même convention que VirtualControls.tsx
 * (joystick) : ne s'applique jamais sur desktop souris/clavier, même avec un écran tactile
 * secondaire branché. */
function isTouchDevice(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

function lockLandscape(): void {
  const orientation = screen.orientation;
  if (!orientation?.lock) return;
  // `lock()` rejette (jamais ne "throw" en synchrone) si non supporté (Safari iOS ne l'implémente
  // pas du tout) ou si le document n'est pas en plein écran sur certains navigateurs — ignoré
  // silencieusement : c'est un agrément, pas une fonctionnalité bloquante (voir styles.css pour le
  // message de repli "Tournez votre appareil" affiché en portrait quel que soit le résultat ici).
  orientation.lock('landscape').catch(() => {});
}

/** Plein écran SEUL, sans verrouillage d'orientation — à utiliser pour tout tap sur le LOBBY
 * (demande utilisateur : pouvoir passer en plein écran juste en tapant l'écran/le logo, sans
 * lancer de partie, voir Home.tsx). Ne verrouille JAMAIS le paysage ici : la mise en page de
 * l'accueil (nav + 3 colonnes + pied de page) est pensée pour un défilement portrait normal, pas
 * pour un viewport paysage étroit en hauteur — verrouiller le paysage dès le lobby y faisait
 * déborder des éléments (ex. le bouton "Jouer", retour utilisateur) faute de scroll de secours
 * (`body { overflow: hidden }`). Le verrouillage paysage reste réservé à l'ENTRÉE EN PARTIE
 * (`enterMobileFullscreenLandscape` ci-dessous), où le HUD est réellement conçu pour ça (voir
 * `.rotate-device-hint`). DOIT être appelé de façon SYNCHRONE dans le gestionnaire de clic (jamais
 * après un `await`/`setTimeout`) : la plupart des navigateurs exigent un geste utilisateur direct
 * pour `requestFullscreen()`, un appel différé serait silencieusement rejeté. */
export function enterMobileFullscreen(): void {
  if (!isTouchDevice()) return;
  if (document.fullscreenElement) return;
  document.documentElement.requestFullscreen?.().catch(() => {});
}

/** Plein écran + verrouillage paysage au lancement d'une partie sur téléphone (demande
 * utilisateur) — DOIT être appelé de façon SYNCHRONE dans le gestionnaire de clic qui démarre la
 * partie (jamais après un `await`/`setTimeout`) : la plupart des navigateurs exigent un geste
 * utilisateur direct pour `requestFullscreen()`, un appel différé serait silencieusement rejeté.
 * Meilleur effort uniquement : Safari iOS ne supporte ni le plein écran d'un élément arbitraire
 * (en dehors d'une balise `<video>`), ni le verrouillage d'orientation — ignoré silencieusement
 * là-bas, voir styles.css `.rotate-device-hint` pour le repli visuel sur cette plateforme.
 *
 * Réservée à l'ENTRÉE EN PARTIE (App.tsx) — PAS au lobby (voir `enterMobileFullscreen` ci-dessus,
 * qui ne verrouille jamais l'orientation) : la mise en page du lobby n'est pas conçue pour un
 * viewport paysage étroit en hauteur, contrairement au HUD de jeu. */
export function enterMobileFullscreenLandscape(): void {
  if (!isTouchDevice()) return;

  // Déjà en plein écran — évite une requête `requestFullscreen()` redondante ; ne retente que le
  // verrouillage d'orientation seul, lui idempotent et sans effet de bord perceptible.
  if (document.fullscreenElement) {
    lockLandscape();
    return;
  }

  const root = document.documentElement;
  if (root.requestFullscreen) {
    root
      .requestFullscreen()
      .then(lockLandscape)
      // Plein écran refusé/non supporté : tente quand même le verrouillage d'orientation seul —
      // fonctionne hors plein écran sur certains Android/PWA installée.
      .catch(lockLandscape);
  } else {
    lockLandscape();
  }
}

/** Symétrique de `enterMobileFullscreenLandscape` — à appeler en quittant la partie (retour à
 * l'accueil). Sans effet si rien n'était verrouillé/en plein écran. */
export function exitMobileFullscreenLandscape(): void {
  screen.orientation?.unlock?.();
  if (document.fullscreenElement) {
    void document.exitFullscreen().catch(() => {});
  }
}
