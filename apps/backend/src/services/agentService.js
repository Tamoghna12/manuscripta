import { promises as fs } from 'fs';
import { applyPatch, createTwoFilesPatch } from 'diff';
import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';
import { ChatOpenAI } from '@langchain/openai';
import { DynamicStructuredTool } from '@langchain/core/tools';
import { createReactAgent } from '@langchain/langgraph/prebuilt';
import { SystemMessage, HumanMessage } from '@langchain/core/messages';
import { safeJoin } from '../utils/pathUtils.js';
import { listFilesRecursive } from '../utils/fsUtils.js';
import { extractPathFromPatch } from '../utils/diffUtils.js';
import { resolveLLMConfig, normalizeBaseURL, normalizeChatEndpoint, resolveProvider } from './llmService.js';
import { getProjectRoot } from './projectService.js';
import { extractArxivId, fetchArxivEntry, buildArxivBibtex } from './arxivService.js';
import { t } from '../i18n/index.js';

/**
 * Create a LangChain chat model instance based on detected provider.
 */
async function createLLMInstance(resolved) {
  const provider = resolveProvider(resolved.endpoint);

  if (provider === 'anthropic') {
    try {
      const mod = await import('@langchain/anthropic');
      const ChatAnthropic = mod.ChatAnthropic;
      return new ChatAnthropic({
        model: resolved.model || 'claude-sonnet-4-5-20250929',
        temperature: 0.2,
        anthropicApiKey: resolved.apiKey,
        maxTokens: 8192
      });
    } catch {
      console.warn('[@langchain/anthropic not installed] Falling back to OpenAI-compatible mode for Anthropic endpoint.');
      return new ChatOpenAI({
        model: resolved.model || 'claude-sonnet-4-5-20250929',
        temperature: 0.2,
        apiKey: resolved.apiKey,
        openAIApiKey: resolved.apiKey,
        configuration: {
          baseURL: 'https://api.anthropic.com/v1',
          defaultHeaders: {
            'x-api-key': resolved.apiKey,
            'anthropic-version': '2023-06-01'
          }
        }
      });
    }
  }

  if (provider === 'ollama') {
    const baseURL = normalizeBaseURL(normalizeChatEndpoint(resolved.endpoint)) || 'http://localhost:11434/v1';
    return new ChatOpenAI({
      model: resolved.model || 'llama3.3:latest',
      temperature: 0.2,
      apiKey: 'ollama',
      openAIApiKey: 'ollama',
      configuration: { baseURL }
    });
  }

  return new ChatOpenAI({
    model: resolved.model,
    temperature: 0.2,
    apiKey: resolved.apiKey,
    openAIApiKey: resolved.apiKey,
    configuration: { baseURL: normalizeBaseURL(normalizeChatEndpoint(resolved.endpoint)) }
  });
}

