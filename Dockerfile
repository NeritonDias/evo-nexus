# ============================================================================
# Dockerfile — EvoNexus runtime image (telegram / scheduler / runner)
#
# Used by any service that needs the Claude Code CLI + Python deps:
#   - telegram    (claude --channels plugin:telegram@...)
#   - scheduler   (uv run python scheduler.py)
#   - runner      (uv run python ADWs/routines/<name>.py, ad-hoc)
#
# Swarm-ready: ships with /usr/local/bin/entrypoint.sh that converts Docker
# Secrets (mounted at /run/secrets/*) into environment variables expected by
# Claude Code and the Python layer.
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

# ---- Claude Code CLI ------------------------------------------------------
RUN npm install -g @anthropic-ai/claude-code

# ---- GitHub CLI -----------------------------------------------------------
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
        | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg \
    && echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] https://cli.github.com/packages stable main" \
        | tee /etc/apt/sources.list.d/github-cli.list > /dev/null \
    && apt-get update && apt-get install -y --no-install-recommends gh \
    && rm -rf /var/lib/apt/lists/*

# ---- Todoist CLI ----------------------------------------------------------
RUN npm install -g todoist-ts-cli

# ---- Timezone -------------------------------------------------------------
ENV TZ=America/Sao_Paulo
RUN ln -snf /usr/share/zoneinfo/${TZ} /etc/localtime && echo "${TZ}" > /etc/timezone

# ---- Working directory ----------------------------------------------------
WORKDIR /workspace

# ---- Python deps (cached layer) -------------------------------------------
COPY pyproject.toml uv.lock ./
RUN uv venv .venv && uv sync

# ---- Application code (baked in) ------------------------------------------
# Everything under .claude/ (agents, skills, commands, templates) ships with
# the image. Mutable bits (.claude/agent-memory, memory/, workspace/) are
# mounted as named volumes at deploy time.
COPY . .

# ---- Secrets-to-env wrapper -----------------------------------------------
COPY entrypoint.sh /usr/local/bin/entrypoint.sh
RUN chmod +x /usr/local/bin/entrypoint.sh

# ---- OCI image metadata ---------------------------------------------------
LABEL org.opencontainers.image.title="evo-nexus-runtime" \
      org.opencontainers.image.description="EvoNexus runtime (Claude Code CLI + ADWs)" \
      org.opencontainers.image.source="https://github.com/EvolutionAPI/evo-nexus" \
      org.opencontainers.image.licenses="MIT"

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
CMD ["bash"]
