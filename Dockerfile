# ============================================================================
# Dockerfile — EvoNexus runtime image (telegram / scheduler / runner)
#
# Used by any service that needs the Claude Code CLI + Python deps:
#   - telegram    (claude --channels plugin:telegram@...)
#   - scheduler   (uv run python scheduler.py)
#   - runner      (uv run python ADWs/routines/<n>.py, ad-hoc)
#
# Swarm-ready:
#   * Ships both `claude` (Anthropic) and `openclaude` (multi-provider,
#     OpenRouter/OpenAI/Gemini/Codex/Bedrock/Vertex) so the dashboard's
#     /providers page can switch between them at runtime.
#   * /usr/local/bin/entrypoint.sh converts Docker Secrets (mounted at
#     /run/secrets/*) into environment variables, and bootstraps writable
#     config from /workspace/_defaults on first boot.
# ============================================================================
FROM node:22-slim AS base

# ---- System dependencies --------------------------------------------------
RUN apt-get update && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        curl git jq screen ca-certificates \
    && rm -rf /var/lib/apt/lists/*

# ---- uv (Python package manager) ------------------------------------------
RUN curl -LsSf https://astral.sh/uv/install.sh | sh
ENV PATH="/root/.local/bin:${PATH}"

# ---- CLI layer: Claude Code + OpenClaude + Todoist ------------------------
# OpenClaude enables the multi-provider feature exposed by the dashboard's
# /providers page (OpenRouter, OpenAI, Gemini, Codex, Bedrock, Vertex).
RUN npm install -g \
        @anthropic-ai/claude-code \
        @gitlawb/openclaude \
        todoist-ts-cli

# ---- GitHub CLI -----------------------------------------------------------
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# ---- Timezone -------------------------------------------------------------
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime && echo "${TZ}" > /etc/timezone

WORKDIR /workspace

# ---- Python deps (cached layer) -------------------------------------------
COPY pyproject.toml uv.lock ./
RUN uv venv .venv && uv sync

# ---- Application code -----------------------------------------------------
COPY . .

# ---- Stash defaults so volumes can bootstrap on first boot ----------------
# The writable volume at /workspace/config is populated from _defaults/
# by entrypoint.sh if empty. This preserves the "edit everything via UI"
# flow on clean deploys.
RUN mkdir -p /workspace/_defaults/config \
    && cp -a /workspace/config/. /workspace/_defaults/config/ 2>/dev/null || true \
    && cp /workspace/.env.example /workspace/_defaults/.env.example 2>/dev/null || true

# ---- Secrets-to-env + bootstrap wrapper -----------------------------------
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# ---- OCI image metadata ---------------------------------------------------
LABEL org.opencontainers.image.title="evo-nexus-runtime" \
      org.opencontainers.image.description="EvoNexus runtime (Claude Code + OpenClaude + ADWs)" \
      org.opencontainers.image.source="https://github.com/NeritonDias/evo-nexus" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
