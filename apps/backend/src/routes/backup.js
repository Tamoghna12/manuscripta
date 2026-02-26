import { promises as fs } from 'fs';
import path from 'path';
import {
  backupProject,
  listBackups,
  restoreBackup,
  deleteBackup,
  getBackupConfig,
} from '../services/backupService.js';

export function registerBackupRoutes(fastify) {
  // Get backup configuration
  fastify.get('/api/backup/config', async () => {
    return { ok: true, config: getBackupConfig() };
  });

  // List backups for a project
  fastify.get('/api/projects/:id/backups', async (req) => {
    const { id } = req.params;
    return listBackups(id);
  });

  // Create a manual backup
  fastify.post('/api/projects/:id/backups', async (req) => {
    const { id } = req.params;
    return backupProject(id);
  });

  // Restore from a backup
  fastify.post('/api/projects/:id/backups/:name/restore', async (req) => {
    const { id, name } = req.params;
    return restoreBackup(id, name);
  });

  // Delete a specific backup
  fastify.delete('/api/projects/:id/backups/:name', async (req) => {
    const { id, name } = req.params;
    return deleteBackup(id, name);
  });

  // Download a backup file
  fastify.get('/api/projects/:id/backups/:name/download', async (req, reply) => {
    const { id, name } = req.params;
    const config = getBackupConfig();
    const filePath = path.join(config.dir, id, name);
    try {
      await fs.access(filePath);
      const stream = await fs.readFile(filePath);
      reply.headers({
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${name}"`,
      });
      return reply.send(stream);
    } catch {
      reply.code(404);
      return { ok: false, error: 'Backup not found' };
    }
  });
}
