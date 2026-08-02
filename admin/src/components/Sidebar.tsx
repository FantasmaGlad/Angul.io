import type { ViewName } from '../App.js';

interface SidebarProps {
  view: ViewName;
  onChangeView: (view: ViewName) => void;
  onLogout: () => void;
}

interface NavItem {
  view: ViewName;
  label: string;
  icon: string;
  soon?: boolean;
}

/** §4 cahier_des_charges_admin.md — 6 entrées (A11 : fusion "Salons & Écrans" + "Studio de
 * contrôle" en une seule entrée "Salons", plan-implementation-admin.md §5.1), séparées en deux
 * groupes : "opérationnel" (usage quotidien) et "gouvernance" (supervision/administration du
 * serveur lui-même). */
const OPERATIONAL_ITEMS: NavItem[] = [
  { view: 'dashboard', label: 'Tableau de bord', icon: 'dashboard' },
  { view: 'joueurs', label: 'Joueurs', icon: 'group' },
  { view: 'salons', label: 'Salons', icon: 'stadia_controller' },
];
const GOVERNANCE_ITEMS: NavItem[] = [
  { view: 'moderation', label: 'Modération', icon: 'gavel' },
  { view: 'economie', label: 'Économie & Boosts', icon: 'toll', soon: true },
  { view: 'configuration', label: 'Configuration', icon: 'tune' },
];

function NavButton({ item, active, onClick }: { item: NavItem; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      className={active ? 'side-link active' : item.soon ? 'side-link side-link-soon' : 'side-link'}
      onClick={onClick}
    >
      <span className="material-symbols-outlined" aria-hidden="true">
        {item.icon}
      </span>
      {item.label}
      {item.soon && <span className="side-link-soon-tag">Bientôt</span>}
    </button>
  );
}

/** Navigation latérale (§4 cahier_des_charges_admin.md) — 6 entrées. */
export default function Sidebar({ view, onChangeView, onLogout }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        Angul.io
        <span>Admin</span>
      </div>
      <nav className="sidebar-nav">
        {OPERATIONAL_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} active={item.view === view} onClick={() => onChangeView(item.view)} />
        ))}
        <div className="sidebar-separator" />
        <span className="sidebar-group-label">Gouvernance</span>
        {GOVERNANCE_ITEMS.map((item) => (
          <NavButton key={item.view} item={item} active={item.view === view} onClick={() => onChangeView(item.view)} />
        ))}
      </nav>
      <button className="btn-ghost" type="button" onClick={onLogout}>
        Déconnexion
      </button>
    </aside>
  );
}
