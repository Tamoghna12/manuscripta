import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { login, register, authEnabled, oidcEnabled } = useAuth();
  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  if (!authEnabled) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const result = mode === 'login'
        ? await login(username, password)
        : await register(username, password, displayName || undefined);
      if (!result.ok) {
        setError(result.error || 'An error occurred.');
      }
    } finally {
      setBusy(false);
    }
  };

  const handleSSOLogin = () => {
    window.location.href = '/api/auth/oidc/login';
  };

  return (
    <div className="login-page">
      <div className="login-card">
        <div className="login-brand">
          <h1>Manuscripta</h1>
          <p className="login-subtitle">{'Academic writing, reimagined.'}</p>
        </div>

        {oidcEnabled && (
          <>
            <button className="btn login-sso-btn" onClick={handleSSOLogin}>
              {'Sign in with SSO'}
            </button>
            <div className="login-divider">
              <span>{'or'}</span>
            </div>
          </>
        )}

        <div className="login-tabs">
          <button
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            {'Sign In'}
          </button>
          <button
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            {'Sign Up'}
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>{'Username'}</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={'your_username'}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          {mode === 'register' && (
            <div className="field">
              <label>{'Display Name'}</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={'How others will see you'}
              />
            </div>
          )}

          <div className="field">
            <label>{'Password'}</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? 'At least 6 characters' : 'Enter your password'}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn login-submit" type="submit" disabled={busy}>
            {busy ? 'Please wait...' : mode === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div className="login-footer">
          {mode === 'login'
            ? <span>{"Don't have an account?"} <button className="link-btn" onClick={() => setMode('register')}>{'Sign Up'}</button></span>
            : <span>{'Already have an account?'} <button className="link-btn" onClick={() => setMode('login')}>{'Sign In'}</button></span>
          }
        </div>
      </div>
    </div>
  );
}
