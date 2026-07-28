import FpsModeSelector from '../components/FpsModeSelector.js';
import PageLayout from './PageLayout.js';

/** Paramètres client : réglages locaux à l'appareil, pas liés au compte joueur — pour l'instant
 * seulement le mode FPS du rendu en jeu (voir GameView.tsx/settings.ts), aussi proposé dans le
 * profil (ProfilePage.tsx, demande utilisateur) : les deux entrées partagent le même composant
 * et le même réglage persisté, pas de double source de vérité. */
export default function SettingsPage() {
  return (
    <PageLayout title="Paramètres">
      <FpsModeSelector />
    </PageLayout>
  );
}
