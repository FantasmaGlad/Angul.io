import AudioSettings from '../components/AudioSettings.js';
import DisplaySettings from '../components/DisplaySettings.js';
import KeybindSettings from '../components/KeybindSettings.js';
import PageLayout from './PageLayout.js';

export default function SettingsPage() {
  return (
    <PageLayout title="Paramètres">
      <DisplaySettings />
      <div style={{ marginTop: 20 }}>
        <AudioSettings />
      </div>
      <div style={{ marginTop: 20 }}>
        <KeybindSettings />
      </div>
    </PageLayout>
  );
}
