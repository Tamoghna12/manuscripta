export interface ProjectMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  tags: string[];
  archived: boolean;
  trashed: boolean;
  trashedAt: string | null;
}

export interface FileItem {
  path: string;
  type: 'file' | 'dir';
}

export interface FileOrderMap {
  [folder: string]: string[];
}

export interface LLMConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface GrammarIssue {
  line?: number;
  original: string;
  replacement: string;
  category: 'grammar' | 'spelling' | 'style' | 'punctuation' | 'vocabulary' | 'structure';
  severity: 'error' | 'warning' | 'suggestion';
  explanation: string;
}

export interface TemplateMeta {
  id: string;
  label: string;
  mainFile: string;
  category: string;
  description: string;
  descriptionEn: string;
  tags: string[];
  author: string;
  featured: boolean;
}

export interface TemplateCategory {
  id: string;
  label: string;
  labelEn: string;
}

export interface ArxivPaper {
  title: string;
  abstract: string;
  authors: string[];
  url: string;
  arxivId: string;
}

const API_BASE = '';
const LANG_KEY = 'manuscripta-lang';
const COLLAB_TOKEN_KEY = 'manuscripta-collab-token';
const COLLAB_SERVER_KEY = 'manuscripta-collab-server';
const AUTH_TOKEN_KEY = 'manuscripta-auth-token';

function getLangHeader() {
  if (typeof window === 'undefined') return 'en-US';
  const stored = window.localStorage.getItem(LANG_KEY);
  return stored === 'zh-CN' ? 'zh-CN' : 'en-US';
}

export function setCollabToken(token: string) {
  if (typeof window === 'undefined') return;
  if (!token) return;
  window.sessionStorage.setItem(COLLAB_TOKEN_KEY, token);
}

export function clearCollabToken() {
  if (typeof window === 'undefined') return;
  window.sessionStorage.removeItem(COLLAB_TOKEN_KEY);
}

export function getCollabToken() {
  if (typeof window === 'undefined') return '';
  return window.sessionStorage.getItem(COLLAB_TOKEN_KEY) || '';
}

export function setCollabServer(server: string) {
  if (typeof window === 'undefined') return;
  if (!server) return;
  window.localStorage.setItem(COLLAB_SERVER_KEY, server);
}

export function getCollabServer() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(COLLAB_SERVER_KEY) || '';
}

// ─── Auth Token Management ───

export function setAuthToken(token: string) {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(AUTH_TOKEN_KEY, token);
}

export function getAuthToken() {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem(AUTH_TOKEN_KEY) || '';
}

export function clearAuthToken() {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(AUTH_TOKEN_KEY);
}

function getAuthHeader(): Record<string, string> {
  // Prefer auth session token, fall back to collab token
  const authToken = getAuthToken();
  if (authToken) return { Authorization: `Bearer ${authToken}` };
  const token = getCollabToken();
  if (!token) return {};
  return { Authorization: `Bearer ${token}` };
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const lang = getLangHeader();
  const mergedHeaders: Record<string, string> = {
    'x-lang': lang,
    ...getAuthHeader(),
    ...(options?.headers as Record<string, string> || {})
  };
  if (options?.body) {
    mergedHeaders['Content-Type'] = 'application/json';
  }
  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers: mergedHeaders
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<T>;
}

export function listProjects() {
  return request<{ projects: ProjectMeta[] }>('/api/projects');
}

