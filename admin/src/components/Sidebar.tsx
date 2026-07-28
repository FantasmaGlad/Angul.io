import type { ViewName } from '../App.js';

interface SidebarProps {
  view: ViewName;
  onChangeView: (view: ViewName) => void;
  onLogout: () => void;
}

const NAV_ITEMS: Array<{ view: ViewName; label: string; icon: string }> = [
  { view: 'joueurs', label: 'Joueurs', icon: 'group' },
  { view: 'salons', label: 'Salons & Écrans', icon: 'stadia_controller' },
  { view: 'creatif', label: 'Espace Créatif', icon: 'palette' },
];

/** Navigation latérale (§6 cahier_des_charges_admin.md) — 3 onglets. */
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
            <span className="material-symbols-outlined" aria-hidden="true">
              {item.icon}
            </span>
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
