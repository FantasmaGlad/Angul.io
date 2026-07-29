import { navigate } from '../router.js';

/** Pied de page de l'accueil (refonte UI/UX, mockup fourni). "Version 1.1" est un texte d'affichage
 * volontairement indépendant de `package.json` (resté à `0.0.0` en interne, pas encore pensé
 * comme un numéro affiché aux joueurs). */
export default function BottomBar() {
  return (
    <footer className="bottom-bar">
      <span>Version 2.0</span>
      <span>Angul.io 2026</span>
      <button
        type="button"
        className="btn-ghost bottom-bar-support"
        onClick={() => navigate('/soutenir')}
      >
        Soutenir le Projet
      </button>
    </footer>
  );
}
