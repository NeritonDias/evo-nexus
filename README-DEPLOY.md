# EvoNexus on Docker Swarm — Deployment Guide

This guide takes a bare Swarm cluster (with Traefik already running) to a
fully working EvoNexus installation. It assumes you've built and published
the images via the included GitHub Actions workflow.

> **Why this exists** — EvoNexus ships a rich UI that already edits `.env`,
> `providers.json`, `workspace.yaml`, and `routines.yaml` in place. This
> deployment preserves that flow: instead of shipping those files as Docker
> Configs (immutable), it puts them on a shared writable volume so every
> change made in the dashboard's Providers / Integrations / Settings pages
> persists across container restarts.

---

## 1. What you'll set up

| Service      | Image                                     | Public?            |
|--------------|-------------------------------------------|--------------------|
| `dashboard`  | `USER/evo-nexus-dashboard:TAG`            | Yes (via Traefik)  |
| `telegram`   | `USER/evo-nexus-runtime:TAG`              | No                 |
| `scheduler`  | `USER/evo-nexus-runtime:TAG`              | No                 |

All three pin to the node labeled `evo-nexus=true` and share the same
`evo-config`, `evo-workspace`, `evo-memory`, `evo-adw-logs`,
`evo-agent-memory`, and `evo-codex-auth` volumes.

---

## 2. One-time setup

### 2.1. Fork and publish the images

1. In your fork, add these GitHub Actions secrets (Settings → Secrets → Actions):
   - `DOCKERHUB_USERNAME` — your Docker Hub username.
   - `DOCKERHUB_TOKEN`    — a Docker Hub access token (scope: Read, Write, Delete).
2. Tag a release to trigger the first build:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
3. Wait for the workflow — Docker Hub will have:
   - `USER/evo-nexus-dashboard:v0.1.0` + `:latest`
   - `USER/evo-nexus-runtime:v0.1.0`   + `:latest`

### 2.2. Label the target node

From any Swarm manager:
```bash
docker node ls
docker node update --label-add evo-nexus=true <NODE_NAME>
docker node inspect <NODE_NAME> --format '{{ .Spec.Labels }}'
```

### 2.3. Create the minimum Swarm secrets

Only two are mandatory to boot. The rest (Telegram, Discord, Stripe, Omie,
etc.) can be entered later through the dashboard's Integrations page.

```bash
# Anthropic key — needed for Claude Code to work at all
printf "sk-ant-XXXXXXXXXXXXXXXXX" | docker secret create anthropic_api_key -

# Flask session secret — any strong random string
openssl rand -hex 32 | docker secret create evonexus_secret_key -
```

Optional extras (add them to the corresponding service's `secrets:` list in
`stack.yml` if you create them):
```bash
printf "1234567890:AA..." | docker secret create telegram_bot_token -
printf "..."                | docker secret create discord_bot_token -
printf "sk_live_..."        | docker secret create stripe_secret_key -
```

### 2.4. Confirm the Traefik network exists

```bash
docker network ls | grep traefik_public
```
If named differently on your cluster, edit `stack.yml` (two places: under
`networks:` in `dashboard` and at the bottom under `networks:`) and the
`traefik.docker.network` label.

---

## 3. Deploy

### Portainer UI (recommended)

1. Stacks → Add stack → name `evonexus`.
2. Paste `stack.yml` into the web editor.
3. In "Environment variables" add:
   ```
   DOCKERHUB_USERNAME=your-user
   EVO_NEXUS_TAG=v0.1.0
   EVO_NEXUS_HOST=evonexus.your-domain.com.br
   TRAEFIK_CERTRESOLVER=letsencrypt
   ```
4. Deploy the stack. First pull takes a couple of minutes.

### CLI

```bash
cp .env.deploy.example .env.deploy   # then fill in the four variables
set -a; . ./.env.deploy; set +a
docker stack deploy -c stack.yml evonexus
```

### Verify

```bash
docker service ls | grep evonexus
docker service ps evonexus_dashboard --no-trunc
docker service logs -f evonexus_dashboard
```

Open `https://${EVO_NEXUS_HOST}` — on the first visit, the **Setup wizard**
runs inside the dashboard and walks you through:

- Workspace name, company, owner, language, timezone.
- AI provider selection (Anthropic by default; pick OpenRouter / OpenAI /
  Gemini / **Codex Auth** / Bedrock / Vertex if you want OpenClaude).
- Admin account creation.
- Which integrations to enable and their tokens (Telegram, Discord,
  Evolution API, Stripe, Omie, Bling, Asaas, YouTube/Instagram/LinkedIn
  via OAuth, etc.).

Everything you enter lands in the `evo-config` volume and is read by
`telegram` and `scheduler` automatically on their next restart (use
`docker service update --force evonexus_telegram` to pick up new
Telegram credentials immediately, for example).

---

## 4. Day-2 operations

### 4.1. Deploy a new version

Tag, let CI build, then update:
```bash
docker service update --image USER/evo-nexus-dashboard:v0.2.0 evonexus_dashboard
docker service update --image USER/evo-nexus-runtime:v0.2.0   evonexus_telegram
docker service update --image USER/evo-nexus-runtime:v0.2.0   evonexus_scheduler
```
Or bump `EVO_NEXUS_TAG` in `.env.deploy` and redeploy the stack.

### 4.2. Rotate a secret

Docker secrets are immutable — rotate by creating a versioned name:

```bash
printf "sk-ant-NEW..." | docker secret create anthropic_api_key_v2 -
docker service update \
  --secret-rm anthropic_api_key \
  --secret-add source=anthropic_api_key_v2,target=anthropic_api_key \
  evonexus_dashboard
# repeat for telegram + scheduler, then:
docker secret rm anthropic_api_key
```

