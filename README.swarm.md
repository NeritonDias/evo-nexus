# EvoNexus on Docker Swarm — Deploy Guide

This repo is deployable three ways, and each is independent of the others:

1. **VPS bare-metal** — `git clone` + `make setup` + `install-service.sh`. Uses
   `setup.py` upstream, installs via `uv`, runs as systemd service. **Untouched
   by this Swarm overlay.**
2. **Local dev with Docker Compose** — `docker compose up` using the upstream
   `docker-compose.yml`, `Dockerfile`, `Dockerfile.dashboard`. **Also untouched.**
3. **Production on Docker Swarm with Portainer + Traefik** — this guide. Uses
   `Dockerfile.swarm`, `Dockerfile.swarm.dashboard`, and `evonexus.stack.yml`.
   These are Swarm-specific variants; they do not replace the upstream files.

## Architecture

Three Swarm services:

| Service | Image | Purpose |
|---|---|---|
| `evonexus_dashboard` | `evo-nexus-dashboard` | Flask + React + embedded terminal-server, exposed via Traefik |
| `evonexus_telegram` | `evo-nexus-runtime` | Long-running `claude --channels plugin:telegram...` daemon |
| `evonexus_scheduler` | `evo-nexus-runtime` | Background scheduler for ADW routines (`scheduler.py`) |

Seven named volumes (auto-created by Portainer):

- `evonexus_config` — the UI-editable `.env` and providers config (writable)
- `evonexus_workspace` — agent workspace (daily-logs, projects, finance, etc.)
- `evonexus_dashboard_data` — dashboard SQLite
- `evonexus_memory` — persistent agent memory
- `evonexus_adw_logs` — routine execution logs
- `evonexus_agent_memory` — per-agent scratch memory
- `evonexus_codex_auth` — `~/.codex/auth.json` persisted across restarts

One external network: `gmnet` (shared with the Traefik stack).

## UI-first configuration

The stack intentionally ships **zero API keys and zero integration tokens**.
Everything is configured through the dashboard after the first boot:

- **Providers page** (`/providers`) — Anthropic / OpenAI / Codex OAuth / OpenRouter / Gemini
- **Integrations page** (`/integrations`) — Telegram, Stripe, Omie, Bling, Asaas, Fathom, Todoist, GitHub, Linear, Gmail, Google Calendar, YouTube, Instagram, LinkedIn, Evolution API, Evo CRM...
- **Env editor** — anything else

When you save a value, the dashboard writes it to `/workspace/config/.env` in
the `evonexus_config` volume. Next time the container starts, the entrypoint
sources that `.env` so every process sees the new value as a regular
environment variable.

## Runtime daemon services — what does and doesn't need its own container

| Channel | Needs daemon service? | Notes |
|---|---|---|
| Telegram | ✅ Yes (`evonexus_telegram`) | Already in the stack |
| Discord | Optional | Duplicate the `evonexus_telegram` block, swap `plugin:telegram` → `plugin:discord` |
| iMessage | Optional | Same pattern; needs BlueBubbles server on a Mac |
| WhatsApp (Evolution API/Go) | ❌ No | External HTTP API — your `evolution_api` stack handles it |
| Stripe / Omie / Bling / Asaas / Fathom / Todoist | ❌ No | External REST APIs, called on demand by scheduler/dashboard |
| GitHub / Linear / Gmail / Calendar / YouTube / Instagram / LinkedIn | ❌ No | Same — OAuth via dashboard, REST calls on demand |
| Evo CRM | ❌ No | Cross-stack HTTP call over `gmnet` to your `evocrm_*` services |

## Deploy flow

### Prerequisites

- Docker Swarm initialized on at least one manager node.
- `gmnet` overlay network exists and is attached to your Traefik stack.
- Traefik configured with a `websecure` entrypoint and `letsencryptresolver`.
- DNS pointing `evonexus.<yourdomain>` to the Swarm.
- Packages on ghcr.io set to **Public**, or `docker login ghcr.io` done on
  every Swarm manager node.

