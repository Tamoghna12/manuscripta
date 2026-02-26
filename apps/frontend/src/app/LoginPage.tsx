import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAuth } from '../auth/AuthContext';

export default function LoginPage() {
  const { t } = useTranslation();
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
          <p className="login-subtitle">{t('auth.subtitle')}</p>
        </div>

        {oidcEnabled && (
          <>
            <button className="btn login-sso-btn" onClick={handleSSOLogin}>
              {t('auth.ssoLogin')}
            </button>
            <div className="login-divider">
              <span>{t('auth.or')}</span>
            </div>
          </>
        )}

        <div className="login-tabs">
          <button
            className={`login-tab ${mode === 'login' ? 'active' : ''}`}
            onClick={() => { setMode('login'); setError(''); }}
          >
            {t('auth.login')}
          </button>
          <button
            className={`login-tab ${mode === 'register' ? 'active' : ''}`}
            onClick={() => { setMode('register'); setError(''); }}
          >
            {t('auth.register')}
          </button>
        </div>

        <form className="login-form" onSubmit={handleSubmit}>
          <div className="field">
            <label>{t('auth.username')}</label>
            <input
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={t('auth.usernamePlaceholder')}
              autoComplete="username"
              autoFocus
              required
            />
          </div>

          {mode === 'register' && (
            <div className="field">
              <label>{t('auth.displayName')}</label>
              <input
                className="input"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder={t('auth.displayNamePlaceholder')}
              />
            </div>
          )}

          <div className="field">
            <label>{t('auth.password')}</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={mode === 'register' ? t('auth.passwordPlaceholderNew') : t('auth.passwordPlaceholder')}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={6}
            />
          </div>

          {error && <div className="login-error">{error}</div>}

          <button className="btn login-submit" type="submit" disabled={busy}>
            {busy ? t('auth.submitting') : mode === 'login' ? t('auth.loginBtn') : t('auth.registerBtn')}
          </button>
        </form>

        <div className="login-footer">
          {mode === 'login'
            ? <span>{t('auth.noAccount')} <button className="link-btn" onClick={() => setMode('register')}>{t('auth.register')}</button></span>
            : <span>{t('auth.hasAccount')} <button className="link-btn" onClick={() => setMode('login')}>{t('auth.login')}</button></span>
          }
        </div>
      </div>
    </div>
  );
}
