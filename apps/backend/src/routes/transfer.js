import crypto from 'crypto';
import path from 'path';
import { buildTransferGraph } from '../services/transferAgent/graph.js';
import { resolveLLMConfig } from '../services/llmService.js';
import { readTemplateManifest } from '../services/templateService.js';
import { DATA_DIR, TEMPLATE_DIR } from '../config/constants.js';
import { ensureDir, readJson, writeJson, copyDir } from '../utils/fsUtils.js';

// In-memory job store: jobId → { graph, state, status, progressLog }
const jobs = new Map();

export function registerTransferRoutes(fastify) {

  /**
   * POST /api/transfer/start
   * Body: { sourceProjectId, sourceMainFile, targetTemplateId, targetMainFile,
   *         engine?, layoutCheck?, llmConfig? }
   * Creates a new project from the target template, then starts the transfer.
   * Returns: { jobId, newProjectId }
   */
  fastify.post('/api/transfer/start', async (request, reply) => {
    const {
      sourceProjectId, sourceMainFile,
      targetTemplateId, targetMainFile,
      engine = 'pdflatex',
      layoutCheck = false,
      llmConfig,
    } = request.body || {};

    if (!sourceProjectId || !sourceMainFile || !targetTemplateId || !targetMainFile) {
      return reply.code(400).send({ error: 'Missing required fields.' });
    }

    // Validate template exists
    const { templates } = await readTemplateManifest();
    const template = templates.find(t => t.id === targetTemplateId);
    if (!template) {
      return reply.code(400).send({ error: `Unknown template: ${targetTemplateId}` });
    }

    // Create a new project from the template
    await ensureDir(DATA_DIR);
    const newProjectId = crypto.randomUUID();
    const projectRoot = path.join(DATA_DIR, newProjectId);
    await ensureDir(projectRoot);

    // Read source project name for the new project name
    let sourceName = 'Untitled';
    try {
      const srcMeta = await readJson(path.join(DATA_DIR, sourceProjectId, 'project.json'));
      sourceName = srcMeta.name || 'Untitled';
    } catch { /* ignore */ }

    const meta = {
      id: newProjectId,
      name: `${sourceName} (${template.label})`,
      createdAt: new Date().toISOString(),
    };
    await writeJson(path.join(projectRoot, 'project.json'), meta);

    // Copy template files into the new project
    const templateRoot = path.join(TEMPLATE_DIR, targetTemplateId);
    await copyDir(templateRoot, projectRoot);

    // Build transfer graph
    const jobId = crypto.randomUUID();
    const graph = buildTransferGraph();

    const initialState = {
      sourceProjectId,
      sourceMainFile,
      targetProjectId: newProjectId,
      targetMainFile,
      engine,
      layoutCheck,
      llmConfig: resolveLLMConfig(llmConfig),
      jobId,
    };

    jobs.set(jobId, {
      graph,
      state: initialState,
      status: 'pending',
      progressLog: [],
      iterator: null,
    });

    return { jobId, newProjectId };
  });

  /**
   * POST /api/transfer/step
   * Body: { jobId }
   * Runs the graph one step forward.
   * Returns: { status, currentNode, progressLog }
   */
  fastify.post('/api/transfer/step', async (request, reply) => {
    const { jobId } = request.body || {};
    const job = jobs.get(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'Job not found.' });
    }

    // If waiting for images, don't proceed
    if (job.status === 'waiting_images') {
      return { status: 'waiting_images', progressLog: job.progressLog };
    }

    try {
      job.status = 'running';
      const result = await job.graph.invoke(job.state);
      job.state = result;
      job.progressLog = result.progressLog || [];
      job.status = result.status || 'running';

      return {
        status: job.status,
        progressLog: job.progressLog,
      };
    } catch (err) {
      const msg = err?.message || String(err || 'Unknown error');
      job.status = 'error';
      job.error = msg;
      return reply.code(500).send({
        error: msg,
        progressLog: job.progressLog,
      });
    }
  });

  /**
   * POST /api/transfer/submit-images
   * Body: { jobId, images: [{ page, base64, mime }] }
   * Frontend submits PDF page screenshots for VLM layout check.
   */
  fastify.post('/api/transfer/submit-images', async (request, reply) => {
    const { jobId, images } = request.body || {};
    const job = jobs.get(jobId);
    if (!job) {
      return reply.code(404).send({ error: 'Job not found.' });
    }

    if (job.status !== 'waiting_images') {
      return reply.code(400).send({ error: 'Job is not waiting for images.' });
    }

    // Inject images into state and resume
    job.state.pageImages = images || [];
    job.status = 'running';

    return { ok: true };
  });

  /**
   * GET /api/transfer/status/:jobId
   * Returns current job status and progress log.
   */
  fastify.get('/api/transfer/status/:jobId', async (request, reply) => {
    const job = jobs.get(request.params.jobId);
    if (!job) {
      return reply.code(404).send({ error: 'Job not found.' });
    }

    return {
      status: job.status,
      progressLog: job.progressLog,
      error: job.error || null,
    };
  });

} // end registerTransferRoutes
