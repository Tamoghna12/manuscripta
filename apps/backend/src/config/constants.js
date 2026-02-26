import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const DATA_DIR = process.env.MANUSCRIPTA_DATA_DIR || path.join(REPO_ROOT, 'data');
export const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates');
export const TEMPLATE_MANIFEST = path.join(TEMPLATE_DIR, 'manifest.json');
export const PORT = Number(process.env.PORT || 8787);
export const COLLAB_TOKEN_SECRET = process.env.MANUSCRIPTA_COLLAB_TOKEN_SECRET || 'manuscripta-collab-dev';
export const COLLAB_TOKEN_TTL = Number(process.env.MANUSCRIPTA_COLLAB_TOKEN_TTL || 24 * 60 * 60);
const requireTokenEnv = process.env.MANUSCRIPTA_COLLAB_REQUIRE_TOKEN;
export const COLLAB_REQUIRE_TOKEN = requireTokenEnv
  ? !['0', 'false', 'no'].includes(String(requireTokenEnv).toLowerCase())
  : true;
export const COLLAB_FLUSH_DEBOUNCE_MS = Number(process.env.MANUSCRIPTA_COLLAB_FLUSH_DEBOUNCE_MS || 800);
export const TUNNEL_MODE = process.env.MANUSCRIPTA_TUNNEL || 'false';

// MinerU API
export const MINERU_API_BASE = 'https://mineru.net/api/v4';
export const MINERU_POLL_INTERVAL_MS = 3000;
export const MINERU_MAX_POLL_ATTEMPTS = 200;

// Zotero
export const ZOTERO_CONFIG_PATH = path.join(DATA_DIR, 'zotero-config.json');

// Mendeley OAuth
export const MENDELEY_CLIENT_ID = process.env.MANUSCRIPTA_MENDELEY_CLIENT_ID || '';
export const MENDELEY_CLIENT_SECRET = process.env.MANUSCRIPTA_MENDELEY_CLIENT_SECRET || '';
export const MENDELEY_REDIRECT_URI = process.env.MANUSCRIPTA_MENDELEY_REDIRECT_URI || '';
export const MENDELEY_TOKENS_PATH = path.join(DATA_DIR, 'mendeley-tokens.json');
export const MENDELEY_STATE_PATH = path.join(DATA_DIR, 'mendeley-oauth-state.json');
