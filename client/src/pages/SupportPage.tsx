import { DONATION_URL, SUPPORT_BODY } from '../support.js';
import PageLayout from './PageLayout.js';

export default function SupportPage() {
  return (
    <PageLayout title="Soutenir Angul.io">
      <p className="account-status">{SUPPORT_BODY}</p>
      <a className="btn-primary" href={DONATION_URL} target="_blank" rel="noopener noreferrer">
        Faire un don
      </a>
    </PageLayout>
  );
}
