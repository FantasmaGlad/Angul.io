import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

export class ErrorBoundary extends Component<Props, State> {
  public override state: State = {
    hasError: false,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public override componentDidCatch(error: Error, errorInfo: ErrorInfo): void {
    console.error('Uncaught error in UI component:', error, errorInfo);
  }

  public override render(): ReactNode {
    if (this.state.hasError) {
      return (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(15, 23, 42, 0.95)',
            color: '#f8fafc',
            zIndex: 999999,
            fontFamily: 'sans-serif',
            padding: '20px',
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: '24px', marginBottom: '12px', color: '#ef4444' }}>
            Une erreur inattendue est survenue
          </h2>
          <p style={{ fontSize: '14px', color: '#94a3b8', maxWidth: '500px', marginBottom: '24px' }}>
            L'affichage a rencontré un problème. Vous pouvez recharger la partie ou revenir au menu principal.
          </p>
          {this.state.error && (
            <pre
              style={{
                fontSize: '12px',
                background: '#0f172a',
                padding: '12px',
                borderRadius: '8px',
                maxWidth: '600px',
                maxHeight: '150px',
                overflow: 'auto',
                marginBottom: '24px',
                color: '#fca5a5',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              padding: '10px 20px',
              fontSize: '15px',
              fontWeight: 600,
              color: '#ffffff',
              background: '#3b82f6',
              border: 'none',
              borderRadius: '8px',
              cursor: 'pointer',
            }}
          >
            Recharger la page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
