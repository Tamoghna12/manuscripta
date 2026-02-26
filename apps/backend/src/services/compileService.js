import path from 'path';
import { promises as fs } from 'fs';
import { spawn } from 'child_process';
import { ensureDir } from '../utils/fsUtils.js';
import { safeJoin } from '../utils/pathUtils.js';
import { getProjectRoot } from './projectService.js';

/**
 * Extract citation and bibdata lines from a .aux file for cache comparison.
 * Returns a sorted, joined string for cheap equality checks.
 */
async function extractCitationFingerprint(auxPath) {
  try {
    const content = await fs.readFile(auxPath, 'utf8');
    const lines = content.split('\n').filter(
      l => /^\\(citation|bibdata|bibstyle)\{/.test(l)
    );
    return lines.sort().join('\n');
  } catch {
    return '';
  }
}

const SUPPORTED_ENGINES = ['pdflatex', 'xelatex', 'lualatex', 'latexmk', 'tectonic'];

function buildCommand(engine, outDir, mainFile) {
  switch (engine) {
    case 'pdflatex':
    case 'xelatex':
    case 'lualatex':
      return { cmd: engine, args: ['-no-shell-escape', '-synctex=1', '-interaction=nonstopmode', `-output-directory=${outDir}`, mainFile] };
    case 'latexmk':
      return { cmd: 'latexmk', args: ['-pdf', '-no-shell-escape', '-synctex=1', '-interaction=nonstopmode', `-outdir=${outDir}`, mainFile] };
    case 'tectonic':
      return { cmd: 'tectonic', args: ['--synctex', '--outdir', outDir, mainFile] };
    default:
      return null;
  }
}

export { SUPPORTED_ENGINES };

/**
 * Forward search: source file + line → PDF page + coordinates.
 * Uses the `synctex view` CLI.
 */
export async function synctexForward({ projectId, file, line }) {
  const projectRoot = await getProjectRoot(projectId);
  const compileDir = path.join(projectRoot, '.compile');
  const synctexFiles = await fs.readdir(compileDir).catch(() => []);
  const synctexFile = synctexFiles.find(f => f.endsWith('.synctex.gz'));
  if (!synctexFile) return { ok: false, error: 'No synctex data available. Recompile first.' };

  const pdfName = synctexFile.replace('.synctex.gz', '.pdf');
  const pdfPath = path.join(compileDir, pdfName);
  const input = `${line}:0:${file}`;

  try {
    const result = await runSynctex(['view', '-i', input, '-o', pdfPath], projectRoot);
    return { ok: true, ...parseSynctexOutput(result) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

/**
 * Inverse search: PDF page + coordinates → source file + line.
 * Uses the `synctex edit` CLI.
 */
export async function synctexInverse({ projectId, page, x, y }) {
  const projectRoot = await getProjectRoot(projectId);
  const compileDir = path.join(projectRoot, '.compile');
  const synctexFiles = await fs.readdir(compileDir).catch(() => []);
  const synctexFile = synctexFiles.find(f => f.endsWith('.synctex.gz'));
  if (!synctexFile) return { ok: false, error: 'No synctex data available. Recompile first.' };

  const pdfName = synctexFile.replace('.synctex.gz', '.pdf');
  const pdfPath = path.join(compileDir, pdfName);

  try {
    const result = await runSynctex(['edit', '-o', `${page}:${x}:${y}:0`, pdfPath], projectRoot);
    return { ok: true, ...parseSynctexEditOutput(result) };
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function parseSynctexOutput(raw) {
  const entries = [];
  const blocks = raw.split('SyncTeX result begin').slice(1);
  for (const block of blocks) {
    const page = extractField(block, 'Page');
    const h = extractField(block, 'h');
    const v = extractField(block, 'v');
    const W = extractField(block, 'W');
    const H = extractField(block, 'H');
    if (page != null) entries.push({ page: +page, x: +h, y: +v, w: +W, h: +H });
  }
  // Also try single-result format
  if (entries.length === 0) {
    const page = extractField(raw, 'Page');
    const h = extractField(raw, 'h');
    const v = extractField(raw, 'v');
    if (page != null) entries.push({ page: +page, x: +h, y: +v, w: 0, h: 0 });
  }
  return { results: entries };
}

function parseSynctexEditOutput(raw) {
  const entries = [];
  const blocks = raw.split('SyncTeX result begin').slice(1);
  for (const block of blocks) {
    const input = extractField(block, 'Input');
    const line = extractField(block, 'Line');
    const column = extractField(block, 'Column');
    if (input != null) entries.push({ file: input, line: +line, column: +(column || 0) });
  }
  if (entries.length === 0) {
    const input = extractField(raw, 'Input');
    const line = extractField(raw, 'Line');
    if (input != null) entries.push({ file: input, line: +line, column: 0 });
  }
  return { results: entries };
}

function extractField(text, field) {
  const m = text.match(new RegExp(`${field}:(.+)`));
  return m ? m[1].trim() : null;
}

function runSynctex(args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn('synctex', args, { cwd });
    let stdout = '';
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
    }, SYNCTEX_TIMEOUT_MS);
    child.stdout.on('data', d => { stdout += d.toString(); });
    child.stderr.on('data', () => {});
    child.on('error', (err) => {
      clearTimeout(timer);
      if (err.code === 'ENOENT') reject(new Error('synctex CLI not found. Install TeX Live for SyncTeX support.'));
      else reject(err);
    });
    child.on('close', () => {
      clearTimeout(timer);
      if (killed) reject(new Error('synctex timed out'));
      else resolve(stdout);
    });
  });
}

// Engines that need multiple passes + bibtex for citations
const MULTI_PASS_ENGINES = ['pdflatex', 'xelatex', 'lualatex'];

// Per-pass timeout (seconds). Total compile can take up to PASS_TIMEOUT * number_of_passes.
const PASS_TIMEOUT_MS = Number(process.env.MANUSCRIPTA_COMPILE_TIMEOUT || 120) * 1000;
const SYNCTEX_TIMEOUT_MS = 10_000;

function runSpawn(cmd, args, cwd, pushLog, env, timeoutMs = PASS_TIMEOUT_MS) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd, env: env || process.env });
    let killed = false;
    const timer = setTimeout(() => {
      killed = true;
      child.kill('SIGKILL');
      pushLog?.(Buffer.from(`\n[error] Process killed: exceeded ${timeoutMs / 1000}s timeout.\n`));
    }, timeoutMs);
    child.stdout.on('data', pushLog);
    child.stderr.on('data', pushLog);
    child.on('error', (err) => { clearTimeout(timer); reject(err); });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (killed) resolve(-9);
      else resolve(code);
    });
  });
}