export function createProject(payload: { name: string; template?: string }) {
  return request<ProjectMeta>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function renameProject(id: string, name: string) {
  return request<{ ok: boolean; project?: ProjectMeta; error?: string }>(`/api/projects/${id}/rename-project`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export function copyProject(id: string, name?: string) {
  return request<{ ok: boolean; project?: ProjectMeta; error?: string }>(`/api/projects/${id}/copy`, {
    method: 'POST',
    body: JSON.stringify({ name })
  });
}

export function deleteProject(id: string) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${id}`, {
    method: 'DELETE'
  });
}

export function permanentDeleteProject(id: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/permanent`, {
    method: 'DELETE'
  });
}

export function updateProjectTags(id: string, tags: string[]) {
  return request<{ ok: boolean; project?: ProjectMeta }>(`/api/projects/${id}/tags`, {
    method: 'PATCH',
    body: JSON.stringify({ tags })
  });
}

export function archiveProject(id: string, archived: boolean) {
  return request<{ ok: boolean; project?: ProjectMeta }>(`/api/projects/${id}/archive`, {
    method: 'PATCH',
    body: JSON.stringify({ archived })
  });
}

export function trashProject(id: string, trashed: boolean) {
  return request<{ ok: boolean; project?: ProjectMeta }>(`/api/projects/${id}/trash`, {
    method: 'PATCH',
    body: JSON.stringify({ trashed })
  });
}

export function getProjectTree(id: string) {
  return request<{ items: FileItem[]; fileOrder?: FileOrderMap }>(`/api/projects/${id}/tree`);
}

export function getFile(id: string, filePath: string) {
  const qs = new URLSearchParams({ path: filePath }).toString();
  return request<{ content: string }>(`/api/projects/${id}/file?${qs}`);
}

export function writeFile(id: string, filePath: string, content: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/file`, {
    method: 'PUT',
    body: JSON.stringify({ path: filePath, content })
  });
}

export function getAllFiles(id: string) {
  return request<{ files: { path: string; content: string; encoding?: 'utf8' | 'base64' }[] }>(
    `/api/projects/${id}/files`
  );
}

export function createFolder(id: string, folderPath: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/folder`, {
    method: 'POST',
    body: JSON.stringify({ path: folderPath })
  });
}

