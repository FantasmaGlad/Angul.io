import type { PropsWithChildren } from 'react';

interface PanelProps {
  title: string;
  onClose: () => void;
}

/** Coquille commune à tous les sous-panneaux (Compte/Salons/Modes/Classements/Soutenir —
 * §3.1 cahier_des_charges_ui_ux.md) : titre + bouton fermer, contenu libre. */
export default function Panel({ title, onClose, children }: PropsWithChildren<PanelProps>) {
  return (
    <div className="panel">
      <div className="panel-card">
        <div className="panel-header">
          <h1>{title}</h1>
          <button className="panel-close" type="button" onClick={onClose}>
            Fermer
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
