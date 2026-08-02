import { useState } from 'react';

export interface KickModalTarget {
  playerId: string;
  nickname: string;
}

interface KickModalProps {
  target: KickModalTarget | null;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}

/** Modale de motif de kick partagée entre Salons et le Studio (A1, plan-implementation-admin.md
 * §3.2) — auparavant chaque vue avait sa propre logique (l'une avec une modale dont le motif
 * n'était jamais transmis, l'autre sans modale du tout) : un seul composant, motif obligatoire,
 * réellement envoyé au serveur. */
export default function KickModal({ target, onConfirm, onCancel }: KickModalProps) {
  const [reason, setReason] = useState('');

  if (!target) return null;

  const handleCancel = (): void => {
    setReason('');
    onCancel();
  };

  const handleConfirm = (): void => {
    const trimmed = reason.trim();
    if (!trimmed) return;
    onConfirm(trimmed);
    setReason('');
  };

  return (
    <div className="context-menu-backdrop" style={{ zIndex: 150 }} onClick={handleCancel}>
      <div
        className="panel"
        style={{
          position: 'fixed',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          zIndex: 151,
          width: 380,
          maxWidth: '90vw',
          padding: 24,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 16, marginBottom: 8 }}>Expulser {target.nickname} ?</h3>
        <p className="view-subtitle" style={{ marginBottom: 12 }}>
          Motif obligatoire — transmis au serveur et journalisé.
        </p>
        <input
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motif de l'expulsion…"
          maxLength={100}
          style={{ width: '100%' }}
          autoFocus
        />
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
          <button className="btn-ghost" type="button" onClick={handleCancel}>
            Annuler
          </button>
          <button
            className="btn-primary btn-danger"
            type="button"
            disabled={!reason.trim()}
            onClick={handleConfirm}
          >
            Expulser
          </button>
        </div>
      </div>
    </div>
  );
}