/**
 * SSE-streaming compile. Calls `onLog(chunk)` for each log line and `onDone(result)` when finished.
 */
export async function runCompileSSE({ projectId, mainFile, engine = 'pdflatex', clean = false, onLog, onDone }) {
  if (!SUPPORTED_ENGINES.includes(engine)) {
    onDone({ ok: false, error: `Unsupported engine: ${engine}` });
    return;
  }

  let projectRoot;
  try {
    projectRoot = await getProjectRoot(projectId);
    const absMain = safeJoin(projectRoot, mainFile);
    await fs.access(absMain);
  } catch (err) {
    onDone({ ok: false, error: err.message });
    return;
  }

  const buildRoot = path.join(projectRoot, '.compile');
  const outDir = path.join(buildRoot, 'build');
  if (clean) {
    await fs.rm(outDir, { recursive: true, force: true });
  }
  await ensureDir(outDir);

  const logChunks = [];
  const MAX_LOG_BYTES = 200_000;
  const pushLog = (chunk) => {
    if (!chunk) return;
    const text = chunk.toString();
    const currentSize = logChunks.reduce((sum, item) => sum + item.length, 0);
    if (currentSize >= MAX_LOG_BYTES) return;
    const remaining = MAX_LOG_BYTES - currentSize;
    const trimmed = text.slice(0, remaining);
    logChunks.push(trimmed);
    onLog(trimmed);
  };

  const { cmd, args } = buildCommand(engine, outDir, mainFile);
  const needsBibPass = MULTI_PASS_ENGINES.includes(engine);
  const base = path.basename(mainFile, path.extname(mainFile));
  const auxPath = path.join(outDir, `${base}.aux`);

  let code;
  try {
    // Smart pass detection: snapshot citations before pass 1
    const oldFingerprint = needsBibPass ? await extractCitationFingerprint(auxPath) : '';

    onLog(`[compile] Pass 1: ${cmd} ${args.join(' ')}\n`);
    code = await runSpawn(cmd, args, projectRoot, pushLog);

    if (needsBibPass) {
      const newFingerprint = await extractCitationFingerprint(auxPath);
      const bblPath = path.join(outDir, `${base}.bbl`);
      let bblExists = false;
      try { await fs.access(bblPath); bblExists = true; } catch {}

      const skipBib = oldFingerprint === newFingerprint && bblExists && oldFingerprint !== '';

      if (skipBib) {
        // Citations unchanged + .bbl exists → skip bib, only 1 more pass needed
        onLog('[compile] Pass 2/2 (citations unchanged, skipping bibliography)\n');
        code = await runSpawn(cmd, args, projectRoot, pushLog);
      } else {
        // Full rebuild: bib + 2 more passes
        let useBiber = false;
        try {
          const auxContent = await fs.readFile(auxPath, 'utf8');
          useBiber = auxContent.includes('\\abx@aux@');
        } catch {}
        if (!useBiber) {
          try {
            const texContent = await fs.readFile(safeJoin(projectRoot, mainFile), 'utf8');
            useBiber = /\\usepackage(\[.*?\])?\{biblatex\}/.test(texContent);
          } catch {}
        }

        const bibCmd = useBiber ? 'biber' : 'bibtex';
        const bibEnv = { ...process.env, BIBINPUTS: `${projectRoot}:`, BSTINPUTS: `${projectRoot}:` };
        const bibArgs = useBiber ? [`--input-directory=${projectRoot}`, base] : [base];
        try {
          onLog(`[compile] Bibliography: ${bibCmd}\n`);
          await runSpawn(bibCmd, bibArgs, outDir, pushLog, bibEnv);
        } catch {
          pushLog(Buffer.from(`[warn] ${bibCmd} not available, skipping bibliography pass.\n`));
        }

        onLog('[compile] Pass 2/3\n');
        code = await runSpawn(cmd, args, projectRoot, pushLog);
        onLog('[compile] Pass 3/3\n');
        code = await runSpawn(cmd, args, projectRoot, pushLog);
      }
    }
  } catch (err) {
    onDone({ ok: false, error: `${engine} not available: ${err.message}` });
    return;
  }

  const pdfPath = path.join(outDir, `${base}.pdf`);
  let pdfBase64 = '';
  try {
    const buffer = await fs.readFile(pdfPath);
    pdfBase64 = buffer.toString('base64');
  } catch { pdfBase64 = ''; }
  const log = logChunks.join('');

  let hasSynctex = false;
  const synctexSrc = path.join(outDir, `${base}.synctex.gz`);
  const synctexDest = path.join(buildRoot, `${base}.synctex.gz`);
  const pdfDest = path.join(buildRoot, `${base}.pdf`);
  try {
    await fs.access(synctexSrc);
    await fs.copyFile(synctexSrc, synctexDest);
    await fs.copyFile(pdfPath, pdfDest);
    hasSynctex = true;
  } catch {}

  if (!pdfBase64) {
    onDone({ ok: false, error: 'No PDF generated.', log, status: code ?? -1 });
  } else {
    onDone({ ok: true, pdf: pdfBase64, log, status: code ?? 0, hasSynctex });
  }
}