export function renamePath(id: string, from: string, to: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/rename`, {
    method: 'POST',
    body: JSON.stringify({ from, to })
  });
}

export async function deleteFile(id: string, filePath: string) {
  const qs = new URLSearchParams({ path: filePath }).toString();
  const res = await fetch(`/api/projects/${id}/file?${qs}`, {
    method: 'DELETE',
    headers: {
      'x-lang': getLangHeader(),
      ...getAuthHeader()
    }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ ok: boolean; error?: string }>;
}

export function updateFileOrder(id: string, folder: string, order: string[]) {
  return request<{ ok: boolean }>(`/api/projects/${id}/file-order`, {
    method: 'POST',
    body: JSON.stringify({ folder, order })
  });
}

export async function uploadFiles(projectId: string, files: File[], basePath?: string) {
  const form = new FormData();
  files.forEach((file) => {
    const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name;
    const finalPath = basePath ? `${basePath}/${rel}` : rel;
    // Send intended path as a field before each file — busboy strips directory
    // components from the filename header, so we transmit the path separately.
    form.append('path', finalPath);
    form.append('files', file, file.name);
  });
  const res = await fetch(`/api/projects/${projectId}/upload`, {
    method: 'POST',
    body: form,
    headers: {
      'x-lang': getLangHeader(),
      ...getAuthHeader()
    }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ ok: boolean; files?: string[] }>;
}

export function createCollabInvite(id: string) {
  return request<{ ok: boolean; token: string }>(`/api/projects/${id}/collab/invite`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export function resolveCollabToken(token: string) {
  const qs = new URLSearchParams({ token }).toString();
  return request<{ ok: boolean; projectId: string; projectName: string; role: string }>(`/api/collab/resolve?${qs}`);
}

export function flushCollabFile(id: string, filePath: string) {
  return request<{ ok: boolean }>(`/api/projects/${id}/collab/flush`, {
    method: 'POST',
    body: JSON.stringify({ path: filePath })
  });
}

export function getCollabStatus(id: string, filePath: string) {
  const qs = new URLSearchParams({ path: filePath }).toString();
  return request<{ ok: boolean; diagnostics: { conns: number; lastError: string | null } | null }>(
    `/api/projects/${id}/collab/status?${qs}`
  );
}

export function runAgent(payload: {
  task: string;
  prompt: string;
  selection: string;
  content: string;
  mode: 'direct' | 'tools';
  projectId?: string;
  activePath?: string;
  compileLog?: string;
  llmConfig?: Partial<LLMConfig>;
  interaction?: 'chat' | 'agent';
  history?: { role: 'user' | 'assistant'; content: string }[];
}) {
  return request<{ ok: boolean; reply: string; suggestion: string; patches?: { path: string; diff: string; content: string; original?: string }[] }>(`/api/agent/run`, {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function compileProject(payload: {
  projectId: string;
  mainFile: string;
  engine: 'pdflatex' | 'xelatex' | 'lualatex' | 'latexmk' | 'tectonic';
}) {
  return request<{ ok: boolean; pdf?: string; log?: string; status?: number; engine?: string; error?: string; hasSynctex?: boolean }>(
    `/api/compile`,
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
}

export function compileProjectSSE(
  payload: { projectId: string; mainFile: string; engine: string },
  onLog?: (text: string) => void,
): Promise<{ ok: boolean; pdf?: string; log?: string; status?: number; engine?: string; error?: string; hasSynctex?: boolean }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({
      projectId: payload.projectId,
      mainFile: payload.mainFile,
      engine: payload.engine,
    });
    const token = getAuthToken() || getCollabToken();
    if (token) params.set('token', token);
    const es = new EventSource(`/api/compile/stream?${params.toString()}`);

    es.addEventListener('log', (e) => {
      if (onLog) {
        try {
          const d = JSON.parse(e.data);
          onLog(d.text || '');
        } catch {}
      }
    });
    es.addEventListener('done', (e) => {
      es.close();
      try {
        resolve(JSON.parse(e.data));
      } catch {
        resolve({ ok: false, error: 'Failed to parse compile result.' });
      }
    });
    es.onerror = () => {
      es.close();
      reject(new Error('Compile SSE connection failed'));
    };
  });
}

export function synctexForward(payload: { projectId: string; file: string; line: number }) {
  return request<{ ok: boolean; results?: { page: number; x: number; y: number; w: number; h: number }[]; error?: string }>(
    `/api/synctex/forward`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export function synctexInverse(payload: { projectId: string; page: number; x: number; y: number }) {
  return request<{ ok: boolean; results?: { file: string; line: number; column: number }[]; error?: string }>(
    `/api/synctex/inverse`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function exportProjectZip(projectId: string) {
  const res = await fetch(`${API_BASE}/api/projects/${projectId}/export-zip`, {
    headers: { ...getAuthHeader() },
  });
  if (!res.ok) throw new Error('Export failed');
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = disposition.match(/filename="(.+?)"/);
  const filename = match ? match[1] : `${projectId}.zip`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function listTemplates() {
  return request<{ templates: TemplateMeta[]; categories?: TemplateCategory[] }>('/api/templates');
}

export async function uploadTemplate(templateId: string, templateLabel: string, file: File) {
  const form = new FormData();
  form.append('templateId', templateId);
  form.append('templateLabel', templateLabel);
  form.append('file', file);
  const lang = getLangHeader();
  const res = await fetch(`${API_BASE}/api/templates/upload`, {
    method: 'POST',
    headers: { 'x-lang': lang, ...getAuthHeader() },
    body: form,
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ ok: boolean; templateId?: string; error?: string }>;
}

export function arxivSearch(payload: { query: string; maxResults?: number }) {
  return request<{ ok: boolean; papers?: ArxivPaper[]; error?: string }>(
    '/api/arxiv/search',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
}

export function arxivBibtex(payload: { arxivId: string }) {
  return request<{ ok: boolean; bibtex?: string; entry?: ArxivPaper; error?: string }>(
    '/api/arxiv/bibtex',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
}

export function plotFromTable(payload: {
  projectId: string;
  tableLatex: string;
  chartType: string;
  title?: string;
  prompt?: string;
  filename?: string;
  retries?: number;
  llmConfig?: Partial<LLMConfig>;
}) {
  return request<{ ok: boolean; assetPath?: string; error?: string }>(
    '/api/plot/from-table',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    }
  );
}

export function callLLM(payload: {
  messages: { role: 'system' | 'user' | 'assistant'; content: string }[];
  model?: string;
  llmConfig?: Partial<LLMConfig>;
}) {
  return request<{ ok: boolean; content?: string; error?: string }>('/api/llm', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export async function importZip(payload: { file: File; projectName?: string }) {
  const form = new FormData();
  form.append('zip', payload.file);
  if (payload.projectName) {
    form.append('projectName', payload.projectName);
  }
  const res = await fetch('/api/projects/import-zip', {
    method: 'POST',
    body: form,
    headers: {
      'x-lang': getLangHeader(),
      ...getAuthHeader()
    }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ ok: boolean; project?: ProjectMeta; error?: string }>;
}

export function importArxivSSE(
  payload: { arxivIdOrUrl: string; projectName?: string },
  onProgress?: (data: { phase: string; percent: number; received?: number; total?: number }) => void
): Promise<{ ok: boolean; project?: ProjectMeta; error?: string }> {
  return new Promise((resolve, reject) => {
    const params = new URLSearchParams({ arxivIdOrUrl: payload.arxivIdOrUrl });
    if (payload.projectName) params.set('projectName', payload.projectName);
    const token = getAuthToken() || getCollabToken();
    if (token) params.set('token', token);
    const es = new EventSource(`/api/projects/import-arxiv-sse?${params.toString()}`);

    es.addEventListener('progress', (e) => {
      if (onProgress) {
        try { onProgress(JSON.parse(e.data)); } catch {}
      }
    });
    es.addEventListener('done', (e) => {
      es.close();
      try { resolve(JSON.parse(e.data)); } catch { resolve({ ok: true }); }
    });
    es.addEventListener('error', (e) => {
      es.close();
      const me = e as MessageEvent;
      if (me.data) {
        try {
          const d = JSON.parse(me.data);
          resolve({ ok: false, error: d.error || 'Unknown error' });
          return;
        } catch {}
      }
      reject(new Error('SSE connection failed'));
    });
  });
}

export async function visionToLatex(payload: {
  projectId: string;
  file: File;
  mode: string;
  prompt?: string;
  llmConfig?: Partial<LLMConfig>;
}) {
  const form = new FormData();
  form.append('image', payload.file);
  form.append('projectId', payload.projectId);
  form.append('mode', payload.mode);
  if (payload.prompt) {
    form.append('prompt', payload.prompt);
  }
  if (payload.llmConfig) {
    form.append('llmConfig', JSON.stringify(payload.llmConfig));
  }
  const res = await fetch('/api/vision/latex', {
    method: 'POST',
    body: form,
    headers: {
      'x-lang': getLangHeader(),
      ...getAuthHeader()
    }
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ ok: boolean; latex?: string; assetPath?: string; error?: string }>;
}

// ─── Transfer Agent API ───

export interface TransferStartPayload {
  sourceProjectId: string;
  sourceMainFile: string;
  targetTemplateId: string;
  targetMainFile: string;
  engine?: string;
  layoutCheck?: boolean;
  llmConfig?: Partial<LLMConfig>;
}

export interface TransferStepResult {
  status: string;
  progressLog: string[];
  error?: string;
}

export interface PageImage {
  page: number;
  base64: string;
  mime: string;
}

export function transferStart(payload: TransferStartPayload) {
  return request<{ jobId: string }>('/api/transfer/start', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function transferStep(jobId: string) {
  return request<TransferStepResult>('/api/transfer/step', {
    method: 'POST',
    body: JSON.stringify({ jobId }),
  });
}

export function transferSubmitImages(jobId: string, images: PageImage[]) {
  return request<{ ok: boolean }>('/api/transfer/submit-images', {
    method: 'POST',
    body: JSON.stringify({ jobId, images }),
  });
}

export function transferStatus(jobId: string) {
  return request<TransferStepResult>(`/api/transfer/status/${jobId}`);
}

// ─── MinerU Transfer API ───

export interface MineruConfig {
  apiBase?: string;
  token?: string;
  modelVersion?: string;
}

export interface MineruTransferStartPayload {
  sourceProjectId?: string;
  sourceMainFile?: string;
  targetTemplateId: string;
  targetMainFile: string;
  engine?: string;
  layoutCheck?: boolean;
  llmConfig?: Partial<LLMConfig>;
  mineruConfig?: MineruConfig;
}

export function mineruTransferStart(payload: MineruTransferStartPayload) {
  return request<{ jobId: string; newProjectId: string }>(
    '/api/transfer/start-mineru',
    { method: 'POST', body: JSON.stringify(payload) },
  );
}

export async function mineruTransferUploadPdf(jobId: string, pdfFile: File) {
  const form = new FormData();
  form.append('jobId', jobId);
  form.append('pdf', pdfFile);
  const res = await fetch('/api/transfer/upload-pdf', {
    method: 'POST',
    body: form,
    headers: {
      'x-lang': getLangHeader(),
      ...getAuthHeader(),
    },
  });
  if (!res.ok) {
    throw new Error(await res.text());
  }
  return res.json() as Promise<{ ok: boolean; pdfPath?: string }>;
}

// ─── Grammar Check API ───

export function grammarCheck(payload: {
  content: string;
  mode?: 'full' | 'inline';
  llmConfig?: Partial<LLMConfig> & { grammarModel?: string };
}) {
  return request<{ ok: boolean; issues: GrammarIssue[]; error?: string }>('/api/grammar/check', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

export function grammarInline(payload: {
  content: string;
  llmConfig?: Partial<LLMConfig> & { grammarModel?: string };
}) {
  return request<{ ok: boolean; issues: GrammarIssue[]; error?: string }>('/api/grammar/inline', {
    method: 'POST',
    body: JSON.stringify(payload)
  });
}

// ─── Zotero API ───

export function zoteroGetConfig() {
  return request<{ ok: boolean; config: { userId: string; apiKey: string; hasKey: boolean } | null }>('/api/zotero/config');
}

export function zoteroSaveConfig(payload: { userId: string; apiKey: string }) {
  return request<{ ok: boolean; error?: string }>('/api/zotero/config', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function zoteroItems(params: { q?: string; limit?: number; start?: number; collectionKey?: string }) {
  const qs = new URLSearchParams();
  if (params.q) qs.set('q', params.q);
  if (params.limit) qs.set('limit', String(params.limit));
  if (params.start) qs.set('start', String(params.start));
  if (params.collectionKey) qs.set('collectionKey', params.collectionKey);
  return request<{ ok: boolean; items: any[]; totalResults: number; error?: string }>(`/api/zotero/items?${qs}`);
}

export function zoteroCollections() {
  return request<{ ok: boolean; collections: any[]; error?: string }>('/api/zotero/collections');
}

export function zoteroBibtex(payload: { itemKeys: string[] }) {
  return request<{ ok: boolean; bibtex?: string; error?: string }>('/api/zotero/bibtex', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function zoteroLocal(params?: { dbPath?: string }) {
  const qs = new URLSearchParams();
  if (params?.dbPath) qs.set('dbPath', params.dbPath);
  return request<{ ok: boolean; items: any[]; dbPath?: string; error?: string }>(`/api/zotero/local?${qs}`);
}

// ─── Mendeley API ───

export function mendeleyStatus() {
  return request<{ ok: boolean; connected: boolean }>('/api/mendeley/status');
}

export function mendeleyDisconnect() {
  return request<{ ok: boolean }>('/api/mendeley/disconnect', { method: 'POST', body: JSON.stringify({}) });
}

export function mendeleyDocuments(params?: { q?: string; limit?: number; offset?: number }) {
  const qs = new URLSearchParams();
  if (params?.q) qs.set('q', params.q);
  if (params?.limit) qs.set('limit', String(params.limit));
  if (params?.offset) qs.set('offset', String(params.offset));
  return request<{ ok: boolean; items: any[]; error?: string }>(`/api/mendeley/documents?${qs}`);
}

export function mendeleyCatalog(params: { q: string }) {
  const qs = new URLSearchParams({ q: params.q });
  return request<{ ok: boolean; items: any[]; error?: string }>(`/api/mendeley/catalog?${qs}`);
}

export function mendeleyBibtex(payload: { documentIds: string[] }) {
  return request<{ ok: boolean; bibtex?: string; error?: string }>('/api/mendeley/bibtex', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Git API ───

export function gitStatus(projectId: string) {
  return request<{ ok: boolean; initialized?: boolean; changes?: any[]; branches?: string[]; currentBranch?: string; error?: string }>(
    `/api/projects/${projectId}/git/status`
  );
}

export function gitInit(projectId: string) {
  return request<{ ok: boolean; message?: string; error?: string }>(`/api/projects/${projectId}/git/init`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function gitCommit(projectId: string, payload: { message: string; authorName?: string; authorEmail?: string }) {
  return request<{ ok: boolean; sha?: string; error?: string }>(`/api/projects/${projectId}/git/commit`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function gitLog(projectId: string, depth?: number) {
  const qs = depth ? `?depth=${depth}` : '';
  return request<{ ok: boolean; commits?: any[]; error?: string }>(`/api/projects/${projectId}/git/log${qs}`);
}

export function gitDiff(projectId: string, payload: { oid1: string; oid2: string }) {
  return request<{ ok: boolean; diffs?: any[]; error?: string }>(`/api/projects/${projectId}/git/diff`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function gitBranch(projectId: string, payload: { name: string }) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/git/branch`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function gitCheckout(projectId: string, payload: { name: string }) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/git/checkout`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function gitGetRemote(projectId: string) {
  return request<{ ok: boolean; remote: any }>(`/api/projects/${projectId}/git/remote`);
}

export function gitSetRemote(projectId: string, payload: { url: string; username?: string; token?: string; branch?: string }) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/git/remote`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function gitPush(projectId: string) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/git/push`, {
    method: 'POST',
    body: JSON.stringify({}),
  });
}

export function gitPull(projectId: string, payload?: { authorName?: string; authorEmail?: string }) {
  return request<{ ok: boolean; error?: string }>(`/api/projects/${projectId}/git/pull`, {
    method: 'POST',
    body: JSON.stringify(payload || {}),
  });
}

// ─── Auth API ───

export interface AuthUser {
  id: string;
  username: string;
  displayName: string;
  role: string;
}

export function authStatus() {
  return request<{ ok: boolean; authEnabled: boolean; usersExist: boolean; oidcEnabled?: boolean }>('/api/auth/status');
}

export function authRegister(payload: { username: string; password: string; displayName?: string }) {
  return request<{ ok: boolean; user?: AuthUser; token?: string; error?: string }>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function authLogin(payload: { username: string; password: string }) {
  return request<{ ok: boolean; user?: AuthUser; token?: string; error?: string }>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

export function authMe() {
  return request<{ ok: boolean; user?: AuthUser | null; authEnabled?: boolean }>('/api/auth/me');
}

export function authChangePassword(payload: { currentPassword: string; newPassword: string }) {
  return request<{ ok: boolean; error?: string }>('/api/auth/change-password', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// ─── Review / Track Changes API ───

export function getComments(projectId: string, file: string) {
  const qs = new URLSearchParams({ file }).toString();
  return request<{ ok: boolean; comments: any[] }>(`/api/projects/${projectId}/review/comments?${qs}`);
}

export function saveComments(projectId: string, file: string, comments: any[]) {
  return request<{ ok: boolean }>(`/api/projects/${projectId}/review/comments`, {
    method: 'PUT',
    body: JSON.stringify({ file, comments }),
  });
}

export function getTrackedChanges(projectId: string, file: string) {
  const qs = new URLSearchParams({ file }).toString();
  return request<{ ok: boolean; changes: any[] }>(`/api/projects/${projectId}/review/changes?${qs}`);
}

export function saveTrackedChanges(projectId: string, file: string, changes: any[]) {
  return request<{ ok: boolean }>(`/api/projects/${projectId}/review/changes`, {
    method: 'PUT',
    body: JSON.stringify({ file, changes }),
  });
}

// ─── Ollama Model Discovery ───

export async function ollamaListModels(endpoint?: string) {
  const base = (endpoint || 'http://localhost:11434').replace(/\/+$/, '');
  try {
    const res = await fetch(`${base}/api/tags`);
    if (!res.ok) return { ok: false, models: [] as string[] };
    const data = await res.json() as { models?: { name: string }[] };
    const models = (data.models || []).map((m: { name: string }) => m.name);
    return { ok: true, models };
  } catch {
    return { ok: false, models: [] as string[] };
  }
}
