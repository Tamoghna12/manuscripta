/**
 * Minimal OpenID Connect (OIDC) client.
 *
 * Implements the Authorization Code flow without external dependencies.
 * Supports any OIDC-compliant identity provider (Okta, Azure AD, Keycloak,
 * Google Workspace, Auth0, etc.) via standard discovery.
 *
 * Configuration (env vars):
 *   MANUSCRIPTA_OIDC_ISSUER          – e.g. https://accounts.google.com
 *   MANUSCRIPTA_OIDC_CLIENT_ID       – OAuth client ID
 *   MANUSCRIPTA_OIDC_CLIENT_SECRET   – OAuth client secret
 *   MANUSCRIPTA_OIDC_REDIRECT_URI    – e.g. http://localhost:8787/api/auth/oidc/callback
 *   MANUSCRIPTA_OIDC_SCOPES          – (optional) space-separated scopes, default "openid email profile"
 */
import crypto from 'crypto';

const OIDC_ISSUER = process.env.MANUSCRIPTA_OIDC_ISSUER || '';
const OIDC_CLIENT_ID = process.env.MANUSCRIPTA_OIDC_CLIENT_ID || '';
const OIDC_CLIENT_SECRET = process.env.MANUSCRIPTA_OIDC_CLIENT_SECRET || '';
const OIDC_REDIRECT_URI = process.env.MANUSCRIPTA_OIDC_REDIRECT_URI || '';
const OIDC_SCOPES = process.env.MANUSCRIPTA_OIDC_SCOPES || 'openid email profile';

// In-memory cache for OIDC discovery document
let discoveryCache = null;
let discoveryCacheTime = 0;
const DISCOVERY_TTL_MS = 3600_000; // 1 hour

// Pending state tokens (short-lived, in-memory)
const pendingStates = new Map(); // state -> { createdAt, nonce }
const STATE_TTL_MS = 600_000; // 10 minutes

export function isOIDCEnabled() {
  return !!(OIDC_ISSUER && OIDC_CLIENT_ID && OIDC_CLIENT_SECRET && OIDC_REDIRECT_URI);
}

export function getOIDCConfig() {
  return {
    enabled: isOIDCEnabled(),
    issuer: OIDC_ISSUER,
    clientId: OIDC_CLIENT_ID,
    redirectUri: OIDC_REDIRECT_URI,
  };
}

async function discover() {
  if (discoveryCache && Date.now() - discoveryCacheTime < DISCOVERY_TTL_MS) {
    return discoveryCache;
  }
  const url = OIDC_ISSUER.replace(/\/+$/, '') + '/.well-known/openid-configuration';
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  }
  discoveryCache = await res.json();
  discoveryCacheTime = Date.now();
  return discoveryCache;
}

/**
 * Generate the authorization URL for the OIDC login redirect.
 */
export async function getAuthorizationUrl() {
  const config = await discover();
  const state = crypto.randomBytes(24).toString('hex');
  const nonce = crypto.randomBytes(16).toString('hex');

  // Clean up expired states
  const now = Date.now();
  for (const [s, v] of pendingStates) {
    if (now - v.createdAt > STATE_TTL_MS) pendingStates.delete(s);
  }
  pendingStates.set(state, { createdAt: now, nonce });

  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OIDC_CLIENT_ID,
    redirect_uri: OIDC_REDIRECT_URI,
    scope: OIDC_SCOPES,
    state,
    nonce,
  });

  return {
    url: `${config.authorization_endpoint}?${params.toString()}`,
    state,
  };
}

/**
 * Exchange the authorization code for tokens and extract user info.
 * Returns { sub, email, name, picture } or throws.
 */
export async function handleCallback(code, state) {
  // Validate state
  const pending = pendingStates.get(state);
  if (!pending) {
    throw new Error('Invalid or expired state parameter.');
  }
  pendingStates.delete(state);

  const config = await discover();

  // Exchange code for tokens
  const tokenRes = await fetch(config.token_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: OIDC_REDIRECT_URI,
      client_id: OIDC_CLIENT_ID,
      client_secret: OIDC_CLIENT_SECRET,
    }),
  });

  if (!tokenRes.ok) {
    const body = await tokenRes.text();
    throw new Error(`Token exchange failed: ${tokenRes.status} — ${body}`);
  }

  const tokens = await tokenRes.json();

  // Decode the ID token (we trust it since we just received it over TLS from the IdP)
  let idPayload = null;
  if (tokens.id_token) {
    try {
      const parts = tokens.id_token.split('.');
      idPayload = JSON.parse(Buffer.from(parts[1], 'base64').toString('utf8'));
    } catch { /* fall through to userinfo */ }
  }

  // If ID token doesn't have enough info, call the userinfo endpoint
  let userInfo = idPayload || {};
  if ((!userInfo.email || !userInfo.sub) && config.userinfo_endpoint && tokens.access_token) {
    const uiRes = await fetch(config.userinfo_endpoint, {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    if (uiRes.ok) {
      const extra = await uiRes.json();
      userInfo = { ...userInfo, ...extra };
    }
  }

  return {
    sub: userInfo.sub || '',
    email: userInfo.email || '',
    name: userInfo.name || userInfo.preferred_username || userInfo.email || '',
    picture: userInfo.picture || '',
  };
}
