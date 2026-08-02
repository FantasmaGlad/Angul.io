import { navigate } from '../router.js';

/** Pied de page de l'accueil (refonte UI/UX, mockup fourni). Le numéro de version affiché est un
 * texte volontairement indépendant de `package.json` (resté à `0.0.0` en interne, pas encore
 * pensé comme un numéro affiché aux joueurs) — à incrémenter manuellement ici à chaque version
 * livrée. */
export default function BottomBar() {
  return (
    <footer className="bottom-bar">
      <span className="game-footer-item font-semibold text-white/75 glow-sm">Version 10.1</span>
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
