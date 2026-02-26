import path from 'path';
import { readJson, writeJson, ensureDir } from '../utils/fsUtils.js';
import { getProjectRoot } from '../services/projectService.js';

const MANUSCRIPTA_DIR = '.manuscripta';
const COMMENTS_FILE = 'comments.json';
const CHANGES_FILE = 'track-changes.json';

async function getReviewDir(projectId) {
  const root = await getProjectRoot(projectId);
  const dir = path.join(root, MANUSCRIPTA_DIR);
  await ensureDir(dir);
  return dir;
}

async function loadReviewFile(projectId, filename) {
  const dir = await getReviewDir(projectId);
  const filePath = path.join(dir, filename);
  try {
    return await readJson(filePath);
  } catch {
    return {};
  }
}

async function saveReviewFile(projectId, filename, data) {
  const dir = await getReviewDir(projectId);
  const filePath = path.join(dir, filename);
  await writeJson(filePath, data);
}

export function registerReviewRoutes(fastify) {
  // GET comments for a file
  fastify.get('/api/projects/:id/review/comments', async (req) => {
    const { id } = req.params;
    const file = req.query.file;
    if (!file) return { ok: false, error: 'Missing file parameter' };
    const data = await loadReviewFile(id, COMMENTS_FILE);
    return { ok: true, comments: data[file] || [] };
  });

  // PUT (save) comments for a file
  fastify.put('/api/projects/:id/review/comments', async (req) => {
    const { id } = req.params;
    const { file, comments } = req.body;
    if (!file) return { ok: false, error: 'Missing file parameter' };
    const data = await loadReviewFile(id, COMMENTS_FILE);
    data[file] = comments || [];
    await saveReviewFile(id, COMMENTS_FILE, data);
    return { ok: true };
  });

  // GET tracked changes for a file
  fastify.get('/api/projects/:id/review/changes', async (req) => {
    const { id } = req.params;
    const file = req.query.file;
    if (!file) return { ok: false, error: 'Missing file parameter' };
    const data = await loadReviewFile(id, CHANGES_FILE);
    return { ok: true, changes: data[file] || [] };
  });

  // PUT (save) tracked changes for a file
  fastify.put('/api/projects/:id/review/changes', async (req) => {
    const { id } = req.params;
    const { file, changes } = req.body;
    if (!file) return { ok: false, error: 'Missing file parameter' };
    const data = await loadReviewFile(id, CHANGES_FILE);
    data[file] = changes || [];
    await saveReviewFile(id, CHANGES_FILE, data);
    return { ok: true };
  });
}
