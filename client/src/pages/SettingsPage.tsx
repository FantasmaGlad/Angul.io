import AudioSettings from '../components/AudioSettings.js';
import PageLayout from './PageLayout.js';

/** Paramètres client : réglages locaux à l'appareil, pas liés au compte joueur — sons/musique
 * (demande utilisateur, remplace l'ancienne section FPS retirée d'ici). */
export default function SettingsPage() {
  return (
    <PageLayout title="Paramètres">
      <AudioSettings />
    </PageLayout>
  );
}
