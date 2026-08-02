import AudioSettings from '../components/AudioSettings.js';
import KeybindSettings from '../components/KeybindSettings.js';
import PageLayout from './PageLayout.js';

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