/** Task-specific agent system prompts */
const AGENT_SYSTEM_PROMPTS = {
  polish: [
    'You are an expert academic English editor and LaTeX specialist for Manuscripta.',
    'Your task is to POLISH text for publication quality.',
    '',
    'Workflow:',
    '1. ALWAYS start by listing project files to understand the project structure.',
    '2. Read the active file AND any related files (e.g., if editing a section file, also read main.tex to understand \\input structure, and .bib files for citation consistency).',
    '3. Focus on: academic register, precision, conciseness, subject-verb agreement, article usage (a/an/the), tense consistency, hedging language, and eliminating redundancy.',
    '4. Preserve ALL LaTeX commands, labels, references, and document structure.',
    '5. When polishing, ensure citation keys (\\cite{...}) remain valid against the .bib file.',
    '6. Use propose_patch for the polished version.',
    '',
    'Be concise in your final summary. List the key changes made.'
  ].join('\n'),

  rewrite: [
    'You are an expert academic writing assistant and LaTeX specialist for Manuscripta.',
    'Your task is to REWRITE text for improved clarity, flow, and readability.',
    '',
    'Workflow:',
    '1. List project files to understand the structure.',
    '2. Read the active file and related files for context.',
    '3. Rewrite while preserving the original meaning and all LaTeX commands.',
    '4. Ensure the rewrite is suitable for a peer-reviewed venue.',
    '5. Check that cross-references (\\ref, \\cite, \\label) remain consistent.',
    '6. Use propose_patch for the rewritten version.',
    '',
    'Summarize the key improvements in your final response.'
  ].join('\n'),

  structure: [
    'You are an expert academic writing assistant specializing in paper structure and LaTeX.',
    'Your task is to RESTRUCTURE text for better logical flow.',
    '',
    'Workflow:',
    '1. List ALL project files — understand the full document layout (main.tex, sections/, figures/, bib).',
    '2. Read main.tex and all \\input/\\include files to understand the complete paper.',
    '3. Analyze the logical flow: Introduction → Related Work → Method → Experiments → Discussion → Conclusion.',
    '4. Identify structural issues: misplaced content, redundant sections, missing transitions.',
    '5. Propose restructured versions. If content needs to move between files, update ALL affected files.',
    '6. Ensure all cross-references, labels, and citations remain valid after restructuring.',
    '',
    'Explain the structural rationale in your final response.'
  ].join('\n'),

  'fix-errors': [
    'You are an expert LaTeX debugger and academic writing assistant for Manuscripta.',
    'Your task is to FIX compilation errors and warnings.',
    '',
    'Workflow:',
    '1. Read the compile log using get_compile_log.',
    '2. Parse error messages to identify file, line number, and error type.',
    '3. Read the offending file(s) and examine the problematic lines.',
    '4. Common fixes: missing \\end{}, unmatched braces, undefined references, missing packages, bad \\cite keys.',
    '5. For undefined references, check .bib files and ensure citation keys match.',
    '6. For missing figures, check that file paths in \\includegraphics are correct.',
    '7. Propose targeted fixes using apply_patch (prefer localized edits over full rewrites).',
    '',
    'List each error fixed in your final response.'
  ].join('\n'),

  'add-references': [
    'You are an expert academic researcher and LaTeX specialist for Manuscripta.',
    'Your task is to find and add relevant references.',
    '',
    'Workflow:',
    '1. Read the active file to understand the claims and topics that need citations.',
    '2. Search arXiv (and Semantic Scholar for broader coverage) for relevant papers.',
    '3. Read the existing .bib file to avoid duplicate entries and match formatting style.',
    '4. Generate BibTeX entries for found papers using arxiv_bibtex.',
    '5. Add new entries to the .bib file using propose_patch.',
    '6. Insert \\cite{} commands at appropriate locations in the .tex file.',
    '7. Ensure citation keys follow the existing naming convention in the .bib file.',
    '',
    'List the references added and where they were cited in your final response.'
  ].join('\n'),

  default: [
    'You are an expert academic writing assistant and LaTeX specialist for Manuscripta.',
    'You help researchers write clearer, more rigorous, and more publishable papers.',
    '',
    'Workflow:',
    '1. ALWAYS start by listing project files to understand the project structure.',
    '2. Read the active file and any related files (main.tex, .bib, other sections) for full context.',
    '3. If the task involves editing, inspect cross-references and citations for consistency.',
    '4. Use apply_patch for small localized edits; use propose_patch for full-file rewrites.',
    '5. If a request affects multiple files, update ALL affected files.',
    '6. When searching for references, use both arxiv_search and semantic_scholar_search for comprehensive coverage.',
    '',
    'Never assume writes are applied — use propose_patch and wait for user confirmation.',
    'When reviewing text, focus on academic rigor, clarity, and precision.',
    'Be concise. Provide a short summary in the final response.'
  ].join('\n')
};

