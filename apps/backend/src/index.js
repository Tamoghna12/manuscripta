import Fastify from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { promises as fs, createWriteStream } from 'fs';
import path from 'path';
import crypto from 'crypto';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { pipeline } from 'stream/promises';
import { applyPatch, createTwoFilesPatch } from 'diff';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { AgentExecutor, createOpenAIToolsAgent } from 'langchain/agents';
import { ChatPromptTemplate, MessagesPlaceholder } from '@langchain/core/prompts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const DATA_DIR = process.env.OPENPRISM_DATA_DIR || path.join(REPO_ROOT, 'data');
const TEMPLATE_DIR = path.join(REPO_ROOT, 'templates');
const PORT = Number(process.env.PORT || 8787);
const TEMPLATE_MANIFEST = path.join(TEMPLATE_DIR, 'manifest.json');

const fastify = Fastify({ logger: true });
await fastify.register(cors, { origin: true });
await fastify.register(multipart, {
  limits: {
    fileSize: 50 * 1024 * 1024
  }
});

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

function safeJoin(root, targetPath) {
  const resolved = path.resolve(root, targetPath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Invalid path');
  }
  return resolved;
}

function sanitizeUploadPath(filename) {
  if (!filename) return '';
  const normalized = filename.replace(/\\/g, '/').replace(/^\/+/, '');
  const parts = normalized.split('/').filter((part) => part && part !== '.' && part !== '..');
  return parts.join('/');
}

const TEXT_EXTENSIONS = new Set([
  '.tex',
  '.bib',
  '.sty',
  '.cls',
  '.bst',
  '.txt',
  '.md',
  '.json',
  '.yaml',
  '.yml',
  '.csv',
  '.tsv'
]);

function isTextFile(filePath) {
  return TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

async function readTemplateManifest() {
  try {
    const data = await readJson(TEMPLATE_MANIFEST);
    return Array.isArray(data?.templates) ? data.templates : [];
  } catch {
    return [];
  }
}

function extractDocumentBody(tex) {
  const startMarker = '\\\\begin{document}';
  const endMarker = '\\\\end{document}';
  const start = tex.indexOf(startMarker);
  const end = tex.lastIndexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return '';
  const bodyStart = start + startMarker.length;
  return tex.slice(bodyStart, end).trim();
}

function mergeTemplateBody(template, body) {
  const startMarker = '\\\\begin{document}';
  const endMarker = '\\\\end{document}';
  const start = template.indexOf(startMarker);
  const end = template.lastIndexOf(endMarker);
  if (start === -1 || end === -1 || end <= start) return template;
  const before = template.slice(0, start + startMarker.length);
  const after = template.slice(end);
  const nextBody = body ? `\n${body}\n` : '\n';
  return `${before}${nextBody}${after}`;
}

async function readJson(filePath) {
  const raw = await fs.readFile(filePath, 'utf8');
  return JSON.parse(raw);
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, JSON.stringify(data, null, 2), 'utf8');
}

async function copyDir(src, dest) {
  await ensureDir(dest);
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, destPath);
    } else {
      await fs.copyFile(srcPath, destPath);
    }
  }
}

async function copyTemplateIntoProject(templateRoot, projectRoot) {
  const changed = [];
  const walk = async (rel = '') => {
    const dirPath = path.join(templateRoot, rel);
    const entries = await fs.readdir(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      const nextRel = path.join(rel, entry.name);
      if (entry.name === 'main.tex') continue;
      const srcPath = path.join(templateRoot, nextRel);
      const destPath = path.join(projectRoot, nextRel);
      if (entry.isDirectory()) {
        await ensureDir(destPath);
        await walk(nextRel);
      } else {
        const ext = path.extname(entry.name).toLowerCase();
        const shouldOverwrite = ext && ext !== '.tex';
        try {
          await fs.access(destPath);
          if (!shouldOverwrite) continue;
        } catch {
          // file missing; proceed to copy
        }
        await ensureDir(path.dirname(destPath));
        await fs.copyFile(srcPath, destPath);
        changed.push(nextRel);
      }
    }
  };
  await walk('');
  return changed;
}

async function listFilesRecursive(root, rel = '') {
  const dirPath = path.join(root, rel);
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const items = [];
  for (const entry of entries) {
    if (entry.name === 'project.json' || entry.name === '.compile') continue;
    const itemRel = path.join(rel, entry.name);
    const full = path.join(root, itemRel);
    if (entry.isDirectory()) {
      items.push({ path: itemRel, type: 'dir' });
      items.push(...await listFilesRecursive(root, itemRel));
    } else {
      items.push({ path: itemRel, type: 'file' });
    }
  }
  return items;
}

