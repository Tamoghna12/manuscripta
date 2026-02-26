# Manuscripta API Reference

All endpoints are prefixed with `/api`. Authentication is required for all endpoints except `/api/health`, `/api/collab`, and `/api/mendeley/auth|callback`.

When running in tunnel mode, requests require a Bearer token in the `Authorization` header (obtained from the collaboration invite flow).

---

## Health & Templates

### `GET /api/health`
Server health check.

**Response:** `{ ok: true }`

### `GET /api/templates`
List all available LaTeX templates.

**Response:**
```json
{
  "templates": [{ "id": "acl", "label": "ACL 2024", "category": "NLP", "mainFile": "main.tex" }],
  "categories": [{ "id": "NLP", "label": "NLP" }]
}
```

### `POST /api/templates/upload`
Upload a custom template (multipart).

**Form fields:** `templateId` (string), `templateLabel` (string), `file` (ZIP archive)

**Response:** `{ ok: true, templateId: "custom-id" }`

---

## Projects

### `GET /api/projects`
List all projects.

**Response:**
```json
{
  "projects": [{
    "id": "uuid", "name": "My Paper", "createdAt": "ISO", "updatedAt": "ISO",
    "tags": ["NLP"], "archived": false, "trashed": false, "trashedAt": null
  }]
}
```

### `POST /api/projects`
Create a new project.

**Body:** `{ "name": "My Paper", "template": "acl" }` (both optional)

**Response:** `{ "id": "uuid", "name": "My Paper", "createdAt": "ISO" }`

### `POST /api/projects/import-zip`
Import project from a ZIP archive (multipart).

**Form fields:** `projectName` (string, optional), `file` (ZIP)

**Response:** `{ "ok": true, "project": { "id": "uuid", "name": "..." } }`

### `GET /api/projects/import-arxiv-sse`
Import paper source from arXiv (Server-Sent Events stream).

**Query:** `arxivIdOrUrl` (required), `projectName` (optional)

**SSE events:** `progress` (`{ phase, percent }`), `done` (`{ ok, project }`), `error` (`{ error }`)

### `POST /api/projects/:id/rename-project`
**Body:** `{ "name": "New Name" }`

### `POST /api/projects/:id/copy`
Duplicate project. **Body:** `{ "name": "Copy Name" }` (optional)

### `DELETE /api/projects/:id`
Soft-delete (trash) project.

### `DELETE /api/projects/:id/permanent`
Permanently delete project and all files.

### `PATCH /api/projects/:id/tags`
**Body:** `{ "tags": ["NLP", "CV"] }`

### `PATCH /api/projects/:id/archive`
**Body:** `{ "archived": true }`

### `PATCH /api/projects/:id/trash`
**Body:** `{ "trashed": false }` (restore from trash)

---

## File Operations

### `GET /api/projects/:id/tree`
Get project file tree.

**Response:** `{ "items": [{ "path": "main.tex", "type": "file", "size": 1234 }], "fileOrder": {} }`

### `GET /api/projects/:id/file`
Read a text file. **Query:** `path` (required)

**Response:** `{ "content": "\\documentclass{article}..." }`

### `GET /api/projects/:id/blob`
Download a binary file (image, PDF). **Query:** `path` (required)

**Response:** Raw bytes with appropriate `Content-Type` header.

### `PUT /api/projects/:id/file`
Create or update a text file.

**Body:** `{ "path": "main.tex", "content": "..." }`

### `POST /api/projects/:id/upload`
Upload files (multipart). Multiple files supported.

**Response:** `{ "ok": true, "files": ["fig1.png", "data/table.csv"] }`

### `GET /api/projects/:id/files`
Get all project files with content (text as UTF-8, binary as base64).

### `POST /api/projects/:id/folder`
**Body:** `{ "path": "figures/plots" }`

### `POST /api/projects/:id/rename`
**Body:** `{ "from": "old.tex", "to": "new.tex" }`

### `DELETE /api/projects/:id/file`
**Query:** `path` (required). Works for files and directories.

### `POST /api/projects/:id/file-order`
Save custom file ordering. **Body:** `{ "folder": "", "order": ["main.tex", "refs.bib"] }`

### `GET /api/projects/:id/export-zip`
Download entire project as a ZIP archive.

**Response:** Binary ZIP stream with `Content-Disposition` header.

---

## Compilation & SyncTeX

### `POST /api/compile`
Compile a LaTeX project.

