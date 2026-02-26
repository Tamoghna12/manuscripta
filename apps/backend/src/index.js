import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import multipart from '@fastify/multipart';
import websocket from '@fastify/websocket';
import { ensureDir } from './utils/fsUtils.js';
import { DATA_DIR, PORT, TUNNEL_MODE, COLLAB_TOKEN_SECRET } from './config/constants.js';
import { registerHealthRoutes } from './routes/health.js';
import { registerArxivRoutes } from './routes/arxiv.js';
import { registerProjectRoutes } from './routes/projects.js';
import { registerCompileRoutes } from './routes/compile.js';
import { registerLLMRoutes } from './routes/llm.js';
import { registerVisionRoutes } from './routes/vision.js';
import { registerPlotRoutes } from './routes/plot.js';
import { registerAgentRoutes } from './routes/agent.js';
import { registerCollabRoutes } from './routes/collab.js';
import { registerTransferRoutes } from './routes/transfer.js';
import { registerGrammarRoutes } from './routes/grammar.js';
import { registerZoteroRoutes } from './routes/zotero.js';
import { registerGitRoutes } from './routes/git.js';
import { registerMendeleyRoutes } from './routes/mendeley.js';
import { registerBackupRoutes } from './routes/backup.js';
import { registerAuthRoutes } from './routes/auth.js';
import { registerAdminRoutes } from './routes/admin.js';
import { audit } from './services/auditService.js';
import { recordRequest, getMetrics } from './services/metricsService.js';
import { tryStartTunnel } from './services/tunnel.js';
import { startBackupScheduler } from './services/backupService.js';
import { requireAuthIfRemote } from './utils/authUtils.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

const isProduction = process.env.NODE_ENV === 'production';
const fastify = Fastify({
  logger: isProduction
    ? { level: 'info' } // structured JSON in production (pino default)
    : { level: 'info', transport: { target: 'pino-pretty', options: { translateTime: 'HH:MM:ss', ignore: 'pid,hostname' } } },
});

await fastify.register(cors, { origin: true });
await fastify.register(helmet, {
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "'unsafe-eval'", 'blob:'],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'", 'ws:', 'wss:', 'https:'],
      workerSrc: ["'self'", 'blob:'],
      fontSrc: ["'self'", 'data:'],
    },
  },
  crossOriginEmbedderPolicy: false,
});
await fastify.register(rateLimit, {
  max: 100,
  timeWindow: '1 minute',
  allowList: ['127.0.0.1', '::1'],
});
await fastify.register(multipart, {
  limits: {
    fileSize: 200 * 1024 * 1024
  }
});
await fastify.register(websocket);
fastify.decorateRequest('collabAuth', null);

fastify.addHook('preHandler', async (req, reply) => {
  if (!req.url.startsWith('/api')) return;
  if (req.method === 'OPTIONS') return;
  if (req.url.startsWith('/api/health')) return;
  if (req.url.startsWith('/api/auth')) return;
  if (req.url.startsWith('/api/collab')) return;
  if (req.url.startsWith('/api/mendeley/callback')) return;
  if (req.url.startsWith('/api/mendeley/auth')) return;
  const auth = requireAuthIfRemote(req);
  if (!auth.ok) {
    reply.code(401).send({ ok: false, error: 'Unauthorized' });
  }
  req.collabAuth = auth.payload || null;
});

// Audit logging hook — records successful mutations on key API routes
const AUDIT_ROUTES = [
  { method: 'POST', pattern: /^\/api\/projects$/, event: 'project.create' },
  { method: 'DELETE', pattern: /^\/api\/projects\/[^/]+$/, event: 'project.delete' },
  { method: 'DELETE', pattern: /^\/api\/projects\/[^/]+\/permanent$/, event: 'project.permanent_delete' },
  { method: 'POST', pattern: /^\/api\/projects\/[^/]+\/rename-project$/, event: 'project.rename' },
  { method: 'PATCH', pattern: /^\/api\/projects\/[^/]+\/archive$/, event: 'project.archive' },
  { method: 'PATCH', pattern: /^\/api\/projects\/[^/]+\/trash$/, event: 'project.trash' },
  { method: 'PUT', pattern: /^\/api\/projects\/[^/]+\/file$/, event: 'file.edit' },
  { method: 'DELETE', pattern: /^\/api\/projects\/[^/]+\/file/, event: 'file.delete' },
  { method: 'POST', pattern: /^\/api\/projects\/[^/]+\/upload$/, event: 'file.upload' },
  { method: 'POST', pattern: /^\/api\/compile$/, event: 'compile.start' },
];
fastify.addHook('onResponse', async (req, reply) => {
  if (reply.statusCode >= 400) return; // only log successful ops
  const urlPath = req.url.split('?')[0];
  for (const route of AUDIT_ROUTES) {
    if (req.method === route.method && route.pattern.test(urlPath)) {
      const userId = req.collabAuth?.sub || null;
      audit(route.event, { userId, ip: req.ip, details: { url: urlPath } });
      break;
    }
  }
});