### Steps

1. **Let GitHub Actions build the images.** Push a tag `vX.Y.Z-swarm.N` (or
   use the Actions tab to run "Build & Publish Docker Images (Swarm)"
   manually). The workflow builds both images and publishes to
   `ghcr.io/<owner>/evo-nexus-{dashboard,runtime}` with the version tag and
   `:latest`.

2. **Open Portainer → Stacks → Add stack.**
   - Name: `evonexus`
   - Paste `evonexus.stack.yml` contents
   - Edit `Host(\`evonexus.example.com\`)` (two places) to your domain
   - Click **Deploy**

3. **Watch the containers come up.** `evonexus_dashboard` serves the SPA
   immediately. `evonexus_telegram` and `evonexus_scheduler` log
   `waiting for ANTHROPIC_API_KEY` every 30s — this is expected until step 4.

4. **Open `https://evonexus.<yourdomain>`** → Setup wizard → create admin
   user → Providers → pick and save a provider:
   - **Anthropic** — paste `sk-ant-...` (default, easiest).
   - **OpenAI API Key** — paste `sk-...` (create at
     [platform.openai.com/api-keys](https://platform.openai.com/api-keys)
     with "All" permissions, not "Restricted").
   - **Codex OAuth** — click the Login button, complete the ChatGPT device
     flow. The token lands in the `evonexus_codex_auth` volume and persists
     across restarts. OpenClaude 0.3.0+ (installed in the image) reads it
     automatically.

5. **Wait ~30s.** The telegram and scheduler services detect the new key on
   their next polling cycle and start running.

6. **Integrations.** Configure any channels and external APIs through
   `/integrations`. Values are stored in the same config volume and picked
   up at container startup or reload. After changing something that the
   telegram daemon uses, restart that service in Portainer
   (`docker service update --force evonexus_telegram`).

## Troubleshooting

### Terminal says "Could not reach terminal-server"

Confirm the dashboard container logs show both lines on boot:

```
[start-dashboard] terminal-server on :32352, Flask on :8080
🚀 Terminal server running at http://localhost:32352
 * Running on http://127.0.0.1:8080
```

If only Flask is running, the image is likely an old revision — redeploy with
the latest tag. Also check your Traefik router's middleware includes
`evonexus_terminal_strip` (visible in the Traefik dashboard if you have one).

### `401 Missing scopes: api.responses.write` on Codex

This means OpenClaude is hitting `api.openai.com/v1/responses` instead of the
Codex shortcut endpoint. Fixed in OpenClaude 0.3.0+, which the Swarm image
pins via `@gitlawb/openclaude@latest`. If you still see this, you are running
an older image — redeploy with the latest tag.

### telegram/scheduler crash-looping

They should not crash — they wait for `ANTHROPIC_API_KEY` via the entrypoint's
poll loop. If they still exit immediately, the image predates the bootstrap
entrypoint. Redeploy with a current tag.

### Volumes lost after stack redeploy

Portainer preserves named volumes across stack updates by default. If you
removed the stack and redeployed, data in `evonexus_config`,
`evonexus_workspace`, etc. is lost unless you backed them up. Use
`docker volume ls` on the manager to confirm.

## What is NOT changed from upstream

This Swarm overlay is additive. These upstream files are unmodified and
continue to support VPS (`make setup`) and local Compose (`docker compose up`):

- `Dockerfile`, `Dockerfile.dashboard`
- `docker-compose.yml`
- `setup.py`, `install-service.sh`, `Makefile`
- `pyproject.toml`, `uv.lock`
- Every Python, React, and config file in the repo

Swarm-specific files:

- `Dockerfile.swarm`, `Dockerfile.swarm.dashboard`
- `entrypoint.sh`, `start-dashboard.sh`
- `evonexus.stack.yml`
- `.github/workflows/docker-publish.yml`
- `README.swarm.md` (this file)
