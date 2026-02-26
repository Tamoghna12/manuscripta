import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('ErrorBoundary caught:', error, info.componentStack);
  }

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }
      return (
        <div
          style={{
            padding: '2rem',
            maxWidth: '600px',
            margin: '4rem auto',
            fontFamily: 'system-ui, sans-serif',
          }}
        >
          <h2 style={{ color: '#b44a2f', marginBottom: '1rem' }}>Something went wrong</h2>
          <p style={{ color: '#555', lineHeight: 1.6 }}>
            An unexpected error occurred. Please try refreshing the page.
          </p>
          {this.state.error && (
            <pre
              style={{
                background: '#f5f2ef',
                padding: '1rem',
                borderRadius: '6px',
                fontSize: '12px',
                overflow: 'auto',
                marginTop: '1rem',
                color: '#333',
              }}
            >
              {this.state.error.message}
            </pre>
          )}
          <button
            onClick={() => window.location.reload()}
            style={{
              marginTop: '1rem',
              padding: '0.5rem 1.5rem',
              background: '#b44a2f',
              color: '#fff',
              border: 'none',
              borderRadius: '6px',
              cursor: 'pointer',
              fontSize: '14px',
            }}
          >
            Reload Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
