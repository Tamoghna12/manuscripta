import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
  MENDELEY_CLIENT_ID,
  MENDELEY_CLIENT_SECRET,
  MENDELEY_REDIRECT_URI,
  MENDELEY_TOKENS_PATH,
  MENDELEY_STATE_PATH,
} from '../config/constants.js';

const MENDELEY_AUTH_URL = 'https://api.mendeley.com/oauth/authorize';
const MENDELEY_TOKEN_URL = 'https://api.mendeley.com/oauth/token';
const MENDELEY_API_BASE = 'https://api.mendeley.com';

export function buildAuthorizationUrl(state) {
  const clientId = MENDELEY_CLIENT_ID;
  const redirectUri = MENDELEY_REDIRECT_URI;
  if (!clientId || !redirectUri) {
    throw new Error('Mendeley OAuth not configured. Set MANUSCRIPTA_MENDELEY_CLIENT_ID and MANUSCRIPTA_MENDELEY_REDIRECT_URI.');
  }
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'all',
    state,
  });
  return `${MENDELEY_AUTH_URL}?${params}`;
}

export async function generateAndSaveState() {
  const state = crypto.randomBytes(16).toString('hex');
  const data = { state, createdAt: Date.now() };
  await mkdir(path.dirname(MENDELEY_STATE_PATH), { recursive: true });
  await writeFile(MENDELEY_STATE_PATH, JSON.stringify(data), 'utf8');
  return state;
}

export async function verifyState(state) {
  if (!existsSync(MENDELEY_STATE_PATH)) return false;
  try {
    const data = JSON.parse(await readFile(MENDELEY_STATE_PATH, 'utf8'));
    const TTL = 10 * 60 * 1000; // 10 minutes
    if (data.state !== state) return false;
    if (Date.now() - data.createdAt > TTL) return false;
    return true;
  } catch {
    return false;
  }
}