### 4.3. Switch AI provider (Anthropic ↔ OpenClaude)

No downtime, no restart — just use the dashboard:

1. Open the sidebar → **System → Providers**.
2. Pick the provider (OpenRouter, OpenAI, Codex Auth, Gemini, Bedrock, Vertex).
3. Enter keys (or go through OAuth for Codex).
4. **Save & Activate**.

The `providers.json` file in the `evo-config` volume is updated. The
terminal-server and `ADWs/runner.py` re-read it on every session spawn, so
new sessions use the new binary/env immediately.

### 4.4. Edit tokens for an integration

Dashboard → **Integrations** → pick the card → drawer opens with the env
vars it reads. Edit, Save. The `.env` file in the `evo-config` volume is
updated. For services that cache env at startup (e.g. the telegram bot),
force a restart:
```bash
docker service update --force evonexus_telegram
```

### 4.5. Run a routine manually

The old `runner` profile from docker-compose doesn't exist in Swarm. For
ad-hoc runs, use a one-shot container on the pinned node:

```bash
docker run --rm \
  --network evonexus_evo-internal \
  -v evonexus_evo-config:/workspace/config \
  -v evonexus_evo-workspace:/workspace/workspace \
  -v evonexus_evo-memory:/workspace/memory \
  -v evonexus_evo-adw-logs:/workspace/ADWs/logs \
  -v evonexus_evo-agent-memory:/workspace/.claude/agent-memory \
  -v evonexus_evo-codex-auth:/root/.codex \
  -e ANTHROPIC_API_KEY="$(docker secret inspect --format '{{.Spec.Data}}' anthropic_api_key | base64 -d)" \
  USER/evo-nexus-runtime:latest \
  uv run python ADWs/routines/good_morning.py
```

Save it as `./scripts/run-routine.sh` for repeated use.

### 4.6. Backup

Everything that matters lives in named volumes on one node:

```bash
sudo tar czf evonexus-backup-$(date +%F).tar.gz \
  /var/lib/docker/volumes/evonexus_evo-config \
  /var/lib/docker/volumes/evonexus_evo-workspace \
  /var/lib/docker/volumes/evonexus_evo-dashboard-data \
  /var/lib/docker/volumes/evonexus_evo-memory \
  /var/lib/docker/volumes/evonexus_evo-adw-logs \
  /var/lib/docker/volumes/evonexus_evo-agent-memory \
  /var/lib/docker/volumes/evonexus_evo-codex-auth
```

---

## 5. Troubleshooting

**Image not found** — if you made the Docker Hub repo private, the Swarm
nodes need to login:
```bash
docker login
docker service update --with-registry-auth --image USER/evo-nexus-dashboard:latest evonexus_dashboard
```

**Container restarting with "missing ANTHROPIC_API_KEY"** — the secret
isn't mounted on that service. Check:
```bash
docker service inspect evonexus_dashboard --format '{{json .Spec.TaskTemplate.ContainerSpec.Secrets}}'
```

**Dashboard loads but `/providers` shows "openclaude not in PATH"** — you
deployed an older image that didn't bundle OpenClaude. Pull `latest` or
re-tag:
```bash
docker service update --image USER/evo-nexus-dashboard:latest --force evonexus_dashboard
```

**Traefik returns 404** — confirm `traefik.docker.network=traefik_public`
matches your network name and that the host in `EVO_NEXUS_HOST` resolves
to the Traefik node.

**Tokens edited in the UI don't take effect** — some bots read env only at
startup. Force-restart the affected service:
```bash
docker service update --force evonexus_telegram
```

**Codex OAuth never completes** — check that `/root/.codex` is mounted (it
should be via `evo-codex-auth`). Without that volume, the auth.json is
written inside the container and lost on restart.

---

## 6. What's intentionally different from the original compose

| Original                            | In Swarm                                    | Why                          |
|-------------------------------------|---------------------------------------------|------------------------------|
| `build:` local                      | `image:` from Docker Hub                    | Swarm doesn't build          |
| `container_name:`                   | omitted                                     | Not supported in Swarm       |
| `profiles: [manual]` runner         | one-shot via `docker run` (see 4.5)         | Swarm has no on-demand       |
| Bind mounts `./config`, `./.env`    | Single writable volume `evo-config`         | UI writes to it from every pod |
| `ports: 8080:8080`                  | Traefik labels, no published port           | Traefik is the front door    |
| `make scheduler` on host            | `scheduler` service                         | Now managed by Swarm         |
| Only `claude` CLI installed         | `claude` + `openclaude` installed           | Enables /providers multi-backend |
| `entrypoint: ["claude"]` override   | `command: ["claude", …]`                    | Preserves secrets wrapper    |

---

## 7. Security notes

- The `--dangerously-skip-permissions` flag on the Telegram service mirrors
  the original compose. Claude Code executes tools without per-call
  approval. Fine inside a trusted container on your own server; **do not**
  expose that container's CLI to untrusted chat users.
- Docker secrets are mounted on tmpfs and never written to disk on the
  worker. They do land in the Raft log on managers (encrypted at rest if
  you enabled autolock: `docker swarm init --autolock`).
- `providers.json` is gitignored (it contains API keys). It lives in the
  `evo-config` volume only.
- The dashboard masks secrets in every API response (`first6****last4`).
  The frontend uses `****` as a "no change" sentinel on save.
- The backend enforces an allowlist of binaries (`claude`, `openclaude`)
  and env vars for subprocess spawning — shell metacharacters in
  `providers.json` values are rejected as a defense-in-depth measure.
