#!/usr/bin/env bash
# ============================================================================
# entrypoint.sh — Bootstrap + secrets-to-env wrapper for Docker Swarm.
#
# Responsibilities (in order):
#   1. Convert Docker Secrets (mounted at /run/secrets/*) and *_FILE env vars
#      into plain environment variables so Claude Code CLI, OpenClaude, and
#      the Python layer see them natively.
#   2. On first boot, populate writable volumes from the image's default
#      templates:
#        /workspace/config/.env              <- .env.example
#        /workspace/config/providers.json    <- providers.example.json
#      Other files (workspace.yaml, routines.yaml, CLAUDE.md) are created by
#      the dashboard Setup wizard or by `make setup`.
#   3. Symlink /workspace/.env and /workspace/CLAUDE.md into the writable
#      config volume so the dashboard's env-editor, providers UI, and
#      settings UI can update them in place.
#   4. Exec the actual command.
# ============================================================================
set -euo pipefail

# --- 1. Secrets to env ------------------------------------------------------
for file_var in $(compgen -A variable | grep -E '_FILE$' || true); do
    var="${file_var%_FILE}"
    path_val="${!file_var:-}"
    if [ -n "$path_val" ] && [ -f "$path_val" ]; then
        export "${var}=$(cat "$path_val")"
    fi
done
if [ -d /run/secrets ]; then
    for secret_file in /run/secrets/*; do
        [ -f "$secret_file" ] || continue
        var_name=$(basename "$secret_file" | tr '[:lower:]-' '[:upper:]_')
        if [ -z "${!var_name:-}" ]; then
            export "${var_name}=$(cat "$secret_file")"
        fi
    done
fi

# --- 2. Bootstrap writable volumes -----------------------------------------
CONFIG_DIR=/workspace/config
DEFAULTS_DIR=/workspace/_defaults

mkdir -p "$CONFIG_DIR" \
         /workspace/workspace \
         /workspace/memory \
         /workspace/ADWs/logs \
         /workspace/.claude/agent-memory \
         /workspace/dashboard/data

if [ -d "$DEFAULTS_DIR" ]; then
    # .env from .env.example (first boot only)
    if [ ! -f "$CONFIG_DIR/.env" ]; then
        if [ -f "$DEFAULTS_DIR/.env.example" ]; then
            cp "$DEFAULTS_DIR/.env.example" "$CONFIG_DIR/.env"
        else
            touch "$CONFIG_DIR/.env"
        fi
    fi
    # providers.example.json (needed by providers.py to bootstrap providers.json)
    if [ -f "$DEFAULTS_DIR/config/providers.example.json" ] && \
       [ ! -f "$CONFIG_DIR/providers.example.json" ]; then
        cp "$DEFAULTS_DIR/config/providers.example.json" "$CONFIG_DIR/providers.example.json"
    fi
    # heartbeats example, if present
    if [ -f "$DEFAULTS_DIR/config/heartbeats.example.yaml" ] && \
       [ ! -f "$CONFIG_DIR/heartbeats.example.yaml" ]; then
        cp "$DEFAULTS_DIR/config/heartbeats.example.yaml" "$CONFIG_DIR/heartbeats.example.yaml"
    fi
fi

# --- 3. Symlink volatile files to the writable volume ----------------------
# /workspace/.env is where Claude Code CLI and most libs look.
# /workspace/config/.env is where the dashboard env-editor writes.
ln -sfn "$CONFIG_DIR/.env" /workspace/.env

# CLAUDE.md may not exist on first boot — the Setup wizard creates it.
# Once present, it lives in the config volume too.
if [ ! -L /workspace/CLAUDE.md ] && [ ! -f /workspace/CLAUDE.md ]; then
    ln -sfn "$CONFIG_DIR/CLAUDE.md" /workspace/CLAUDE.md
fi

# --- 4. Hand off to the actual process -------------------------------------
exec "$@"
