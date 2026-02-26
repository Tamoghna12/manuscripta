# Configuration Guide

Manuscripta is configured via environment variables. Copy `.env.example` to `.env` and edit as needed.

```bash
cp .env.example .env
```

## Environment Variables

### Server

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `8787` | HTTP server port |
| `MANUSCRIPTA_DATA_DIR` | `./data` | Directory for project storage. Must be writable. |

### LLM (AI Features)

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_LLM_ENDPOINT` | `https://api.openai.com/v1/chat/completions` | OpenAI-compatible API endpoint |
| `MANUSCRIPTA_LLM_API_KEY` | *(none)* | API key for the LLM endpoint. Can also be set per-user in the UI. |
| `MANUSCRIPTA_LLM_MODEL` | `gpt-4o-mini` | Default model name |

Users can override these in the frontend settings panel. Server-side values serve as defaults.

### Collaboration

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_COLLAB_TOKEN_SECRET` | `manuscripta-collab-dev` | HMAC secret for signing collaboration tokens. **Change this in production.** |
| `MANUSCRIPTA_COLLAB_TOKEN_TTL` | `86400` | Token lifetime in seconds (default: 24 hours) |
| `MANUSCRIPTA_COLLAB_REQUIRE_TOKEN` | `true` | Set to `false` to disable token authentication (local-only use) |
| `MANUSCRIPTA_COLLAB_FLUSH_DEBOUNCE_MS` | `800` | Milliseconds to debounce before flushing Y.js documents to disk |

### Tunnel (Remote Access)

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_TUNNEL` | `false` | Tunnel provider: `localtunnel`, `cloudflared`, `ngrok`, or `false` |

When enabled, the server creates a public URL for remote collaboration. Requires the corresponding CLI tool:
- `localtunnel`: `npm install -g localtunnel` (bundled as dependency)
- `cloudflared`: [Install cloudflared](https://developers.cloudflare.com/cloudflare-one/connections/connect-apps/install-and-setup/)
- `ngrok`: bundled via `@ngrok/ngrok` package

### Python (Plotting)

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_PYTHON` | *(auto-detected)* | Path to Python binary with `matplotlib` installed. Used for chart generation from tables. |

### MinerU (PDF-to-Markdown)

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_MINERU_API_BASE` | `https://mineru.net/api/v4` | MinerU API base URL |
| `MANUSCRIPTA_MINERU_TOKEN` | *(none)* | MinerU API token. Required for PDF-to-LaTeX template transfer (MinerU mode). |

### Mendeley (OAuth 2.0)

| Variable | Default | Description |
|----------|---------|-------------|
| `MANUSCRIPTA_MENDELEY_CLIENT_ID` | *(none)* | OAuth client ID from [Mendeley Developer Portal](https://dev.mendeley.com/myapps.html) |
| `MANUSCRIPTA_MENDELEY_CLIENT_SECRET` | *(none)* | OAuth client secret |
| `MANUSCRIPTA_MENDELEY_REDIRECT_URI` | *(none)* | Callback URL, e.g., `http://localhost:8787/api/mendeley/callback` |

All three must be set to enable the Mendeley integration.

## Docker

When running with Docker, pass environment variables via `docker-compose.yml`:

```yaml
services:
  manuscripta:
    build: .
    ports:
      - "8787:8787"
    volumes:
      - manuscripta-data:/app/data
    env_file:
      - .env
```

Or pass them directly:

```bash
docker run -p 8787:8787 \
  -e MANUSCRIPTA_LLM_API_KEY=sk-... \
  -e MANUSCRIPTA_COLLAB_TOKEN_SECRET=your-secret \
  -v manuscripta-data:/app/data \
  manuscripta
```

## Prerequisites

Beyond environment variables, certain features require external tools:

| Feature | Requirement |
|---------|-------------|
| LaTeX compilation | `pdflatex`, `xelatex`, `lualatex`, or `tectonic` in PATH |
| SyncTeX search | `synctex` CLI (included with TeX Live) |
| Chart generation | Python 3 with `matplotlib` |
| Project export | `zip` CLI |

## Startup Validation

The server checks configuration on startup and prints warnings for:
- Default collab token secret (insecure for production)
- Missing LLM API key (AI features require per-user config)
