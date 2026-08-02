import { useEffect, useState } from 'react';
import { AdminApiError, type ApiFieldError } from '../adminApi.js';

export interface JsonConfigEditorProps {
  title: string;
  value: unknown;
  onSave: (
    parsed: unknown,
  ) => Promise<{ success: boolean; note?: string; errors?: ApiFieldError[] }>;
  disabled?: boolean;
}

export default function JsonConfigEditor({
  title,
  value,
  onSave,
  disabled = false,
}: JsonConfigEditorProps) {
  const [jsonText, setJsonText] = useState('');
  const [localSyntaxError, setLocalSyntaxError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<ApiFieldError[]>([]);
  const [serverError, setServerError] = useState('');
  const [statusMessage, setStatusMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setJsonText(value !== undefined ? JSON.stringify(value, null, 2) : '');
    setLocalSyntaxError('');
    setFieldErrors([]);
    setServerError('');
    setStatusMessage('');
  }, [value]);

  const handleSave = async (): Promise<void> => {
    setLocalSyntaxError('');
    setFieldErrors([]);
    setServerError('');
    setStatusMessage('');

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      setLocalSyntaxError(`Erreur de syntaxe JSON : ${(err as Error).message}`);
      return;
    }

    setSaving(true);
    try {
      const res = await onSave(parsed);
      if (res.errors && res.errors.length > 0) {
        setFieldErrors(res.errors);
      } else {
        setStatusMessage(res.note ?? 'Enregistré avec succès.');
      }
    } catch (err) {
      if (err instanceof AdminApiError && err.errors && err.errors.length > 0) {
        setFieldErrors(err.errors);
      } else {
        setServerError((err as Error).message);
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="panel" style={{ marginTop: 16 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <button
          className="btn-primary"
          type="button"
          onClick={() => void handleSave()}
          disabled={saving || disabled}
        >
          {saving ? 'Enregistrement…' : 'Enregistrer la configuration'}
        </button>
      </div>

      <textarea
        value={jsonText}
        onChange={(e) => setJsonText(e.target.value)}
        disabled={disabled}
        rows={16}
        style={{
          width: '100%',
          fontFamily: 'monospace',
          fontSize: 13,
          lineHeight: 1.4,
          padding: 12,
          borderRadius: 'var(--radius-md, 8px)',
          border: localSyntaxError || fieldErrors.length > 0 ? '1px solid #ef4444' : '1px solid var(--border-strong, #ccc)',
          background: 'var(--bg-secondary, #1e1e1e)',
          color: 'var(--text-primary, #f3f4f6)',
          resize: 'vertical',
          boxSizing: 'border-box',
        }}
      />

      {localSyntaxError && (
        <div
          className="error-text"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#ef4444',
          }}
        >
          {localSyntaxError}
        </div>
      )}

      {fieldErrors.length > 0 && (
        <div
          className="error-text"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#ef4444',
          }}
        >
          <strong>Erreurs de validation :</strong>
          <ul style={{ margin: '4px 0 0 18px', padding: 0 }}>
            {fieldErrors.map((err, idx) => (
              <li key={idx}>
                <code>{err.path}</code>: {err.message}
              </li>
            ))}
          </ul>
        </div>
      )}

      {serverError && (
        <div
          className="error-text"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(239, 68, 68, 0.15)',
            border: '1px solid rgba(239, 68, 68, 0.3)',
            borderRadius: 6,
            color: '#ef4444',
          }}
        >
          {serverError}
        </div>
      )}

      {statusMessage && (
        <div
          className="status-text"
          style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(34, 197, 94, 0.15)',
            border: '1px solid rgba(34, 197, 94, 0.3)',
            borderRadius: 6,
            color: '#22c55e',
          }}
        >
          {statusMessage}
        </div>
      )}
    </div>
  );
}
