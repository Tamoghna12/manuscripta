/**
 * Authentication routes.
 *
 * POST /api/auth/register        – Create a new account (first user becomes admin)
 * POST /api/auth/login           – Login with username + password
 * GET  /api/auth/me              – Get current session user
 * POST /api/auth/change-password – Change password (requires current password)
 * GET  /api/auth/status          – Check if auth is enabled and if any users exist
 * GET  /api/auth/oidc/login      – Redirect to OIDC identity provider
 * GET  /api/auth/oidc/callback   – Handle OIDC callback, create/update user, issue token
 */
import {
  isAuthEnabled,
  registerUser,
  loginUser,
  getUser,
  hasAnyUsers,
  changePassword,
  verifySessionToken,
  issueSessionToken,
  findOrCreateOIDCUser,
} from '../services/userService.js';
import {
  isOIDCEnabled,
  getOIDCConfig,
  getAuthorizationUrl,
  handleCallback,
} from '../services/oidcService.js';
import { audit } from '../services/auditService.js';

export function registerAuthRoutes(fastify) {
  // Auth status (public – used by frontend to decide whether to show login)
  fastify.get('/api/auth/status', async () => {
    const enabled = isAuthEnabled();
    const usersExist = enabled ? await hasAnyUsers() : false;
    const oidc = getOIDCConfig();
    return { ok: true, authEnabled: enabled, usersExist, oidcEnabled: oidc.enabled };
  });

  // Register
  fastify.post('/api/auth/register', async (req, reply) => {
    if (!isAuthEnabled()) {
      return reply.code(403).send({ ok: false, error: 'Authentication is not enabled.' });
    }
    const { username, password, displayName } = req.body || {};
    const result = await registerUser({ username, password, displayName });
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    audit('auth.register', { userId: result.user?.id, ip: req.ip, details: { username } });
    return result;
  });

  // Login
  fastify.post('/api/auth/login', async (req, reply) => {
    if (!isAuthEnabled()) {
      return reply.code(403).send({ ok: false, error: 'Authentication is not enabled.' });
    }
    const { username, password } = req.body || {};
    const result = await loginUser({ username, password });
    if (!result.ok) {
      audit('auth.login_failed', { ip: req.ip, details: { username } });
      return reply.code(401).send(result);
    }
    audit('auth.login', { userId: result.user?.id, ip: req.ip, details: { username } });
    return result;
  });

  // Current user
  fastify.get('/api/auth/me', async (req, reply) => {
    if (!isAuthEnabled()) {
      return { ok: true, user: null, authEnabled: false };
    }
    const token = extractSessionToken(req);
    if (!token) {
      return reply.code(401).send({ ok: false, error: 'Not authenticated.' });
    }
    const session = verifySessionToken(token);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Session expired or invalid.' });
    }
    const user = await getUser(session.userId);
    if (!user) {
      return reply.code(401).send({ ok: false, error: 'User not found.' });
    }
    return { ok: true, user };
  });

  // Change password
  fastify.post('/api/auth/change-password', async (req, reply) => {
    if (!isAuthEnabled()) {
      return reply.code(403).send({ ok: false, error: 'Authentication is not enabled.' });
    }
    const token = extractSessionToken(req);
    if (!token) {
      return reply.code(401).send({ ok: false, error: 'Not authenticated.' });
    }
    const session = verifySessionToken(token);
    if (!session) {
      return reply.code(401).send({ ok: false, error: 'Session expired or invalid.' });
    }
    const { currentPassword, newPassword } = req.body || {};
    const result = await changePassword({
      userId: session.userId,
      currentPassword,
      newPassword,
    });
    if (!result.ok) {
      return reply.code(400).send(result);
    }
    audit('auth.password_change', { userId: session.userId, ip: req.ip });
    return result;
  });

  // ── OIDC SSO ──

  // Redirect to OIDC provider
  fastify.get('/api/auth/oidc/login', async (req, reply) => {
    if (!isOIDCEnabled()) {
      return reply.code(404).send({ ok: false, error: 'OIDC is not configured.' });
    }
    const { url } = await getAuthorizationUrl();
    return reply.redirect(302, url);
  });

  // OIDC callback — exchange code, create/update user, redirect with token
  fastify.get('/api/auth/oidc/callback', async (req, reply) => {
    if (!isOIDCEnabled()) {
      return reply.code(404).send({ ok: false, error: 'OIDC is not configured.' });
    }

    const { code, state, error: oidcError } = req.query || {};
    if (oidcError) {
      return reply.code(400).send({ ok: false, error: `OIDC error: ${oidcError}` });
    }
    if (!code || !state) {
      return reply.code(400).send({ ok: false, error: 'Missing code or state parameter.' });
    }

    try {
      const oidcUser = await handleCallback(code, state);
      const user = await findOrCreateOIDCUser(oidcUser);
      const token = issueSessionToken({
        userId: user.id,
        username: user.username,
        role: user.role,
      });

      audit('auth.oidc_login', { userId: user.id, ip: req.ip, details: { email: oidcUser.email } });
      // Redirect to frontend with token in query (avoids server logs / referrer leaks)
      return reply.redirect(302, `/?oidc_token=${encodeURIComponent(token)}`);
    } catch (err) {
      fastify.log.error(err, 'OIDC callback error');
      return reply.code(500).send({ ok: false, error: err.message });
    }
  });
}

function extractSessionToken(req) {
  const header = req.headers?.authorization || '';
  if (header.startsWith('Bearer ms1.')) {
    return header.slice('Bearer '.length).trim();
  }
  // Also check cookie
  const cookies = req.headers?.cookie || '';
  const match = cookies.match(/(?:^|;\s*)ms_session=([^\s;]+)/);
  if (match) return match[1];
  return null;
}
