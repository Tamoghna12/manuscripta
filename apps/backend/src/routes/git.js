import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import path from 'path';
import { DATA_DIR } from '../config/constants.js';
import {
  isGitRepo,
  initRepo,
  getStatus,
  commitAll,
  getLog,
  getDiff,
  listBranches,
  createBranch,
  checkoutBranch,
  push,
  pull,
  addRemote,
} from '../services/gitService.js';

function projectDir(id) {
  return path.join(DATA_DIR, id);
}

async function readRemoteConfig(dir) {
  const p = path.join(dir, 'git-remote.json');
  try {
    if (!existsSync(p)) return null;
    return JSON.parse(await readFile(p, 'utf8'));
  } catch {
    return null;
  }
}

async function writeRemoteConfig(dir, config) {
  await writeFile(path.join(dir, 'git-remote.json'), JSON.stringify(config, null, 2), 'utf8');
}

export function registerGitRoutes(fastify) {
  // Status: is git repo? + changed files + current branch
  fastify.get('/api/projects/:id/git/status', async (req) => {
    const dir = projectDir(req.params.id);
    if (!existsSync(dir)) return { ok: false, error: 'Project not found.' };
    const initialized = await isGitRepo(dir);
    if (!initialized) return { ok: true, initialized: false };
    try {
      const changes = await getStatus(dir);
      const { branches, current } = await listBranches(dir);
      return { ok: true, initialized: true, changes, branches, currentBranch: current };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Init git repo
  fastify.post('/api/projects/:id/git/init', async (req) => {
    const dir = projectDir(req.params.id);
    if (!existsSync(dir)) return { ok: false, error: 'Project not found.' };
    if (await isGitRepo(dir)) return { ok: true, message: 'Already initialized.' };
    try {
      await initRepo(dir);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Commit all changes
  fastify.post('/api/projects/:id/git/commit', async (req) => {
    const dir = projectDir(req.params.id);
    const { message, authorName, authorEmail } = req.body || {};
    try {
      const sha = await commitAll(dir, { message, authorName, authorEmail });
      return { ok: true, sha };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Commit log
  fastify.get('/api/projects/:id/git/log', async (req) => {
    const dir = projectDir(req.params.id);
    const depth = Math.min(100, Math.max(1, Number(req.query?.depth) || 20));
    try {
      const commits = await getLog(dir, depth);
      return { ok: true, commits };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Diff between two commits
  fastify.post('/api/projects/:id/git/diff', async (req) => {
    const dir = projectDir(req.params.id);
    const { oid1, oid2 } = req.body || {};
    if (!oid1 || !oid2) return { ok: false, error: 'oid1 and oid2 required.' };
    try {
      const diffs = await getDiff(dir, oid1, oid2);
      return { ok: true, diffs };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Create branch
  fastify.post('/api/projects/:id/git/branch', async (req) => {
    const dir = projectDir(req.params.id);
    const { name } = req.body || {};
    if (!name) return { ok: false, error: 'Branch name required.' };
    try {
      await createBranch(dir, name);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Checkout branch
  fastify.post('/api/projects/:id/git/checkout', async (req) => {
    const dir = projectDir(req.params.id);
    const { name } = req.body || {};
    if (!name) return { ok: false, error: 'Branch name required.' };
    try {
      await checkoutBranch(dir, name);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Get remote config (PAT masked)
  fastify.get('/api/projects/:id/git/remote', async (req) => {
    const dir = projectDir(req.params.id);
    const config = await readRemoteConfig(dir);
    if (!config) return { ok: true, remote: null };
    return {
      ok: true,
      remote: {
        url: config.url || '',
        username: config.username || '',
        token: config.token ? '***' + config.token.slice(-4) : '',
        branch: config.branch || 'main',
        hasToken: !!config.token,
      },
    };
  });

  // Save remote config
  fastify.post('/api/projects/:id/git/remote', async (req) => {
    const dir = projectDir(req.params.id);
    const { url, username, token, branch } = req.body || {};
    if (!url) return { ok: false, error: 'Remote URL is required.' };
    try {
      await writeRemoteConfig(dir, { url, username, token, branch: branch || 'main' });
      await addRemote(dir, url);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Push
  fastify.post('/api/projects/:id/git/push', async (req) => {
    const dir = projectDir(req.params.id);
    const config = await readRemoteConfig(dir);
    if (!config || !config.url) return { ok: false, error: 'Remote not configured.' };
    try {
      await push(dir, {
        remoteUrl: config.url,
        branch: config.branch || 'main',
        username: config.username,
        token: config.token,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  // Pull
  fastify.post('/api/projects/:id/git/pull', async (req) => {
    const dir = projectDir(req.params.id);
    const config = await readRemoteConfig(dir);
    if (!config || !config.url) return { ok: false, error: 'Remote not configured.' };
    const { authorName, authorEmail } = req.body || {};
    try {
      await pull(dir, {
        remoteUrl: config.url,
        branch: config.branch || 'main',
        username: config.username,
        token: config.token,
        authorName,
        authorEmail,
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
}
