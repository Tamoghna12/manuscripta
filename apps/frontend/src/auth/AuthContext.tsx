import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import {
  authStatus,
  authLogin,
  authRegister,
  authMe,
  setAuthToken,
  getAuthToken,
  clearAuthToken,
  type AuthUser,
} from '../api/client';

interface AuthState {
  loading: boolean;
  authEnabled: boolean;
  oidcEnabled: boolean;
  user: AuthUser | null;
  login: (username: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  register: (username: string, password: string, displayName?: string) => Promise<{ ok: boolean; error?: string }>;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  loading: true,
  authEnabled: false,
  oidcEnabled: false,
  user: null,
  login: async () => ({ ok: false }),
  register: async () => ({ ok: false }),
  logout: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [authEnabled, setAuthEnabled] = useState(false);
  const [oidcEnabled, setOidcEnabled] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Check for OIDC token in URL (returned from IdP callback)
        const params = new URLSearchParams(window.location.search);
        const oidcToken = params.get('oidc_token');
        if (oidcToken) {
          setAuthToken(oidcToken);
          // Clean URL
          window.history.replaceState({}, '', window.location.pathname);
        }

        const status = await authStatus();
        if (cancelled) return;
        setAuthEnabled(status.authEnabled);
        setOidcEnabled(!!status.oidcEnabled);

        if (!status.authEnabled) {
          setLoading(false);
          return;
        }

        // If we have a stored token, validate it
        const token = getAuthToken();
        if (token) {
          try {
            const me = await authMe();
            if (!cancelled && me.ok && me.user) {
              setUser(me.user);
            } else {
              clearAuthToken();
            }
          } catch {
            clearAuthToken();
          }
        }
      } catch {
        // Server unreachable — treat as auth disabled
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await authLogin({ username, password });
      if (res.ok && res.token && res.user) {
        setAuthToken(res.token);
        setUser(res.user);
        return { ok: true };
      }
      return { ok: false, error: res.error || 'Login failed.' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Login failed.' };
    }
  }, []);

  const register = useCallback(async (username: string, password: string, displayName?: string) => {
    try {
      const res = await authRegister({ username, password, displayName });
      if (res.ok && res.token && res.user) {
        setAuthToken(res.token);
        setUser(res.user);
        return { ok: true };
      }
      return { ok: false, error: res.error || 'Registration failed.' };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Registration failed.' };
    }
  }, []);

  const logout = useCallback(() => {
    clearAuthToken();
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ loading, authEnabled, oidcEnabled, user, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
