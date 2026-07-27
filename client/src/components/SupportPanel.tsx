import { DONATION_URL, SUPPORT_BODY } from '../support.js';
import Panel from './Panel.js';

interface SupportPanelProps {
  onClose: () => void;
}

/** Soutenir (Lot 6.2, §4.6 cahier_des_charges_ui_ux.md). */
export default function SupportPanel({ onClose }: SupportPanelProps) {
  return (
    <Panel title="Soutenir Angul.io" onClose={onClose}>
      <p className="account-status">{SUPPORT_BODY}</p>
      <a className="btn-primary" href={DONATION_URL} target="_blank" rel="noopener noreferrer">
        Faire un don
      </a>
    </Panel>
  );
}