// Metrics collection hook
fastify.addHook('onRequest', async (req) => {
  req._metricsStart = Date.now();
});
fastify.addHook('onResponse', async (req, reply) => {
  if (req._metricsStart) {
    recordRequest(req.method, req.url, reply.statusCode, Date.now() - req._metricsStart);
  }
});

// Metrics endpoint
fastify.get('/api/health/metrics', async () => {
  return { ok: true, ...getMetrics() };
});

registerHealthRoutes(fastify);
registerArxivRoutes(fastify);
registerProjectRoutes(fastify);
registerCompileRoutes(fastify);
registerLLMRoutes(fastify);
registerVisionRoutes(fastify);
registerPlotRoutes(fastify);
registerAgentRoutes(fastify);
registerCollabRoutes(fastify);
registerTransferRoutes(fastify);
registerGrammarRoutes(fastify);
registerZoteroRoutes(fastify);
registerGitRoutes(fastify);
registerMendeleyRoutes(fastify);
registerBackupRoutes(fastify);
registerAuthRoutes(fastify);
registerAdminRoutes(fastify);

// Serve frontend static files in tunnel/production mode
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const frontendDist = join(__dirname, '../../frontend/dist');

if (existsSync(frontendDist)) {
  const fastifyStatic = await import('@fastify/static');
  await fastify.register(fastifyStatic.default, {
    root: frontendDist,
    prefix: '/',
    wildcard: false,
  });

  // SPA fallback: serve index.html for non-API routes
  fastify.setNotFoundHandler((req, reply) => {
    if (req.url.startsWith('/api')) {
      reply.code(404).send({ error: 'Not Found' });
    } else {
      reply.sendFile('index.html');
    }
  });
}

await ensureDir(DATA_DIR);

// Startup environment validation
const warnings = [];
if (COLLAB_TOKEN_SECRET === 'manuscripta-collab-dev') {
  warnings.push('MANUSCRIPTA_COLLAB_TOKEN_SECRET is using the default value. Set a strong secret for production use.');
}
if (!process.env.MANUSCRIPTA_LLM_API_KEY) {
  warnings.push('MANUSCRIPTA_LLM_API_KEY is not set. AI features will require users to configure an API key in the UI.');
}
if (warnings.length > 0) {
  console.log('');
  console.log('  ⚠ Configuration warnings:');
  for (const w of warnings) {
    console.log(`    - ${w}`);
  }
}

await fastify.listen({ port: PORT, host: '0.0.0.0' });

startBackupScheduler();

console.log('');
console.log(`  Manuscripta started at http://localhost:${PORT}`);
console.log('');

const tunnelMode = TUNNEL_MODE.toLowerCase().trim();
if (tunnelMode !== 'false' && tunnelMode !== '0' && tunnelMode !== 'no') {
  console.log('  Tunnel starting...');
  const result = await tryStartTunnel(PORT);
  if (result) {
    console.log(`  Tunnel active (${result.provider}):`);
    console.log(`  Public URL: ${result.url}`);
    console.log('  Share this URL to collaborate remotely!');
    console.log('');
  } else {
    console.log('  Tunnel failed to start. Check that the provider is installed.');
    console.log('');
  }
} else {
  console.log('  Want remote collaboration? Start with tunnel:');
  console.log('    MANUSCRIPTA_TUNNEL=localtunnel npm start');
  console.log('    MANUSCRIPTA_TUNNEL=cloudflared npm start');
  console.log('    MANUSCRIPTA_TUNNEL=ngrok npm start');
  console.log('');
}
