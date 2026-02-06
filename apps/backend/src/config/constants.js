import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
export const DATA_DIR = process.env.OPENPRISM_DATA_DIR || path.join(REPO_ROOT, 'data');
export const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates');
export const TEMPLATE_MANIFEST = path.join(TEMPLATE_DIR, 'manifest.json');
export const PORT = Number(process.env.PORT || 8787);
