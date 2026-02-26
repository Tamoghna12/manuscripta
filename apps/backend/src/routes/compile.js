import { runCompile, runCompileSSE, SUPPORTED_ENGINES, synctexForward, synctexInverse } from '../services/compileService.js';

export function registerCompileRoutes(fastify) {
  // Standard compile (returns full result at end)
  fastify.post('/api/compile', async (req) => {
    const { projectId, mainFile = 'main.tex', engine = 'pdflatex', clean = false } = req.body || {};
    if (!projectId) {
      return { ok: false, error: 'Missing projectId.' };
    }
    if (!SUPPORTED_ENGINES.includes(engine)) {
      return { ok: false, error: `Unsupported engine: ${engine}. Supported: ${SUPPORTED_ENGINES.join(', ')}` };
    }
    return runCompile({ projectId, mainFile, engine, clean: !!clean });
  });

  // SSE compile — streams log lines in real-time, then sends final result
  fastify.get('/api/compile/stream', async (req, reply) => {
    const { projectId, mainFile = 'main.tex', engine = 'pdflatex', clean } = req.query || {};
    if (!projectId) {
      return reply.code(400).send({ ok: false, error: 'Missing projectId.' });
    }
    if (!SUPPORTED_ENGINES.includes(engine)) {
      return reply.code(400).send({ ok: false, error: `Unsupported engine: ${engine}.` });
    }

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });

    const send = (event, data) => {
      reply.raw.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    let closed = false;
    req.raw.on('close', () => { closed = true; });

    await runCompileSSE({
      projectId,
      mainFile,
      engine,
      clean: clean === 'true' || clean === '1',
      onLog: (chunk) => {
        if (closed) return;
        send('log', { text: chunk });
      },
      onDone: (result) => {
        if (closed) return;
        send('done', result);
        reply.raw.end();
      },
    });
  });

  // SyncTeX forward search: source line → PDF position
  fastify.post('/api/synctex/forward', async (req) => {
    const { projectId, file, line } = req.body || {};
    if (!projectId || !file || line == null) {
      return { ok: false, error: 'Missing projectId, file, or line.' };
    }
    return synctexForward({ projectId, file, line: +line });
  });

  // SyncTeX inverse search: PDF position → source line
  fastify.post('/api/synctex/inverse', async (req) => {
    const { projectId, page, x, y } = req.body || {};
    if (!projectId || page == null || x == null || y == null) {
      return { ok: false, error: 'Missing projectId, page, x, or y.' };
    }
    return synctexInverse({ projectId, page: +page, x: +x, y: +y });
  });
}