async function getProjectRoot(id) {
  const projectRoot = path.join(DATA_DIR, id);
  const metaPath = path.join(projectRoot, 'project.json');
  await fs.access(metaPath);
  return projectRoot;
}

function normalizeChatEndpoint(endpoint) {
  if (!endpoint) return 'https://api.openai.com/v1/chat/completions';
  let url = endpoint.trim();
  if (!url) return 'https://api.openai.com/v1/chat/completions';
  url = url.replace(/\/+$/, '');
  if (/\/chat\/completions$/i.test(url)) return url;
  if (/\/v1$/i.test(url)) return `${url}/chat/completions`;
  if (/\/v1\//i.test(url)) return url;
  return `${url}/v1/chat/completions`;
}

async function callOpenAICompatible({ messages, model, endpoint, apiKey }) {
  const finalEndpoint = normalizeChatEndpoint(endpoint || process.env.OPENPRISM_LLM_ENDPOINT);
  const finalApiKey = (apiKey || process.env.OPENPRISM_LLM_API_KEY || '').trim();
  const finalModel = (model || process.env.OPENPRISM_LLM_MODEL || 'gpt-4o-mini').trim();

  if (!finalApiKey) {
    return { ok: false, error: 'OPENPRISM_LLM_API_KEY not set' };
  }

  const res = await fetch(finalEndpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${finalApiKey}`
    },
    body: JSON.stringify({
      model: finalModel,
      messages,
      temperature: 0.2
    })
  });

  const text = await res.text();
  if (!res.ok) {
    return { ok: false, error: text || `Request failed with ${res.status}` };
  }
  const contentType = res.headers.get('content-type') || '';
  if (!contentType.includes('application/json')) {
    return { ok: false, error: text || 'Non-JSON response from provider.' };
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false, error: text || 'Invalid JSON response.' };
  }
  const content = json?.choices?.[0]?.message?.content || '';
  return { ok: true, content };
}

function normalizeBaseURL(endpoint) {
  if (!endpoint) return undefined;
  const trimmed = endpoint.replace(/\/+$/, '');
  return trimmed.replace(/\/chat\/completions$/i, '');
}

function resolveLLMConfig(llmConfig) {
  return {
    endpoint: (llmConfig?.endpoint || process.env.OPENPRISM_LLM_ENDPOINT || 'https://api.openai.com/v1/chat/completions').trim(),
    apiKey: (llmConfig?.apiKey || process.env.OPENPRISM_LLM_API_KEY || '').trim(),
    model: (llmConfig?.model || process.env.OPENPRISM_LLM_MODEL || 'gpt-4o-mini').trim()
  };
}

function extractPathFromPatch(patch) {
  const lines = patch.split('\n');
  for (const line of lines) {
    if (line.startsWith('+++ ')) {
      let filePath = line.slice(4).trim();
      if (filePath.startsWith('b/')) filePath = filePath.slice(2);
      return filePath;
    }
  }
  for (const line of lines) {
    if (line.startsWith('--- ')) {
      let filePath = line.slice(4).trim();
      if (filePath.startsWith('a/')) filePath = filePath.slice(2);
      return filePath;
    }
  }
  return '';
}

async function runToolAgent({
  projectId,
  activePath,
  task,
  prompt,
  selection,
  compileLog,
  llmConfig
}) {
  if (!projectId) {
    return { ok: false, reply: '缺少 projectId，无法使用工具模式。', patches: [] };
  }

  const projectRoot = await getProjectRoot(projectId);
  const pendingPatches = [];

  const readFileTool = new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read a UTF-8 file from the project. Input: { path } (relative to project root).',
    schema: z.object({ path: z.string() }),
    func: async ({ path: filePath }) => {
      const abs = safeJoin(projectRoot, filePath);
      const content = await fs.readFile(abs, 'utf8');
      return content.slice(0, 20000);
    }
  });

  const listFilesTool = new DynamicStructuredTool({
    name: 'list_files',
    description: 'List files under a directory. Input: { dir } (relative path, optional).',
    schema: z.object({ dir: z.string().optional() }),
    func: async ({ dir }) => {
      const root = dir ? safeJoin(projectRoot, dir) : projectRoot;
      const items = await listFilesRecursive(root, '');
      const files = items.filter((item) => item.type === 'file').map((item) => item.path);
      return JSON.stringify({ files });
    }
  });

  const proposePatchTool = new DynamicStructuredTool({
    name: 'propose_patch',
    description: 'Propose a full file rewrite. Input: { path, content }. This does NOT write. It returns a patch for user confirmation.',
    schema: z.object({ path: z.string(), content: z.string() }),
    func: async ({ path: filePath, content }) => {
      let original = '';
      try {
        const abs = safeJoin(projectRoot, filePath);
        original = await fs.readFile(abs, 'utf8');
      } catch {
        original = '';
      }
      const diff = createTwoFilesPatch(filePath, filePath, original, content, 'current', 'proposed');
      pendingPatches.push({ path: filePath, original, content, diff });
      return `Patch prepared for ${filePath}. Awaiting user confirmation.`;
    }
  });

  const applyPatchTool = new DynamicStructuredTool({
    name: 'apply_patch',
    description: 'Apply a unified diff to a file and propose changes. Input: { patch, path? }. This does NOT write.',
    schema: z.object({ patch: z.string(), path: z.string().optional() }),
    func: async ({ patch, path: providedPath }) => {
      const filePath = providedPath || extractPathFromPatch(patch);
      if (!filePath) {
        throw new Error('Patch missing file path');
      }
      const abs = safeJoin(projectRoot, filePath);
      const original = await fs.readFile(abs, 'utf8');
      const patched = applyPatch(original, patch);
      if (patched === false) {
        throw new Error('Failed to apply patch');
      }
      const diff = createTwoFilesPatch(filePath, filePath, original, patched, 'current', 'proposed');
      pendingPatches.push({ path: filePath, original, content: patched, diff });
      return `Patch applied in memory for ${filePath}. Awaiting user confirmation.`;
    }
  });

  const compileLogTool = new DynamicStructuredTool({
    name: 'get_compile_log',
    description: 'Return the latest compile log from the client (read-only). Input: { }.',
    schema: z.object({}),
    func: async () => {
      return compileLog || 'No compile log provided.';
    }
  });

  const resolved = resolveLLMConfig(llmConfig);
  if (!resolved.apiKey) {
    return { ok: false, reply: 'OPENPRISM_LLM_API_KEY not set', patches: [] };
  }

  const llm = new ChatOpenAI({
    model: resolved.model,
    temperature: 0.2,
    apiKey: resolved.apiKey,
    openAIApiKey: resolved.apiKey,
    configuration: { baseURL: normalizeBaseURL(normalizeChatEndpoint(resolved.endpoint)) }
  });

  const system = [
    'You are a LaTeX paper assistant for OpenPrism.',
    'You can read files and propose patches via tools, and you may call tools multiple times.',
    'If a request affects multiple files (e.g., sections + bib), inspect and update all relevant files.',
    'Never assume writes are applied; use propose_patch and wait for user confirmation.',
    'Use apply_patch for localized edits; use propose_patch for full-file rewrites.',
    'Be concise. Provide a short summary in the final response.'
  ].join(' ');

  const userInput = [
    `Task: ${task || 'polish'}`,
    activePath ? `Active file: ${activePath}` : '',
    prompt ? `User prompt: ${prompt}` : '',
    selection ? `Selection:\\n${selection}` : '',
    compileLog ? `Compile log:\\n${compileLog}` : ''
  ].filter(Boolean).join('\\n\\n');

  const promptTemplate = ChatPromptTemplate.fromMessages([
    ['system', system],
    ['human', '{input}'],
    new MessagesPlaceholder('agent_scratchpad')
  ]);

  const tools = [readFileTool, listFilesTool, proposePatchTool, applyPatchTool, compileLogTool];
  const agent = await createOpenAIToolsAgent({ llm, tools, prompt: promptTemplate });
  const executor = new AgentExecutor({ agent, tools });
  const result = await executor.invoke({ input: userInput });

  return {
    ok: true,
    reply: result.output || '',
    patches: pendingPatches
  };
}

async function runTectonicCompile({ projectId, mainFile }) {
  const projectRoot = await getProjectRoot(projectId);
  const absMain = safeJoin(projectRoot, mainFile);
  await fs.access(absMain);

  const buildRoot = path.join(projectRoot, '.compile');
  await ensureDir(buildRoot);
  const runId = crypto.randomUUID();
  const outDir = path.join(buildRoot, runId);
  await ensureDir(outDir);

  const logChunks = [];
  const MAX_LOG_BYTES = 200_000;
  const pushLog = (chunk) => {
    if (!chunk) return;
    const next = chunk.toString();
    const currentSize = logChunks.reduce((sum, item) => sum + item.length, 0);
    if (currentSize >= MAX_LOG_BYTES) return;
    const remaining = MAX_LOG_BYTES - currentSize;
    logChunks.push(next.slice(0, remaining));
  };

  return new Promise((resolve) => {
    const child = spawn('tectonic', ['--outdir', outDir, mainFile], { cwd: projectRoot });
    child.stdout.on('data', pushLog);
    child.stderr.on('data', pushLog);
    child.on('error', async (err) => {
      await fs.rm(outDir, { recursive: true, force: true });
      resolve({ ok: false, error: `Tectonic not available: ${err.message}` });
    });
    child.on('close', async (code) => {
      const base = path.basename(mainFile, path.extname(mainFile));
      const pdfPath = path.join(outDir, `${base}.pdf`);
      let pdfBase64 = '';
      try {
        const buffer = await fs.readFile(pdfPath);
        pdfBase64 = buffer.toString('base64');
      } catch {
        pdfBase64 = '';
      }
      const log = logChunks.join('');
      await fs.rm(outDir, { recursive: true, force: true });
      if (!pdfBase64) {
        resolve({
          ok: false,
          error: 'No PDF generated.',
          log,
          status: code ?? -1
        });
        return;
      }
      resolve({
        ok: true,
        pdf: pdfBase64,
        log,
        status: code ?? 0
      });
    });
  });
}

fastify.get('/api/health', async () => ({ ok: true }));

fastify.get('/api/templates', async () => {
  const templates = await readTemplateManifest();
  return { templates };
});

fastify.get('/api/projects', async () => {
  await ensureDir(DATA_DIR);
  const entries = await fs.readdir(DATA_DIR, { withFileTypes: true });
  const projects = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const metaPath = path.join(DATA_DIR, entry.name, 'project.json');
    try {
      const meta = await readJson(metaPath);
      projects.push(meta);
    } catch {
      // ignore
    }
  }
  return { projects };
});

fastify.post('/api/projects', async (req, reply) => {
  await ensureDir(DATA_DIR);
  const { name = 'Untitled', template } = req.body || {};
  const id = crypto.randomUUID();
  const projectRoot = path.join(DATA_DIR, id);
  await ensureDir(projectRoot);
  const meta = { id, name, createdAt: new Date().toISOString() };
  await writeJson(path.join(projectRoot, 'project.json'), meta);
  if (template) {
    const templateRoot = path.join(TEMPLATE_DIR, template);
    await copyDir(templateRoot, projectRoot);
  }
  reply.send(meta);
});

fastify.post('/api/projects/:id/rename-project', async (req) => {
  const { id } = req.params;
  const { name } = req.body || {};
  if (!name) return { ok: false, error: 'Missing name' };
  const projectRoot = await getProjectRoot(id);
  const metaPath = path.join(projectRoot, 'project.json');
  const meta = await readJson(metaPath);
  const next = { ...meta, name };
  await writeJson(metaPath, next);
  return { ok: true, project: next };
});

fastify.delete('/api/projects/:id', async (req) => {
  const { id } = req.params;
  const projectRoot = await getProjectRoot(id);
  await fs.rm(projectRoot, { recursive: true, force: true });
  return { ok: true };
});

fastify.get('/api/projects/:id/tree', async (req) => {
  const { id } = req.params;
  const projectRoot = await getProjectRoot(id);
  const items = await listFilesRecursive(projectRoot);
  return { items };
});

fastify.get('/api/projects/:id/file', async (req) => {
  const { id } = req.params;
  const { path: filePath } = req.query;
  if (!filePath) return { content: '' };
  const projectRoot = await getProjectRoot(id);
  const abs = safeJoin(projectRoot, filePath);
  const content = await fs.readFile(abs, 'utf8');
  return { content };
});

fastify.get('/api/projects/:id/blob', async (req, reply) => {
  const { id } = req.params;
  const { path: filePath } = req.query;
  if (!filePath) return reply.code(400).send('Missing path');
  const projectRoot = await getProjectRoot(id);
  const abs = safeJoin(projectRoot, filePath);
  const buffer = await fs.readFile(abs);
  const ext = path.extname(filePath).toLowerCase();
  const contentTypes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.pdf': 'application/pdf',
    '.eps': 'application/postscript'
  };
  const contentType = contentTypes[ext] || 'application/octet-stream';
  reply.header('Content-Type', contentType);
  return reply.send(buffer);
});

fastify.post('/api/projects/:id/upload', async (req) => {
  const { id } = req.params;
  const projectRoot = await getProjectRoot(id);
  const saved = [];
  const parts = req.parts();
  for await (const part of parts) {
    if (part.type !== 'file') continue;
    const relPath = sanitizeUploadPath(part.filename);
    if (!relPath) continue;
    const abs = safeJoin(projectRoot, relPath);
    await ensureDir(path.dirname(abs));
    await pipeline(part.file, createWriteStream(abs));
    saved.push(relPath);
  }
  return { ok: true, files: saved };
});

fastify.put('/api/projects/:id/file', async (req) => {
  const { id } = req.params;
  const { path: filePath, content } = req.body || {};
  if (!filePath) return { ok: false };
  const projectRoot = await getProjectRoot(id);
  const abs = safeJoin(projectRoot, filePath);
  await ensureDir(path.dirname(abs));
  await fs.writeFile(abs, content ?? '', 'utf8');
  return { ok: true };
});

fastify.get('/api/projects/:id/files', async (req) => {
  const { id } = req.params;
  const projectRoot = await getProjectRoot(id);
  const items = await listFilesRecursive(projectRoot);
  const files = [];
  for (const item of items) {
    if (item.type !== 'file') continue;
    const abs = path.join(projectRoot, item.path);
    const buffer = await fs.readFile(abs);
    if (isTextFile(item.path)) {
      files.push({ path: item.path, content: buffer.toString('utf8'), encoding: 'utf8' });
    } else {
      files.push({ path: item.path, content: buffer.toString('base64'), encoding: 'base64' });
    }
  }
  return { files };
});

fastify.post('/api/projects/:id/convert-template', async (req) => {
  const { id } = req.params;
  const { targetTemplate, mainFile = 'main.tex' } = req.body || {};
  if (!targetTemplate) return { ok: false, error: 'Missing targetTemplate' };
  const templates = await readTemplateManifest();
  const template = templates.find((item) => item.id === targetTemplate);
  if (!template) return { ok: false, error: 'Unknown template' };

  try {
    const projectRoot = await getProjectRoot(id);
    const currentMainPath = safeJoin(projectRoot, mainFile);
    const templateRoot = path.join(TEMPLATE_DIR, template.id);
    const templateMain = template.mainFile || 'main.tex';
    const templateMainPath = path.join(templateRoot, templateMain);

    let currentTex = '';
    try {
      currentTex = await fs.readFile(currentMainPath, 'utf8');
    } catch {
      currentTex = '';
    }

    const templateTex = await fs.readFile(templateMainPath, 'utf8');
    const body = extractDocumentBody(currentTex);
    const merged = mergeTemplateBody(templateTex, body);
    const changedFiles = await copyTemplateIntoProject(templateRoot, projectRoot);
    await fs.writeFile(safeJoin(projectRoot, templateMain), merged, 'utf8');
    changedFiles.push(templateMain);
    return { ok: true, mainFile: templateMain, changedFiles };
  } catch (err) {
    return { ok: false, error: `Template convert failed: ${String(err)}` };
  }
});

fastify.post('/api/compile', async (req) => {
  const { projectId, mainFile = 'main.tex', engine = 'tectonic' } = req.body || {};
  if (!projectId) {
    return { ok: false, error: 'Missing projectId.' };
  }
  if (engine !== 'tectonic') {
    return { ok: false, error: 'Unsupported engine.' };
  }
  try {
    const result = await runTectonicCompile({ projectId, mainFile });
    if (!result.ok) {
      return { ok: false, error: result.error, log: result.log || '', status: result.status ?? -1 };
    }
    return {
      ok: true,
      pdf: result.pdf,
      log: result.log || '',
      status: result.status ?? 0,
      engine: 'tectonic'
    };
  } catch (err) {
    return { ok: false, error: `Compile failed: ${String(err)}` };
  }
});

fastify.post('/api/projects/:id/template', async (req) => {
  const { id } = req.params;
  const { template } = req.body || {};
  const projectRoot = await getProjectRoot(id);
  if (!template) return { ok: false };
  const templateRoot = path.join(TEMPLATE_DIR, template);
  await copyDir(templateRoot, projectRoot);
  return { ok: true };
});

fastify.post('/api/projects/:id/folder', async (req) => {
  const { id } = req.params;
  const { path: folderPath } = req.body || {};
  if (!folderPath) return { ok: false };
  const projectRoot = await getProjectRoot(id);
  const abs = safeJoin(projectRoot, folderPath);
  await ensureDir(abs);
  return { ok: true };
});

fastify.post('/api/projects/:id/rename', async (req) => {
  const { id } = req.params;
  const { from, to } = req.body || {};
  if (!from || !to) return { ok: false };
  const projectRoot = await getProjectRoot(id);
  const absFrom = safeJoin(projectRoot, from);
  const absTo = safeJoin(projectRoot, to);
  await ensureDir(path.dirname(absTo));
  await fs.rename(absFrom, absTo);
  return { ok: true };
});

fastify.post('/api/llm', async (req) => {
  const { messages, model, llmConfig } = req.body || {};
  const result = await callOpenAICompatible({
    messages,
    model: llmConfig?.model || model,
    endpoint: llmConfig?.endpoint,
    apiKey: llmConfig?.apiKey
  });
  return result;
});

fastify.post('/api/agent/run', async (req) => {
  const {
    task = 'polish',
    prompt = '',
    selection = '',
    content = '',
    mode = 'direct',
    projectId,
    activePath,
    compileLog,
    llmConfig,
    interaction = 'agent',
    history = []
  } = req.body || {};

  if (interaction === 'chat') {
    const safeHistory = Array.isArray(history)
      ? history.filter((item) => item && (item.role === 'user' || item.role === 'assistant') && typeof item.content === 'string')
      : [];
    const system = [
      'You are a helpful academic writing assistant.',
      'This is chat-only mode: do not propose edits, patches, or JSON.',
      'Respond concisely and helpfully.'
    ].join(' ');
    const user = [
      prompt ? `User Prompt: ${prompt}` : '',
      selection ? `Selection (read-only):\n${selection}` : '',
      content ? `Current File (read-only):\n${content}` : '',
      compileLog ? `Compile Log (read-only):\n${compileLog}` : ''
    ].filter(Boolean).join('\n\n');

    const result = await callOpenAICompatible({
      messages: [{ role: 'system', content: system }, ...safeHistory, { role: 'user', content: user }],
      model: llmConfig?.model,
      endpoint: llmConfig?.endpoint,
      apiKey: llmConfig?.apiKey
    });

    if (!result.ok) {
      return {
        ok: false,
        reply: `LLM 未配置或调用失败：${result.error || 'unknown error'}` +
          '。你可以在前端设置里填写 API Key/Endpoint，或配置 OPENPRISM_LLM_* 环境变量。',
        suggestion: ''
      };
    }

    return { ok: true, reply: result.content || '', suggestion: '' };
  }

  if (mode === 'tools') {
    return runToolAgent({ projectId, activePath, task, prompt, selection, compileLog, llmConfig });
  }

  const system =
    task === 'autocomplete'
      ? [
          'You are an autocomplete engine for LaTeX.',
          'Only return JSON with keys: reply, suggestion.',
          'suggestion must be the continuation text after the cursor.',
          'Do not include explanations or code fences.'
        ].join(' ')
      : [
          'You are a LaTeX writing assistant for academic papers.',
          'Return a concise response and a suggested rewrite for the selection or full content.',
          'Output in JSON with keys: reply, suggestion.'
        ].join(' ');

  const user = [
    `Task: ${task}`,
    mode === 'tools' ? 'Mode: tools (use extra reasoning)' : 'Mode: direct',
    prompt ? `User Prompt: ${prompt}` : '',
    selection ? `Selection:\n${selection}` : '',
    selection ? '' : `Full Content:\n${content}`
  ].filter(Boolean).join('\n\n');

  const result = await callOpenAICompatible({
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: user }
    ],
    model: llmConfig?.model,
    endpoint: llmConfig?.endpoint,
    apiKey: llmConfig?.apiKey
  });

  if (!result.ok) {
    return {
      ok: false,
      reply: `LLM 未配置或调用失败：${result.error || 'unknown error'}` +
        '。你可以在前端设置里填写 API Key/Endpoint，或配置 OPENPRISM_LLM_* 环境变量。',
      suggestion: ''
    };
  }

  let reply = '';
  let suggestion = '';
  try {
    const parsed = JSON.parse(result.content);
    reply = parsed.reply || '';
    suggestion = parsed.suggestion || '';
  } catch {
    reply = result.content;
  }

  return { ok: true, reply, suggestion };
});

await ensureDir(DATA_DIR);

fastify.listen({ port: PORT, host: '0.0.0.0' });