**Body:**
```json
{
  "projectId": "uuid",
  "mainFile": "main.tex",
  "engine": "pdflatex"
}
```

Supported engines: `pdflatex`, `xelatex`, `lualatex`, `latexmk`, `tectonic`

**Response:**
```json
{
  "ok": true,
  "pdf": "<base64-encoded PDF>",
  "log": "compilation log...",
  "status": 0,
  "hasSynctex": true
}
```

### `POST /api/synctex/forward`
Forward search: source file + line number to PDF page position.

**Body:** `{ "projectId": "uuid", "file": "main.tex", "line": 42 }`

**Response:** `{ "ok": true, "results": [{ "page": 1, "x": 72, "y": 500, "w": 200, "h": 12 }] }`

### `POST /api/synctex/inverse`
Inverse search: PDF page position to source file + line.

**Body:** `{ "projectId": "uuid", "page": 1, "x": 72, "y": 500 }`

**Response:** `{ "ok": true, "results": [{ "file": "main.tex", "line": 42, "column": 0 }] }`

---

## AI & LLM

### `POST /api/llm`
Direct LLM call (pass-through to OpenAI-compatible endpoint).

**Body:** `{ "messages": [{ "role": "user", "content": "..." }], "model": "gpt-4", "llmConfig": {} }`

**Response:** `{ "ok": true, "content": "LLM response..." }`

### `POST /api/agent/run`
AI writing assistant agent.

**Body:**
```json
{
  "task": "polish",
  "prompt": "user instruction",
  "selection": "selected text",
  "content": "full document",
  "mode": "direct",
  "projectId": "uuid",
  "activePath": "main.tex",
  "compileLog": "...",
  "llmConfig": { "baseUrl": "...", "apiKey": "...", "model": "..." },
  "interaction": "agent",
  "history": []
}
```

Tasks: `polish`, `rewrite`, `structure`, `translate`, `fix-errors`, `add-references`, `autocomplete`

**Response:** `{ "ok": true, "reply": "explanation", "suggestion": "improved text", "patches": [] }`

---

## Vision (Image to LaTeX)

### `POST /api/vision/latex`
Convert image to LaTeX code (multipart).

**Form fields:** `file` (image), `projectId` (optional), `mode` (`equation`|`table`|`figure`|`algorithm`|`ocr`), `prompt` (optional), `llmConfig` (JSON string)

**Response:** `{ "ok": true, "latex": "\\begin{equation}...", "assetPath": "figures/eq1.png" }`

---

## Plot Generation

### `POST /api/plot/from-table`
Generate chart from LaTeX table.

**Body:**
```json
{
  "projectId": "uuid",
  "tableLatex": "\\begin{tabular}...",
  "chartType": "bar",
  "title": "Results",
  "prompt": "additional instructions",
  "filename": "chart.png",
  "llmConfig": {},
  "retries": 2
}
```

**Response:** `{ "ok": true, "assetPath": "figures/chart.png" }`

---

## Grammar Checking

### `POST /api/grammar/check`
Full document grammar/style check.

**Body:** `{ "content": "LaTeX content...", "llmConfig": {}, "mode": "full" }`

**Response:**
```json
{
  "ok": true,
  "issues": [{
    "line": 5,
    "original": "recieved",
    "replacement": "received",
    "category": "spelling",
    "severity": "error",
    "explanation": "Common misspelling"
  }]
}
```

### `POST /api/grammar/inline`
Quick inline grammar check (for real-time underlines).

**Body:** `{ "content": "paragraph text...", "llmConfig": {} }`

---

## arXiv

### `POST /api/arxiv/search`
**Body:** `{ "query": "transformer attention", "maxResults": 5 }`

**Response:** `{ "ok": true, "papers": [{ "title": "...", "abstract": "...", "authors": [...], "url": "...", "arxivId": "2301.00001" }] }`

### `POST /api/arxiv/bibtex`
**Body:** `{ "arxivId": "2301.00001" }`

**Response:** `{ "ok": true, "bibtex": "@article{...}" }`

---

## Collaboration

### `POST /api/projects/:id/collab/invite`
Generate a collaboration invite token.

**Body:** `{ "role": "editor", "displayName": "Alice", "color": "#e07050" }`

**Response:** `{ "ok": true, "token": "jwt-token", "role": "editor" }`

### `GET /api/collab/resolve`
Validate invite token. **Query:** `token` (required)