export async function runCompile({ projectId, mainFile, engine = 'pdflatex', clean = false }) {
  if (!SUPPORTED_ENGINES.includes(engine)) {
    return { ok: false, error: `Unsupported engine: ${engine}` };
  }

  const projectRoot = await getProjectRoot(projectId);
  const absMain = safeJoin(projectRoot, mainFile);
  await fs.access(absMain);

  const buildRoot = path.join(projectRoot, '.compile');
  const outDir = path.join(buildRoot, 'build');
  if (clean) {
    await fs.rm(outDir, { recursive: true, force: true });
  }
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

  const { cmd, args } = buildCommand(engine, outDir, mainFile);
  const needsBibPass = MULTI_PASS_ENGINES.includes(engine);
  const base = path.basename(mainFile, path.extname(mainFile));
  const auxPath = path.join(outDir, `${base}.aux`);

  let code;
  try {
    // Smart pass detection: snapshot citations before pass 1
    const oldFingerprint = needsBibPass ? await extractCitationFingerprint(auxPath) : '';

    // Pass 1: generate .aux with \citation{} entries
    code = await runSpawn(cmd, args, projectRoot, pushLog);

    if (needsBibPass) {
      const newFingerprint = await extractCitationFingerprint(auxPath);
      const bblPath = path.join(outDir, `${base}.bbl`);
      let bblExists = false;
      try { await fs.access(bblPath); bblExists = true; } catch {}

      const skipBib = oldFingerprint === newFingerprint && bblExists && oldFingerprint !== '';

      if (skipBib) {
        // Citations unchanged + .bbl exists → skip bib, only 1 more pass needed
        code = await runSpawn(cmd, args, projectRoot, pushLog);
      } else {
        // Full rebuild: bib + 2 more passes
        let useBiber = false;
        try {
          const auxContent = await fs.readFile(auxPath, 'utf8');
          useBiber = auxContent.includes('\\abx@aux@');
        } catch {}

        if (!useBiber) {
          try {
            const texContent = await fs.readFile(safeJoin(projectRoot, mainFile), 'utf8');
            useBiber = /\\usepackage(\[.*?\])?\{biblatex\}/.test(texContent);
          } catch {}
        }

        const bibCmd = useBiber ? 'biber' : 'bibtex';
        const bibEnv = {
          ...process.env,
          BIBINPUTS: `${projectRoot}:`,
          BSTINPUTS: `${projectRoot}:`,
        };
        const bibArgs = useBiber
          ? [`--input-directory=${projectRoot}`, base]
          : [base];

        try {
          await runSpawn(bibCmd, bibArgs, outDir, pushLog, bibEnv);
        } catch {
          pushLog(Buffer.from(`[warn] ${bibCmd} not available, skipping bibliography pass.\n`));
        }

        code = await runSpawn(cmd, args, projectRoot, pushLog);
        code = await runSpawn(cmd, args, projectRoot, pushLog);
      }
    }
  } catch (err) {
    return { ok: false, error: `${engine} not available: ${err.message}` };
  }

  const pdfPath = path.join(outDir, `${base}.pdf`);
  let pdfBase64 = '';
  try {
    const buffer = await fs.readFile(pdfPath);
    pdfBase64 = buffer.toString('base64');
  } catch {
    pdfBase64 = '';
  }
  const log = logChunks.join('');

  // Preserve synctex.gz for forward/inverse search
  let hasSynctex = false;
  const synctexSrc = path.join(outDir, `${base}.synctex.gz`);
  const synctexDest = path.join(buildRoot, `${base}.synctex.gz`);
  const pdfDest = path.join(buildRoot, `${base}.pdf`);
  try {
    await fs.access(synctexSrc);
    await fs.copyFile(synctexSrc, synctexDest);
    await fs.copyFile(pdfPath, pdfDest);
    hasSynctex = true;
  } catch { /* synctex not generated — ok */ }

  if (!pdfBase64) {
    return { ok: false, error: 'No PDF generated.', log, status: code ?? -1 };
  }
  return { ok: true, pdf: pdfBase64, log, status: code ?? 0, hasSynctex };
}