export async function exchangeCodeForToken(code) {
  const res = await fetch(MENDELEY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: MENDELEY_REDIRECT_URI,
      client_id: MENDELEY_CLIENT_ID,
      client_secret: MENDELEY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Token exchange failed: ${res.status} ${text}`);
  }
  const tokens = await res.json();
  await saveTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
  });
  return tokens;
}

export async function refreshAccessToken() {
  const stored = await loadTokens();
  if (!stored || !stored.refreshToken) {
    throw new Error('No refresh token available.');
  }
  const res = await fetch(MENDELEY_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: stored.refreshToken,
      client_id: MENDELEY_CLIENT_ID,
      client_secret: MENDELEY_CLIENT_SECRET,
    }),
  });
  if (!res.ok) {
    throw new Error(`Token refresh failed: ${res.status}`);
  }
  const tokens = await res.json();
  await saveTokens({
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token || stored.refreshToken,
    expiresAt: Date.now() + (tokens.expires_in || 3600) * 1000,
  });
  return tokens.access_token;
}

async function saveTokens(tokens) {
  await mkdir(path.dirname(MENDELEY_TOKENS_PATH), { recursive: true });
  await writeFile(MENDELEY_TOKENS_PATH, JSON.stringify(tokens, null, 2), 'utf8');
}

async function loadTokens() {
  if (!existsSync(MENDELEY_TOKENS_PATH)) return null;
  try {
    return JSON.parse(await readFile(MENDELEY_TOKENS_PATH, 'utf8'));
  } catch {
    return null;
  }
}

export async function deleteTokens() {
  const { unlink } = await import('fs/promises');
  try {
    if (existsSync(MENDELEY_TOKENS_PATH)) await unlink(MENDELEY_TOKENS_PATH);
    if (existsSync(MENDELEY_STATE_PATH)) await unlink(MENDELEY_STATE_PATH);
  } catch { /* ignore */ }
}

export async function getValidToken() {
  const stored = await loadTokens();
  if (!stored) return null;
  if (Date.now() < stored.expiresAt - 60000) {
    return stored.accessToken;
  }
  // Token expired or about to expire, try refresh
  try {
    return await refreshAccessToken();
  } catch {
    return null;
  }
}

export async function isConnected() {
  const token = await getValidToken();
  return !!token;
}

export async function fetchDocuments(accessToken, { query, limit = 20, offset = 0 } = {}) {
  let url = `${MENDELEY_API_BASE}/documents?view=bib&limit=${limit}&offset=${offset}`;
  if (query) url += `&query=${encodeURIComponent(query)}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Mendeley API error: ${res.status}`);
  return res.json();
}

export async function searchCatalog(accessToken, query, { limit = 20 } = {}) {
  const url = `${MENDELEY_API_BASE}/catalog?query=${encodeURIComponent(query)}&view=bib&limit=${limit}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Mendeley catalog error: ${res.status}`);
  return res.json();
}

/**
 * Fetch a single document by its ID.
 */
export async function fetchDocumentById(accessToken, docId) {
  const url = `${MENDELEY_API_BASE}/documents/${encodeURIComponent(docId)}?view=bib`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`Mendeley document fetch error: ${res.status}`);
  return res.json();
}

/**
 * Escape special BibTeX characters in a string value.
 */
function escapeBibtex(str) {
  if (!str) return '';
  return str
    .replace(/\\/g, '\\textbackslash{}')
    .replace(/[&%$#_{}~^]/g, ch => '\\' + ch);
}

/**
 * Generate a unique cite key from author + year + title word.
 */
function makeCiteKey(doc) {
  const lastName = (doc.authors?.[0]?.last_name || 'unknown')
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const year = doc.year || '0000';
  // Add first significant word of title to reduce collisions
  const titleWord = (doc.title || '')
    .replace(/[^a-zA-Z\s]/g, '')
    .split(/\s+/)
    .find(w => w.length > 3 && !['with', 'from', 'that', 'this', 'some', 'their', 'about'].includes(w.toLowerCase()));
  const suffix = titleWord ? titleWord.charAt(0).toLowerCase() : '';
  return `${lastName}${year}${suffix}`;
}

const BIBTEX_TYPE_MAP = {
  journal: 'article',
  conference_proceedings: 'inproceedings',
  book: 'book',
  book_section: 'incollection',
  thesis: 'phdthesis',
  report: 'techreport',
  web_page: 'misc',
  patent: 'misc',
  generic: 'misc',
  working_paper: 'unpublished',
};

export function documentToBibtex(doc) {
  const type = doc.type || 'article';
  const bibtexType = BIBTEX_TYPE_MAP[type] || type;
  const citeKey = makeCiteKey(doc);
  const authors = (doc.authors || [])
    .map(a => `${a.first_name || ''} ${a.last_name || ''}`.trim())
    .filter(Boolean)
    .join(' and ');

  const fields = [];
  if (authors) fields.push(`  author = {${escapeBibtex(authors)}}`);
  if (doc.title) fields.push(`  title = {${escapeBibtex(doc.title)}}`);
  if (doc.year) fields.push(`  year = {${doc.year}}`);

  // Context-aware source field mapping
  if (doc.source) {
    if (bibtexType === 'article') {
      fields.push(`  journal = {${escapeBibtex(doc.source)}}`);
    } else if (bibtexType === 'inproceedings' || bibtexType === 'incollection') {
      fields.push(`  booktitle = {${escapeBibtex(doc.source)}}`);
    } else {
      fields.push(`  publisher = {${escapeBibtex(doc.source)}}`);
    }
  }

  if (doc.volume) fields.push(`  volume = {${doc.volume}}`);
  if (doc.issue) fields.push(`  number = {${doc.issue}}`);
  if (doc.pages) fields.push(`  pages = {${doc.pages}}`);
  if (doc.identifiers?.doi) fields.push(`  doi = {${doc.identifiers.doi}}`);
  if (doc.identifiers?.isbn) fields.push(`  isbn = {${doc.identifiers.isbn}}`);
  if (doc.identifiers?.issn) fields.push(`  issn = {${doc.identifiers.issn}}`);
  if (doc.identifiers?.url) fields.push(`  url = {${doc.identifiers.url}}`);
  if (doc.publisher) fields.push(`  publisher = {${escapeBibtex(doc.publisher)}}`);
  if (doc.edition) fields.push(`  edition = {${escapeBibtex(doc.edition)}}`);

  return `@${bibtexType}{${citeKey},\n${fields.join(',\n')}\n}`;
}