**Response:** `{ "ok": true, "projectId": "uuid", "projectName": "My Paper", "role": "editor" }`

### `WebSocket /api/collab`
Real-time collaborative editing via Yjs protocol.

**Query:** `token` (or no auth for local), `projectId`, `file` (required)

### `POST /api/projects/:id/collab/flush`
Force-flush collaborative edits to disk. **Body:** `{ "path": "main.tex" }`

### `GET /api/projects/:id/collab/status`
Get collaboration diagnostics. **Query:** `path`

---

## Template Transfer

### `POST /api/transfer/start`
Start LaTeX-to-LaTeX template migration.

**Body:**
```json
{
  "sourceProjectId": "uuid",
  "sourceMainFile": "main.tex",
  "targetTemplateId": "neurips",
  "targetMainFile": "main.tex",
  "engine": "pdflatex",
  "layoutCheck": true,
  "llmConfig": {}
}
```

**Response:** `{ "jobId": "uuid", "newProjectId": "uuid" }`

### `POST /api/transfer/start-mineru`
Start PDF-to-LaTeX migration via MinerU.

### `POST /api/transfer/step`
Execute next step in transfer pipeline. **Body:** `{ "jobId": "uuid" }`

### `POST /api/transfer/submit-images`
Submit page screenshots for VLM layout checking.

### `GET /api/transfer/status/:jobId`
Poll transfer job status.

### `POST /api/transfer/upload-pdf`
Upload PDF for MinerU-mode transfer (multipart).

---

## Zotero

### `POST /api/zotero/config`
Save Zotero credentials. **Body:** `{ "userId": "123", "apiKey": "..." }`

### `GET /api/zotero/config`
Get saved config (API key masked).

### `GET /api/zotero/items`
Search Zotero library. **Query:** `q`, `limit`, `start`, `collectionKey`

### `GET /api/zotero/collections`
List Zotero collections.

### `POST /api/zotero/bibtex`
Export items as BibTeX. **Body:** `{ "itemKeys": ["ABC123"] }`

### `GET /api/zotero/local`
Read local Zotero SQLite database. **Query:** `dbPath`

---

## Mendeley (OAuth)

### `GET /api/mendeley/auth`
Start OAuth flow (redirects to Mendeley).

### `GET /api/mendeley/callback`
OAuth callback (handles token exchange).

### `GET /api/mendeley/status`
Check connection status.

### `POST /api/mendeley/disconnect`
Revoke Mendeley access.

### `GET /api/mendeley/documents`
Fetch user's library. **Query:** `q`, `limit`, `offset`

### `GET /api/mendeley/catalog`
Search Mendeley catalog. **Query:** `q` (required)

### `POST /api/mendeley/bibtex`
Export as BibTeX. **Body:** `{ "documentIds": ["uuid"] }`

---

## Git

### `GET /api/projects/:id/git/status`
Git status (initialized, changes, branches, current branch).

### `POST /api/projects/:id/git/init`
Initialize git repository.

### `POST /api/projects/:id/git/commit`
**Body:** `{ "message": "Initial commit", "authorName": "Alice", "authorEmail": "alice@example.com" }`

### `GET /api/projects/:id/git/log`
Commit history. **Query:** `depth` (default 20, max 100)

### `POST /api/projects/:id/git/diff`
Diff between commits. **Body:** `{ "oid1": "abc123", "oid2": "def456" }`

### `POST /api/projects/:id/git/branch`
Create branch. **Body:** `{ "name": "feature-x" }`

### `POST /api/projects/:id/git/checkout`
Switch branch. **Body:** `{ "name": "main" }`

### `GET /api/projects/:id/git/remote`
Get remote config.

### `POST /api/projects/:id/git/remote`
Configure remote. **Body:** `{ "url": "https://...", "username": "...", "token": "...", "branch": "main" }`

### `POST /api/projects/:id/git/push`
Push to remote.

### `POST /api/projects/:id/git/pull`
Pull from remote. **Body:** `{ "authorName": "...", "authorEmail": "..." }`

---

## LLM Configuration Object

Many endpoints accept an `llmConfig` object:

```json
{
  "baseUrl": "https://api.openai.com/v1",
  "apiKey": "sk-...",
  "model": "gpt-4o",
  "temperature": 0.7
}
```

This is passed through to the LangChain provider, supporting any OpenAI-compatible API.