export async function runToolAgent({
  projectId,
  activePath,
  task,
  prompt,
  selection,
  compileLog,
  llmConfig,
  lang = 'en-US'
}) {
  if (!projectId) {
    return { ok: false, reply: t(lang, 'missing_project_id_tools'), patches: [] };
  }

  const projectRoot = await getProjectRoot(projectId);
  const pendingPatches = [];

  // ── Tools ──

  const readFileTool = new DynamicStructuredTool({
    name: 'read_file',
    description: 'Read a UTF-8 file from the project. Returns file content (truncated to 20K chars). Use this to inspect .tex, .bib, .cls, and other project files before making edits.',
    schema: z.object({
      path: z.string().describe('File path relative to project root, e.g. "main.tex" or "sections/intro.tex"')
    }),
    func: async ({ path: filePath }) => {
      const abs = safeJoin(projectRoot, filePath);
      const content = await fs.readFile(abs, 'utf8');
      return content.slice(0, 20000);
    }
  });

  const listFilesTool = new DynamicStructuredTool({
    name: 'list_files',
    description: 'List all files recursively under a directory. Use this FIRST to understand the project structure before reading or editing files.',
    schema: z.object({
      dir: z.string().optional().describe('Directory relative to project root. Omit to list all project files.')
    }),
    func: async ({ dir }) => {
      const root = dir ? safeJoin(projectRoot, dir) : projectRoot;
      const items = await listFilesRecursive(root, '');
      const files = items.filter((item) => item.type === 'file').map((item) => item.path);
      return JSON.stringify({ files });
    }
  });

  const searchInFileTool = new DynamicStructuredTool({
    name: 'search_in_file',
    description: 'Search for a text pattern (regex or literal) in a file and return matching lines with line numbers. Useful for finding \\label, \\cite, \\ref, or locating specific text before patching.',
    schema: z.object({
      path: z.string().describe('File path relative to project root'),
      pattern: z.string().describe('Text or regex pattern to search for'),
      caseSensitive: z.boolean().optional().describe('Case-sensitive search (default true)')
    }),
    func: async ({ path: filePath, pattern, caseSensitive }) => {
      const abs = safeJoin(projectRoot, filePath);
      const content = await fs.readFile(abs, 'utf8');
      const lines = content.split('\n');
      const flags = caseSensitive === false ? 'gi' : 'g';
      let regex;
      try {
        regex = new RegExp(pattern, flags);
      } catch {
        regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), flags);
      }
      const matches = [];
      for (let i = 0; i < lines.length; i++) {
        if (regex.test(lines[i])) {
          matches.push({ line: i + 1, text: lines[i] });
        }
        regex.lastIndex = 0;
      }
      if (matches.length === 0) return `No matches found for "${pattern}" in ${filePath}.`;
      return JSON.stringify({ matches: matches.slice(0, 50), total: matches.length });
    }
  });

  const proposePatchTool = new DynamicStructuredTool({
    name: 'propose_patch',
    description: 'Propose a full file rewrite. Use this for large changes or new file creation. The patch is NOT applied immediately — it awaits user confirmation. Always read the file first.',
    schema: z.object({
      path: z.string().describe('File path relative to project root'),
      content: z.string().describe('The complete new file content')
    }),
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
      return `Patch prepared for ${filePath} (${pendingPatches.length} total pending). Awaiting user confirmation.`;
    }
  });

  const applyPatchTool = new DynamicStructuredTool({
    name: 'apply_patch',
    description: 'Apply a unified diff patch to a file. Use this for small, localized edits (preferred over propose_patch for minor fixes). The patch is NOT applied immediately — it awaits user confirmation.',
    schema: z.object({
      patch: z.string().describe('Unified diff format patch'),
      path: z.string().optional().describe('File path (auto-detected from patch if omitted)')
    }),
    func: async ({ patch, path: providedPath }) => {
      const filePath = providedPath || extractPathFromPatch(patch);
      if (!filePath) {
        throw new Error('Patch missing file path');
      }
      const abs = safeJoin(projectRoot, filePath);
      const original = await fs.readFile(abs, 'utf8');
      const patched = applyPatch(original, patch);
      if (patched === false) {
        throw new Error('Failed to apply patch — context lines may not match. Try reading the file first and using propose_patch instead.');
      }
      const diff = createTwoFilesPatch(filePath, filePath, original, patched, 'current', 'proposed');
      pendingPatches.push({ path: filePath, original, content: patched, diff });
      return `Patch applied in memory for ${filePath} (${pendingPatches.length} total pending). Awaiting user confirmation.`;
    }
  });

  const compileLogTool = new DynamicStructuredTool({
    name: 'get_compile_log',
    description: 'Get the latest LaTeX compile log from the client. Use this to diagnose compilation errors, undefined references, overfull hboxes, and missing packages.',
    schema: z.object({}),
    func: async () => {
      return compileLog || 'No compile log provided.';
    }
  });

  const arxivSearchTool = new DynamicStructuredTool({
    name: 'arxiv_search',
    description: 'Search arXiv for academic papers by keyword. Returns titles, abstracts, authors, and arXiv IDs. Best for preprints and recent CS/physics/math papers.',
    schema: z.object({
      query: z.string().describe('Search query (e.g. "transformer attention mechanism")'),
      maxResults: z.number().optional().describe('Max results to return (1-10, default 5)')
    }),
    func: async ({ query, maxResults }) => {
      const max = Math.min(10, Math.max(1, maxResults || 5));
      const url = `https://export.arxiv.org/api/query?search_query=all:${encodeURIComponent(query)}&start=0&max_results=${max}`;
      const res = await fetch(url, { headers: { 'User-Agent': 'manuscripta/1.0' } });
      if (!res.ok) {
        throw new Error(`arXiv search failed: ${res.status}`);
      }
      const xml = await res.text();
      const parser = new XMLParser({ ignoreAttributes: false });
      const data = parser.parse(xml);
      const entries = Array.isArray(data?.feed?.entry) ? data.feed.entry : data?.feed?.entry ? [data.feed.entry] : [];
      const papers = entries.map((entry) => {
        const authors = Array.isArray(entry.author) ? entry.author : [entry.author].filter(Boolean);
        const authorNames = authors.map((a) => a?.name).filter(Boolean);
        const id = String(entry.id || '');
        const arxivId = id ? id.split('/').pop() : '';
        return {
          title: String(entry.title || '').replace(/\s+/g, ' ').trim(),
          abstract: String(entry.summary || '').replace(/\s+/g, ' ').trim(),
          authors: authorNames,
          url: id,
          arxivId
        };
      });
      return JSON.stringify({ papers });
    }
  });

  const arxivBibtexTool = new DynamicStructuredTool({
    name: 'arxiv_bibtex',
    description: 'Generate a BibTeX entry for an arXiv paper by its ID. Use after arxiv_search to get citation data.',
    schema: z.object({
      arxivId: z.string().describe('arXiv paper ID, e.g. "2301.07041" or "2301.07041v2"')
    }),
    func: async ({ arxivId }) => {
      const id = extractArxivId(arxivId);
      if (!id) throw new Error('Invalid arXiv ID');
      const entry = await fetchArxivEntry(id);
      if (!entry) throw new Error('No arXiv metadata found');
      return buildArxivBibtex(entry);
    }
  });

  const semanticScholarTool = new DynamicStructuredTool({
    name: 'semantic_scholar_search',
    description: 'Search Semantic Scholar for academic papers. Broader coverage than arXiv — includes journal papers, conference proceedings, and non-preprint publications. Use this alongside arxiv_search for comprehensive literature coverage.',
    schema: z.object({
      query: z.string().describe('Search query'),
      limit: z.number().optional().describe('Max results (1-10, default 5)')
    }),
    func: async ({ query, limit }) => {
      const max = Math.min(10, Math.max(1, limit || 5));
      const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${encodeURIComponent(query)}&limit=${max}&fields=title,authors,year,abstract,externalIds,citationCount,url`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'manuscripta/1.0' }
      });
      if (!res.ok) {
        throw new Error(`Semantic Scholar search failed: ${res.status}`);
      }
      const data = await res.json();
      const papers = (data.data || []).map((p) => ({
        title: p.title || '',
        authors: (p.authors || []).map((a) => a.name).filter(Boolean),
        year: p.year,
        abstract: (p.abstract || '').slice(0, 500),
        citationCount: p.citationCount || 0,
        doi: p.externalIds?.DOI || '',
        arxivId: p.externalIds?.ArXiv || '',
        url: p.url || ''
      }));
      return JSON.stringify({ papers });
    }
  });

  const resolved = resolveLLMConfig(llmConfig);
  const provider = resolveProvider(resolved.endpoint);

  if (provider !== 'ollama' && !resolved.apiKey) {
    return { ok: false, reply: 'API key not set', patches: [] };
  }

  const llm = await createLLMInstance(resolved);

  const systemPrompt = AGENT_SYSTEM_PROMPTS[task] || AGENT_SYSTEM_PROMPTS.default;

  const userInput = [
    `Task: ${task || 'polish'}`,
    activePath ? `Active file: ${activePath}` : '',
    prompt ? `User prompt: ${prompt}` : '',
    selection ? `Selection:\n${selection}` : '',
    compileLog ? `Compile log available — use get_compile_log tool to read it.` : ''
  ].filter(Boolean).join('\n\n');

  const tools = [
    readFileTool,
    listFilesTool,
    searchInFileTool,
    proposePatchTool,
    applyPatchTool,
    compileLogTool,
    arxivSearchTool,
    arxivBibtexTool,
    semanticScholarTool
  ];

  const agent = createReactAgent({
    llm,
    tools,
    prompt: systemPrompt,
  });

  let reply = '';
  try {
    const result = await agent.invoke({
      messages: [new HumanMessage(userInput)]
    }, { recursionLimit: 30 });

    const messages = result.messages || [];
    const lastMessage = messages[messages.length - 1];
    const content = lastMessage?.content || '';
    reply = typeof content === 'string' ? content : JSON.stringify(content);
  } catch (err) {
    // On recursion limit or other errors, preserve any patches accumulated so far
    const errMsg = err?.message || String(err);
    if (pendingPatches.length > 0) {
      reply = `Agent stopped (${errMsg}), but ${pendingPatches.length} patch(es) were prepared.`;
    } else {
      return { ok: false, reply: `Agent error: ${errMsg}`, patches: [] };
    }
  }

  return {
    ok: true,
    reply,
    patches: pendingPatches
  };
}
