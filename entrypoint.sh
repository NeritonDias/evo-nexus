#!/usr/bin/env bash
# ============================================================================
# entrypoint.sh — Secrets-to-env wrapper for Docker Swarm deployments.
#
# Claude Code CLI and most Python libs expect secrets as plain environment
# variables (ANTHROPIC_API_KEY, TELEGRAM_BOT_TOKEN, ...) and do not support
# the _FILE pattern natively. In Docker Swarm, secrets are mounted as files
# under /run/secrets/<secret_name>. This wrapper bridges the two worlds:
#
#   1. Honors explicit FOO_FILE=/path variables (reads the file, exports FOO).
#   2. Auto-discovers every file in /run/secrets/* and exports it as an env
#      var with the uppercase basename (e.g. /run/secrets/anthropic_api_key
#      becomes $ANTHROPIC_API_KEY).
#
# After loading secrets, it execs whatever command was passed to the container.
# ============================================================================
set -euo pipefail

# 1. Explicit *_FILE variables (takes precedence, keeps manual overrides intact)
for file_var in $(compgen -A variable | grep -E '_FILE$' || true); do
    var="${file_var%_FILE}"
    path_val="${!file_var:-}"
    if [ -n "$path_val" ] && [ -f "$path_val" ]; then
        export "${var}=$(cat "$path_val")"
    fi
done

# 2. Auto-discovery of /run/secrets/* (convenience, zero config)
if [ -d /run/secrets ]; then
    for secret_file in /run/secrets/*; do
        [ -f "$secret_file" ] || continue
        secret_name=$(basename "$secret_file")
        # Convert lowercase/kebab to uppercase/snake for env var convention
        var_name=$(echo "$secret_name" | tr '[:lower:]-' '[:upper:]_')
        # Only export if not already set (explicit env/FILE takes precedence)
        if [ -z "${!var_name:-}" ]; then
            export "${var_name}=$(cat "$secret_file")"
        fi
    done
fi

# 3. Ensure writable runtime dirs exist (volumes may be mounted empty)
mkdir -p /workspace/workspace \
         /workspace/memory \
         /workspace/ADWs/logs \
         /workspace/.claude/agent-memory \
         /workspace/dashboard/data 2>/dev/null || true

# 4. Hand off to the actual process
exec "$@"
