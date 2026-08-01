/** Indicateur de connexion WebSocket temps réel (cahier_des_charges_admin.md §10.3) — partagé par
 * le Studio de contrôle et le POV ("Salons & Écrans") : jusqu'ici, une déconnexion n'était visible
 * que via un toast d'erreur transitoire (`onClose`), qui disparaît après quelques secondes même si
 * la connexion reste coupée — ce point reste affiché tant que l'état réel du WebSocket ne redevient
 * pas 'connected'. */
export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const LABELS: Record<ConnectionStatus, string> = {
  connecting: 'Connexion…',
  connected: 'Connecté',
  disconnected: 'Déconnecté',
};

const COLORS: Record<ConnectionStatus, string> = {
  connecting: '#f59e0b', // orange
  connected: '#22c55e', // vert
  disconnected: '#ef4444', // rouge
};

export default function ConnectionStatusDot({ status }: { status: ConnectionStatus }) {
  return (
    <span className="connection-status-dot" title={LABELS[status]} aria-label={LABELS[status]}>
      <span
        className={`connection-status-dot-mark${status === 'connecting' ? ' pulsing' : ''}`}
        style={{ backgroundColor: COLORS[status] }}
      />
      {LABELS[status]}
    </span>
  );
}
