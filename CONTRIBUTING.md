# Contributing to Manuscripta

Thank you for your interest in contributing to Manuscripta! This guide will help you get started.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Development Setup](#development-setup)
- [Project Architecture](#project-architecture)
- [Development Workflow](#development-workflow)
- [Coding Conventions](#coding-conventions)
- [Commit Messages](#commit-messages)
- [Pull Request Process](#pull-request-process)
- [Reporting Issues](#reporting-issues)

## Prerequisites

- **Node.js** >= 18.0.0 (20+ recommended)
- **npm** >= 9.0.0
- **TeX Live** or **Tectonic** (for LaTeX compilation)
- **Git**

Optional (for specific features):
- **Docker** (for containerized deployment)
- **synctex** CLI (for SyncTeX forward/inverse search; included with TeX Live)
- An OpenAI-compatible LLM API endpoint (for AI features)

## Development Setup

```bash
# Clone the repository
git clone https://github.com/Tamoghna12/manuscripta.git
cd manuscripta

# Install dependencies
npm install --legacy-peer-deps

# Copy environment config
cp .env.example .env
# Edit .env with your API keys and preferences

# Start development servers (backend + frontend concurrently)
npm run dev
```

The backend runs on `http://localhost:3000` and the frontend dev server on `http://localhost:5173` (with proxy to backend).

### Useful commands

| Command | Description |
|---------|-------------|
| `npm run dev` | Start both backend and frontend in dev mode |
| `npm run dev:backend` | Start only the backend |
| `npm run dev:frontend` | Start only the frontend (Vite) |
| `npm run build` | Build the frontend for production |
| `npm test` | Run all tests (backend + frontend) |
| `npm run test:backend` | Run backend tests only |
| `npm run test:frontend` | Run frontend tests only |
| `npm run lint` | Run ESLint on all source files |
| `npm run lint:fix` | Run ESLint with auto-fix |
| `npm run format` | Format code with Prettier |
| `npm run format:check` | Check formatting without writing |

## Project Architecture

Manuscripta is an **npm workspaces monorepo** with the following structure:

```
manuscripta/
├── apps/
│   ├── backend/          # Fastify server (Node.js, ESM)
│   │   └── src/
│   │       ├── config/   # Constants, environment variables
│   │       ├── i18n/     # Backend internationalization
│   │       ├── routes/   # HTTP route handlers (REST API)
│   │       ├── services/ # Business logic (compile, LLM, collab, etc.)
│   │       └── utils/    # Shared utilities (fs, path, zip, auth)
│   └── frontend/         # React 18 + Vite + TypeScript
│       └── src/
│           ├── api/      # API client (fetch wrappers)
│           ├── app/      # Page components (Landing, Project, Editor)
│           ├── collab/   # Yjs collaboration provider
│           ├── components/ # Reusable UI components
│           │   └── editor/ # CodeMirror 6 extensions
│           ├── i18n/     # Frontend i18n (react-i18next)
│           ├── latex/    # LaTeX language support for CodeMirror
│           └── utils/    # Pure utility functions
├── packages/             # Shared packages (currently empty)
├── templates/            # LaTeX templates (ACL, CVPR, NeurIPS, etc.)
├── Dockerfile            # Multi-stage production build
├── docker-compose.yml    # Docker Compose config
└── eslint.config.js      # ESLint 9 flat config (shared)
```

### Key technology choices

| Layer | Technology |
|-------|-----------|
| Backend framework | Fastify 5 |
| Frontend framework | React 18 |
| Editor | CodeMirror 6 |
| PDF rendering | PDF.js |
| Collaboration | Yjs (CRDT) + WebSocket |
| AI/LLM | LangChain.js (OpenAI-compatible) |
| Build tool | Vite |
| Testing | Vitest |
| Linting | ESLint 9 + Prettier |

### Backend conventions

- All source files use **ES modules** (`import`/`export`, `.js` extension)
- Routes are registered in `src/index.js` via `register*Routes(fastify)` functions
- Each route file imports from a corresponding service file
- Authentication is handled by the `preHandler` hook in `src/index.js`

### Frontend conventions

- **TypeScript** for all frontend source files
- Components use **function components** with hooks
- Styles are in `App.css` (single stylesheet with CSS custom properties for theming)
- i18n keys use Chinese as the default key with English translations in `en-US.json`

## Development Workflow

1. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```

2. **Make your changes** following the coding conventions below.

3. **Run tests and lint** before committing:
   ```bash
   npm test
   npm run lint
   npm run format:check
   ```

4. **Commit** with a descriptive message (see [Commit Messages](#commit-messages)).

5. **Push** and open a Pull Request.

## Coding Conventions

- **ESLint** and **Prettier** are configured at the project root. Run `npm run lint:fix && npm run format` before committing.
- Prefer small, focused functions over large monolithic ones.
- Keep backend route handlers thin; put business logic in service files.
- Use CSS custom properties (`var(--accent)`, etc.) for all colors and theming.
- Add i18n keys for all user-facing strings. The Chinese key is the source of truth; add English translations in `apps/frontend/src/i18n/locales/en-US.json`.
- Write tests for new utility functions and service logic. Place test files adjacent to source files with a `.test.js` or `.test.ts` suffix.

## Commit Messages

Follow this format:

```
<type>: <short summary>

<optional body with more detail>
```

**Types:** `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `style`, `perf`

Examples:
- `feat: add SyncTeX forward/inverse search`
- `fix: handle missing .aux file in biber detection`
- `docs: update README with Docker instructions`

## Pull Request Process

1. Ensure your branch is up to date with `main`.
2. All CI checks (lint, test, build) must pass.
3. Provide a clear description of **what** changed and **why**.
4. Link related issues (e.g., `Closes #42`).
5. Keep PRs focused — one feature or fix per PR.
6. Be responsive to review feedback.

## Reporting Issues

When reporting a bug, please include:

- **Steps to reproduce** the issue
- **Expected behavior** vs. **actual behavior**
- **Environment**: OS, Node.js version, browser, TeX distribution
- **Relevant logs** or screenshots

For feature requests, describe the use case and how it benefits academic writing workflows.

---

Thank you for helping make Manuscripta better!
