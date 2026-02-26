/**
 * User authentication service.
 *
 * Stores users in a JSON file (DATA_DIR/users.json).
 * Passwords are hashed with scrypt (Node built-in crypto).
 * Session tokens are HMAC-SHA256 signed JWTs.
 *
 * If MANUSCRIPTA_AUTH_ENABLED=false (default for local dev),
 * authentication is bypassed entirely.
 */
import crypto from 'crypto';
import { promises as fs } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';

const USERS_FILE = path.join(DATA_DIR, 'users.json');
const SESSION_SECRET = process.env.MANUSCRIPTA_AUTH_SECRET || process.env.MANUSCRIPTA_COLLAB_TOKEN_SECRET || 'manuscripta-auth-dev';
const SESSION_TTL = Number(process.env.MANUSCRIPTA_AUTH_SESSION_TTL || 7 * 24 * 60 * 60); // 7 days
const AUTH_ENABLED = !['0', 'false', 'no'].includes(
  String(process.env.MANUSCRIPTA_AUTH_ENABLED || 'false').toLowerCase()
);

// ── Password hashing ──

function hashPassword(password) {
  return new Promise((resolve, reject) => {
    const salt = crypto.randomBytes(16);
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(`${salt.toString('hex')}:${key.toString('hex')}`);
    });
  });
}

function verifyPassword(password, hash) {
  return new Promise((resolve, reject) => {
    const [saltHex, keyHex] = hash.split(':');
    const salt = Buffer.from(saltHex, 'hex');
    crypto.scrypt(password, salt, 64, (err, key) => {
      if (err) reject(err);
      else resolve(crypto.timingSafeEqual(key, Buffer.from(keyHex, 'hex')));
    });
  });
}

// ── User store ──

async function readUsers() {
  try {
    const data = await fs.readFile(USERS_FILE, 'utf8');
    return JSON.parse(data);
  } catch {
    return { users: [] };
  }
}

async function writeUsers(store) {
  await fs.writeFile(USERS_FILE, JSON.stringify(store, null, 2), 'utf8');
}

// ── Session tokens ──

function base64UrlEncode(input) {
  const buf = Buffer.isBuffer(input) ? input : Buffer.from(input);
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlDecode(input) {
  const padded = input.replace(/-/g, '+').replace(/_/g, '/');
  const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
  return Buffer.from(padded + pad, 'base64');
}

function sign(data) {
  return crypto.createHmac('sha256', SESSION_SECRET).update(data).digest();
}

export function issueSessionToken({ userId, username, role = 'user' }) {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL;
  const payload = { sub: userId, usr: username, role, exp };
  const body = base64UrlEncode(JSON.stringify(payload));
  const sig = base64UrlEncode(sign(body));
  return `ms1.${body}.${sig}`;
}

export function verifySessionToken(token) {
  if (!token || typeof token !== 'string') return null;
  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'ms1') return null;
  const [, body, sig] = parts;
  const expected = base64UrlEncode(sign(body));
  const expectedBuf = Buffer.from(expected);
  const sigBuf = Buffer.from(sig);
  if (expectedBuf.length !== sigBuf.length) return null;
  if (!crypto.timingSafeEqual(expectedBuf, sigBuf)) return null;
  try {
    const payload = JSON.parse(base64UrlDecode(body).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Math.floor(Date.now() / 1000)) return null;
    return {
      userId: payload.sub,
      username: payload.usr,
      role: payload.role || 'user',
    };
  } catch {
    return null;
  }
}

// ── Public API ──

export function isAuthEnabled() {
  return AUTH_ENABLED;
}

export async function registerUser({ username, password, displayName }) {
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' };
  }
  if (username.length < 2 || username.length > 50) {
    return { ok: false, error: 'Username must be 2-50 characters.' };
  }
  if (password.length < 6) {
    return { ok: false, error: 'Password must be at least 6 characters.' };
  }
  // Sanitize username
  if (!/^[a-zA-Z0-9_.-]+$/.test(username)) {
    return { ok: false, error: 'Username may only contain letters, numbers, dots, hyphens, and underscores.' };
  }

  const store = await readUsers();
  if (store.users.some(u => u.username.toLowerCase() === username.toLowerCase())) {
    return { ok: false, error: 'Username already taken.' };
  }

  const userId = crypto.randomUUID();
  const passwordHash = await hashPassword(password);
  const user = {
    id: userId,
    username: username.toLowerCase(),
    displayName: displayName || username,
    passwordHash,
    role: store.users.length === 0 ? 'admin' : 'user', // First user is admin
    createdAt: new Date().toISOString(),
  };

  store.users.push(user);
  await writeUsers(store);

  const token = issueSessionToken({ userId: user.id, username: user.username, role: user.role });
  return {
    ok: true,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    token,
  };
}

