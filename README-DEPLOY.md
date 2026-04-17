# EvoNexus on Docker Swarm — Deployment Guide

This guide takes you from a bare Swarm cluster (with Traefik already running)
to a fully working EvoNexus installation in ~20 minutes. It assumes the
adjusted `Dockerfile`, `Dockerfile.dashboard`, `entrypoint.sh`, and
`.github/workflows/docker-publish.yml` from this bundle have been committed
to your fork of `EvolutionAPI/evo-nexus`.

---

## 1. What you'll set up

| Service      | Image                                   | Public? | Volume(s)                                                 |
|--------------|-----------------------------------------|---------|-----------------------------------------------------------|
| `dashboard`  | `USER/evo-nexus-dashboard:TAG`          | Yes (via Traefik) | workspace, dashboard-data, memory, adw-logs, agent-memory |
| `telegram`   | `USER/evo-nexus-runtime:TAG`            | No      | workspace, memory, adw-logs, agent-memory                 |
| `scheduler`  | `USER/evo-nexus-runtime:TAG`            | No      | workspace, memory, adw-logs, agent-memory                 |

All three services are pinned to the node labeled `evo-nexus=true` via a
placement constraint, which keeps all data on a single host — simple and
correct for this workload (SQLite + filesystem-heavy writes).

---

## 2. One-time setup

### 2.1. Fork, apply the Swarm bundle, publish images

1. Fork `EvolutionAPI/evo-nexus` into your GitHub account.
2. Copy the files from this bundle into the root of your fork, replacing the
   originals where they exist:
   ```
   Dockerfile
   Dockerfile.dashboard
   entrypoint.sh
   .github/workflows/docker-publish.yml
   stack.yml
   .env.deploy.example
   README-DEPLOY.md
   ```
3. In GitHub → Settings → Secrets → Actions, add:
   - `DOCKERHUB_USERNAME` — your Docker Hub username
   - `DOCKERHUB_TOKEN`    — a Docker Hub access token (not your password;
     create at Docker Hub → Account Settings → Security → New Access Token,
     scope "Read, Write, Delete")
4. Commit + push:
   ```bash
   git add .
   git commit -m "chore: Swarm-ready Dockerfiles + CI/CD"
   git push origin main
   ```
5. Tag a release to trigger the first publish:
   ```bash
   git tag v0.1.0
   git push origin v0.1.0
   ```
6. Watch GitHub Actions. When it finishes, Docker Hub has:
   - `USER/evo-nexus-dashboard:v0.1.0` + `:latest`
   - `USER/evo-nexus-runtime:v0.1.0`   + `:latest`

### 2.2. Generate config files locally

The wizard (`make setup`) is interactive and generates the files EvoNexus
reads at runtime. Run it **once on your dev machine**, then ship the outputs
to the Swarm as Docker configs.

```bash
git clone https://github.com/YOUR_USER/evo-nexus.git
cd evo-nexus
make setup            # answer the prompts — name, company, TZ, agents…
```

After the wizard finishes you'll have:

| File                     | What it is                                    |
|--------------------------|-----------------------------------------------|
| `config/workspace.yaml`  | Agents + integrations enabled, workspace ID   |
| `config/routines.yaml`   | Cron schedules for every routine              |
| `CLAUDE.md`              | Top-level Claude Code context (generated from `CLAUDE.template.md`) |

Also edit the local `.env` now so you know which secrets you'll need in
the Swarm — but **don't** ship `.env` to the server. Swarm secrets replace
that file.

### 2.3. Label the target node

Pick the node that will host EvoNexus and label it. From any manager:

```bash
docker node ls
docker node update --label-add evo-nexus=true <NODE_NAME>
# verify
docker node inspect <NODE_NAME> --format '{{ .Spec.Labels }}'
```

### 2.4. Create Swarm secrets

Run on a manager node. Repeat for every secret your workspace uses. The
minimum trio for the default stack is below; add more as your `.env` grows.

```bash
# Anthropic (REQUIRED)
printf "sk-ant-XXXXXXXXXXXXXXXXX" | docker secret create anthropic_api_key -

# Telegram bot (required if the telegram service is enabled)
printf "1234567890:AA..." | docker secret create telegram_bot_token -

# Flask session secret (use any strong random value)
openssl rand -hex 32 | docker secret create evonexus_secret_key -
```

