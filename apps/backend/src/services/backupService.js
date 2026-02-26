/**
 * Automatic project backup scheduler.
 *
 * Creates timestamped ZIP snapshots of each project on a configurable
 * interval.  Old backups beyond MANUSCRIPTA_BACKUP_KEEP are pruned
 * automatically.  A manual backup / restore API is also exposed.
 *
 * Environment variables:
 *   MANUSCRIPTA_BACKUP_DIR      – directory for backups (default: <DATA_DIR>/../backups)
 *   MANUSCRIPTA_BACKUP_INTERVAL – seconds between auto-backups (default: 3600 = 1h, 0 = disabled)
 *   MANUSCRIPTA_BACKUP_KEEP     – max backups per project (default: 24)
 */
import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { DATA_DIR } from '../config/constants.js';
import { ensureDir, readJson } from '../utils/fsUtils.js';

const BACKUP_DIR = process.env.MANUSCRIPTA_BACKUP_DIR || path.join(DATA_DIR, '..', 'backups');
const BACKUP_INTERVAL_S = Number(process.env.MANUSCRIPTA_BACKUP_INTERVAL || 3600);
const BACKUP_KEEP = Number(process.env.MANUSCRIPTA_BACKUP_KEEP || 24);

let timer = null;

// ── Public API ──

export function startBackupScheduler() {
  if (BACKUP_INTERVAL_S <= 0) return;
  // Run first backup shortly after startup (30s), then on interval
  timer = setTimeout(async () => {
    await runAllBackups();
    timer = setInterval(runAllBackups, BACKUP_INTERVAL_S * 1000);
  }, 30_000);
}

export function stopBackupScheduler() {
  if (timer) {
    clearTimeout(timer);
    clearInterval(timer);
    timer = null;
  }
}

/**
 * Create a backup ZIP of a single project.
 * Returns { ok, path, size } on success.
 */
export async function backupProject(projectId) {
  const projectRoot = path.join(DATA_DIR, projectId);
  try {
    await fs.access(path.join(projectRoot, 'project.json'));
  } catch {
    return { ok: false, error: 'Project not found' };
  }

  await ensureDir(BACKUP_DIR);
  const projectBackupDir = path.join(BACKUP_DIR, projectId);
  await ensureDir(projectBackupDir);

  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const zipName = `${projectId}_${ts}.zip`;
  const zipPath = path.join(projectBackupDir, zipName);

  try {
    await createZip(projectRoot, zipPath);
    const stat = await fs.stat(zipPath);
    await pruneBackups(projectBackupDir);
    return { ok: true, path: zipPath, name: zipName, size: stat.size };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * List available backups for a project.
 */
export async function listBackups(projectId) {
  const projectBackupDir = path.join(BACKUP_DIR, projectId);
  try {
    const files = await fs.readdir(projectBackupDir);
    const backups = [];
    for (const file of files) {
      if (!file.endsWith('.zip')) continue;
      const stat = await fs.stat(path.join(projectBackupDir, file));
      backups.push({
        name: file,
        size: stat.size,
        createdAt: stat.mtime.toISOString(),
      });
    }
    backups.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return { ok: true, backups };
  } catch {
    return { ok: true, backups: [] };
  }
}

/**
 * Restore a project from a backup ZIP.
 * Replaces all project files (except project.json metadata).
 */
export async function restoreBackup(projectId, backupName) {
  const projectRoot = path.join(DATA_DIR, projectId);
  const zipPath = path.join(BACKUP_DIR, projectId, backupName);

  try {
    await fs.access(zipPath);
  } catch {
    return { ok: false, error: 'Backup not found' };
  }

  try {
    await fs.access(path.join(projectRoot, 'project.json'));
  } catch {
    return { ok: false, error: 'Project not found' };
  }

  // Save current project.json
  let projectMeta;
  try {
    projectMeta = await readJson(path.join(projectRoot, 'project.json'));
  } catch {
    projectMeta = null;
  }

  // Clear project directory (except .compile cache)
  const entries = await fs.readdir(projectRoot);
  for (const entry of entries) {
    if (entry === '.compile') continue;
    await fs.rm(path.join(projectRoot, entry), { recursive: true, force: true });
  }

  // Extract backup
  await extractZip(zipPath, projectRoot);

  // Restore project.json metadata (preserve name, timestamps, etc.)
  if (projectMeta) {
    const restoredMeta = await readJson(path.join(projectRoot, 'project.json')).catch(() => ({}));
    const merged = {
      ...restoredMeta,
      name: projectMeta.name,
      createdAt: projectMeta.createdAt,
      updatedAt: new Date().toISOString(),
    };
    await fs.writeFile(path.join(projectRoot, 'project.json'), JSON.stringify(merged, null, 2), 'utf8');
  }

  return { ok: true };
}

/**
 * Delete a specific backup file.
 */
export async function deleteBackup(projectId, backupName) {
  const zipPath = path.join(BACKUP_DIR, projectId, backupName);
  try {
    await fs.unlink(zipPath);
    return { ok: true };
  } catch {
    return { ok: false, error: 'Backup not found' };
  }
}

/**
 * Get backup configuration info.
 */
export function getBackupConfig() {
  return {
    dir: BACKUP_DIR,
    intervalSeconds: BACKUP_INTERVAL_S,
    keepCount: BACKUP_KEEP,
    enabled: BACKUP_INTERVAL_S > 0,
  };
}

// ── Internal ──

async function runAllBackups() {
  try {
    const entries = await fs.readdir(DATA_DIR);
    for (const entry of entries) {
      const metaPath = path.join(DATA_DIR, entry, 'project.json');
      try {
        await fs.access(metaPath);
        await backupProject(entry);
      } catch {
        // Not a project directory, skip
      }
    }
  } catch (err) {
    console.error('[backup] Auto-backup failed:', err.message);
  }
}

async function pruneBackups(dir) {
  try {
    const files = await fs.readdir(dir);
    const zips = files.filter(f => f.endsWith('.zip')).sort();
    while (zips.length > BACKUP_KEEP) {
      const oldest = zips.shift();
      await fs.unlink(path.join(dir, oldest)).catch(() => {});
    }
  } catch {
    // ignore
  }
}

function createZip(sourceDir, destPath) {
  return new Promise((resolve, reject) => {
    const child = spawn('zip', ['-r', destPath, '.'], {
      cwd: sourceDir,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('zip command not found. Install zip utility.'));
      else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`zip exited with code ${code}`));
    });
  });
}

function extractZip(zipPath, destDir) {
  return new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-o', zipPath, '-d', destDir], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    child.on('error', (err) => {
      if (err.code === 'ENOENT') reject(new Error('unzip command not found. Install unzip utility.'));
      else reject(err);
    });
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`unzip exited with code ${code}`));
    });
  });
}
