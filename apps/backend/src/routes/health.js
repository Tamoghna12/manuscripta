import { readTemplateManifest } from '../services/templateService.js';

export function registerHealthRoutes(fastify) {
  fastify.get('/api/health', async () => ({ ok: true }));

  fastify.get('/api/templates', async () => {
    const templates = await readTemplateManifest();
    return { templates };
  });
}
