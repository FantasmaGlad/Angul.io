import type { ViewName } from '../App.js';

interface SidebarProps {
  view: ViewName;
  onChangeView: (view: ViewName) => void;
  onLogout: () => void;
}

const NAV_ITEMS: Array<{ view: ViewName; label: string }> = [
  { view: 'dashboard', label: 'Dashboard' },
  { view: 'accounts', label: 'Comptes' },
  { view: 'moderation', label: 'Modération' },
  { view: 'premium', label: 'Premium & dons' },
  { view: 'leaderboard', label: 'Classements' },
];

/** Navigation latérale par domaine (§3.2/§5 cahier_des_charges_ui_ux.md). */
export default function Sidebar({ view, onChangeView, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        Angul.io
        <span>Admin</span>
      </div>
      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.view}
            type="button"
            className={item.view === view ? 'side-link active' : 'side-link'}
            onClick={() => onChangeView(item.view)}
          >
            {item.label}
          </button>
        ))}
      </nav>
      <button className="btn-ghost" type="button" onClick={onLogout}>
        Déconnexion
      </button>
    </aside>
  );
}
