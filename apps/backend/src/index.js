import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { ensureDir } from './utils/fsUtils.js';
import { DATA_DIR, PORT } from './config/constants.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerArxivRoutes } from './routes/arxiv.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerLLMRoutes } from './routes/llm.js';
import { registerVisionRoutes } from './routes/vision.js';
import { registerPlotRoutes } from './routes/plot.js';
import { registerAgentRoutes } from './routes/agent.js';

const fastify = Fastify({ logger: true });

await fastify.register(cors, { origin: true });
await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

registerHealthRoutes(fastify);
registerArxivRoutes(fastify);
registerProjectRoutes(fastify);
registerCompileRoutes(fastify);
registerLLMRoutes(fastify);
registerVisionRoutes(fastify);
registerPlotRoutes(fastify);
registerAgentRoutes(fastify);

await ensureDir(DATA_DIR);

fastify.listen({ port: PORT, host: '0.0.0.0' });
