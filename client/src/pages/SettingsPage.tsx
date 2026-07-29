import AudioSettings from '../components/AudioSettings.js';
import KeybindSettings from '../components/KeybindSettings.js';
import PageLayout from './PageLayout.js';

/** Paramètres client : réglages locaux à l'appareil, pas liés au compte joueur — sons/musique
 * (demande utilisateur, remplace l'ancienne section FPS retirée d'ici) et configuration des
 * touches/manette (demande utilisateur, voir KeybindSettings.tsx). */
export default function SettingsPage() {
  return (
    <PageLayout title="Paramètres">
      <AudioSettings />
      <div style={{ marginTop: 20 }}>
        <KeybindSettings />
      </div>
    </PageLayout>
  );
}
