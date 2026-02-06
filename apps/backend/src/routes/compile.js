import { runTectonicCompile } from '../services/compileService.js';

export function registerCompileRoutes(fastify) {
  fastify.post('/api/compile', async (req) => {
    const { projectId, mainFile = 'main.tex', engine = 'tectonic' } = req.body || {};
    if (!projectId) {
      return { ok: false, error: 'Missing projectId.' };
    }
    if (engine !== 'tectonic') {
      return { ok: false, error: 'Unsupported engine.' };
    }
    return runTectonicCompile({ projectId, mainFile });
  });
}