export async function loginUser({ username, password }) {
  if (!username || !password) {
    return { ok: false, error: 'Username and password are required.' };
  }

  const store = await readUsers();
  const user = store.users.find(u => u.username.toLowerCase() === username.toLowerCase());
  if (!user) {
    return { ok: false, error: 'Invalid username or password.' };
  }

  const valid = await verifyPassword(password, user.passwordHash);
  if (!valid) {
    return { ok: false, error: 'Invalid username or password.' };
  }

  const token = issueSessionToken({ userId: user.id, username: user.username, role: user.role });
  return {
    ok: true,
    user: { id: user.id, username: user.username, displayName: user.displayName, role: user.role },
    token,
  };
}

export async function getUser(userId) {
  const store = await readUsers();
  const user = store.users.find(u => u.id === userId);
  if (!user) return null;
  return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
}

export async function listUsers() {
  const store = await readUsers();
  return store.users.map(u => ({
    id: u.id,
    username: u.username,
    displayName: u.displayName,
    role: u.role,
    createdAt: u.createdAt,
  }));
}

export async function hasAnyUsers() {
  const store = await readUsers();
  return store.users.length > 0;
}

/**
 * Find or create a user from an OIDC identity.
 * Matches by oidcSub (IdP subject). If no match, creates a new user.
 */
export async function findOrCreateOIDCUser({ sub, email, name }) {
  const store = await readUsers();

  // Match by OIDC subject
  let user = store.users.find(u => u.oidcSub === sub);
  if (user) {
    // Update display name / email if changed at IdP
    if (name && name !== user.displayName) user.displayName = name;
    if (email && email !== user.email) user.email = email;
    await writeUsers(store);
    return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
  }

  // Also try matching by email (link existing local account to OIDC)
  if (email) {
    user = store.users.find(u => u.email?.toLowerCase() === email.toLowerCase() || u.username.toLowerCase() === email.toLowerCase());
    if (user) {
      user.oidcSub = sub;
      if (name && !user.displayName) user.displayName = name;
      if (email) user.email = email;
      await writeUsers(store);
      return { id: user.id, username: user.username, displayName: user.displayName, role: user.role };
    }
  }

  // Create new user
  const userId = crypto.randomUUID();
  const username = (email || `oidc-${sub}`).toLowerCase().replace(/[^a-z0-9_.-]/g, '_').slice(0, 50);
  // Ensure unique username
  let finalUsername = username;
  let suffix = 1;
  while (store.users.some(u => u.username === finalUsername)) {
    finalUsername = `${username.slice(0, 45)}_${suffix++}`;
  }

  const newUser = {
    id: userId,
    username: finalUsername,
    displayName: name || email || sub,
    email: email || '',
    passwordHash: '', // OIDC users have no local password
    oidcSub: sub,
    role: store.users.length === 0 ? 'admin' : 'user',
    createdAt: new Date().toISOString(),
  };

  store.users.push(newUser);
  await writeUsers(store);
  return { id: newUser.id, username: newUser.username, displayName: newUser.displayName, role: newUser.role };
}

export async function changePassword({ userId, currentPassword, newPassword }) {
  if (!newPassword || newPassword.length < 6) {
    return { ok: false, error: 'New password must be at least 6 characters.' };
  }

  const store = await readUsers();
  const user = store.users.find(u => u.id === userId);
  if (!user) return { ok: false, error: 'User not found.' };

  const valid = await verifyPassword(currentPassword, user.passwordHash);
  if (!valid) return { ok: false, error: 'Current password is incorrect.' };

  user.passwordHash = await hashPassword(newPassword);
  await writeUsers(store);
  return { ok: true };
}