Add any others your deployment needs — `discord_bot_token`,
`stripe_secret_key`, `omie_app_key`, `bling_client_secret`, etc. The
`entrypoint.sh` wrapper will auto-expose them as uppercase env vars at
container start.

> **Reminder**: to expose a new secret to a service, you also have to add
> it to the `secrets:` list of that service in `stack.yml`.

### 2.5. Upload configs to the Swarm

From the folder where you ran `make setup`:

```bash
docker config create evo_workspace_yaml config/workspace.yaml
docker config create evo_routines_yaml  config/routines.yaml
docker config create evo_claude_md      CLAUDE.md
```

Verify:
```bash
docker config ls
```

### 2.6. Confirm the Traefik network exists

```bash
docker network ls | grep traefik_public
```

If the name differs on your setup, edit `stack.yml` and `.env.deploy` to
match.

---

## 3. Deploy

### Option A — Portainer UI (recommended)

1. Portainer → Stacks → Add stack → name it `evonexus`.
2. Web editor: paste the contents of `stack.yml`.
3. Environment variables section: paste the KEY=VALUE pairs from
   `.env.deploy` (don't use the `--env-file` upload, it trims quotes).
4. Deploy the stack.
5. Watch the "Services" page — three services should reach `1/1` replicas
   within ~60 seconds. First pull may take longer.

### Option B — CLI

```bash
# From a machine with docker context pointed at a manager:
cp .env.deploy.example .env.deploy
# fill in DOCKERHUB_USERNAME, EVO_NEXUS_TAG, EVO_NEXUS_HOST, TRAEFIK_CERTRESOLVER

set -a; . ./.env.deploy; set +a
docker stack deploy -c stack.yml evonexus
```

### 3.1. Verify

```bash
# Services running?
docker service ls | grep evonexus

# Any container in a crash loop?
docker service ps evonexus_dashboard --no-trunc
docker service ps evonexus_telegram  --no-trunc
docker service ps evonexus_scheduler --no-trunc

# Logs
docker service logs -f evonexus_dashboard
docker service logs -f evonexus_telegram
docker service logs -f evonexus_scheduler
```

Open `https://${EVO_NEXUS_HOST}` — you should hit the dashboard setup wizard
on first boot (admin account creation). After that, the full UI.

---

## 4. Day-2 operations

### 4.1. Deploy a new version

Tag and push in your fork:
```bash
git tag v0.2.0 && git push origin v0.2.0
```
When the workflow finishes, update the running services:
```bash
docker service update --image USER/evo-nexus-dashboard:v0.2.0 evonexus_dashboard
docker service update --image USER/evo-nexus-runtime:v0.2.0   evonexus_telegram
docker service update --image USER/evo-nexus-runtime:v0.2.0   evonexus_scheduler
```
Or bump `EVO_NEXUS_TAG` in `.env.deploy` and redeploy the stack — both work.

### 4.2. Rotate a secret

Swarm secrets are immutable. To rotate, create a new one with a versioned
name, point the service at it, then remove the old:

```bash
printf "sk-ant-NEW..." | docker secret create anthropic_api_key_v2 -
docker service update \
  --secret-rm anthropic_api_key \
  --secret-add source=anthropic_api_key_v2,target=anthropic_api_key \
  evonexus_dashboard
# repeat for telegram + scheduler
docker secret rm anthropic_api_key   # only after all services are healthy
```

### 4.3. Update a config (workspace.yaml, routines.yaml, CLAUDE.md)

Same dance — configs are also immutable:
```bash
# Edit your local config/routines.yaml, then:
docker config create evo_routines_yaml_v2 config/routines.yaml

docker service update \
  --config-rm evo_routines_yaml \
  --config-add source=evo_routines_yaml_v2,target=/workspace/config/routines.yaml \
  evonexus_scheduler
```

### 4.4. Run a routine manually (replaces `make morning` / `make triage`)

The `runner` service from the original compose was removed because Swarm
doesn't do on-demand containers. Use a one-shot via `docker run` on the
pinned node instead:

```bash
docker run --rm \
  --network evonexus_evo-internal \
  -v evonexus_evo-workspace:/workspace/workspace \
  -v evonexus_evo-memory:/workspace/memory \
  -v evonexus_evo-adw-logs:/workspace/ADWs/logs \
  -v evonexus_evo-agent-memory:/workspace/.claude/agent-memory \
  -e ANTHROPIC_API_KEY="$(docker secret inspect --format '{{.Spec.Data}}' anthropic_api_key | base64 -d)" \
  USER/evo-nexus-runtime:latest \
  uv run python ADWs/routines/good_morning.py
```

For frequent ad-hoc runs, save that as `./scripts/run-routine.sh`.

### 4.5. Backup

Because everything lives in named volumes on one node, you can back up
straight from the host:

```bash
# on the pinned node
sudo tar czf evonexus-backup-$(date +%F).tar.gz \
  /var/lib/docker/volumes/evonexus_evo-workspace \
  /var/lib/docker/volumes/evonexus_evo-dashboard-data \
  /var/lib/docker/volumes/evonexus_evo-memory \
  /var/lib/docker/volumes/evonexus_evo-adw-logs \
  /var/lib/docker/volumes/evonexus_evo-agent-memory
```

Or use the built-in `make backup` / `make backup-s3` by running the runtime
image as a one-shot (same recipe as 4.4).

---

## 5. Troubleshooting

**`no such image: USER/evo-nexus-...`** — the node is pulling from Docker
Hub but the image is private. Either make the repo public or add
`DOCKERHUB_USERNAME`/`DOCKERHUB_TOKEN` as credentials on the node via
`docker login` and add `with-registry-auth` to the update:
```bash
docker service update --with-registry-auth --image USER/... evonexus_dashboard
```

**Dashboard container restarts with "secret file not found"** — you forgot
to create a secret listed in `stack.yml`, or the service isn't granted
access to it. Check with:
```bash
docker service inspect evonexus_dashboard --format '{{json .Spec.TaskTemplate.ContainerSpec.Secrets}}'
```

**Traefik returns 404** — check `traefik.docker.network` matches your real
network name, the domain in `EVO_NEXUS_HOST` resolves to the Traefik node,
and the `websecure` entrypoint is defined in Traefik's static config.

**Claude Code fails with "not authenticated"** — the wrapper didn't load
`ANTHROPIC_API_KEY`. Verify:
```bash
docker exec $(docker ps -q -f name=evonexus_telegram) env | grep ANTHROPIC
```
If empty, the secret isn't mounted. If present but auth still fails, the
key itself is invalid or expired.

**Telegram bot doesn't answer** — tty/stdin are set correctly but the bot
needs an outbound connection to Telegram's API. From a manager:
```bash
docker service logs --tail 100 evonexus_telegram
```

**xterm.js / WebSocket disconnects** — Traefik usually handles WS on the
same router automatically; if your Traefik is old (<2.0) or has custom
middlewares, make sure no middleware strips the `Upgrade` header.

---

## 6. What's intentionally different from the original compose

| Original                            | In Swarm                                  | Why                        |
|-------------------------------------|-------------------------------------------|----------------------------|
| `build:` local                      | `image:` from Docker Hub                  | Swarm doesn't build        |
| `container_name:`                   | omitted                                   | Not supported in Swarm     |
| `profiles: [manual]` runner         | one-shot via `docker run` (see 4.4)       | Swarm has no on-demand     |
| bind mounts (`./config`, `./.env`)  | Docker configs + secrets                  | Paths don't exist cluster-wide |
| `ports: 8080:8080`                  | Traefik labels, no published port         | Traefik is the front door  |
| `make scheduler` on host            | `scheduler` service                       | Now managed by Swarm       |
| `entrypoint: ["claude"]` override   | `command: ["claude", …]`                  | Preserves secrets wrapper  |

---

## 7. Security notes

- The `--dangerously-skip-permissions` flag on the Telegram service mirrors
  the original compose. It lets Claude Code execute tools without per-call
  approval. Acceptable inside a trusted container on your own server; do not
  expose this container to untrusted chat users without further sandboxing.
- Docker secrets are mounted `tmpfs` and never hit disk on the worker node.
  They do land in the Raft log on managers (encrypted at rest if you
  enabled autolock — `docker swarm init --autolock`).
- The dashboard cookie session uses `EVONEXUS_SECRET_KEY`. Rotate it if
  compromised (see 4.2).
