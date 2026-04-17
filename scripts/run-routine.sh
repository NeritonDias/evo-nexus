#!/usr/bin/env bash
# ============================================================================
# scripts/run-routine.sh
#
# Swarm replacement for `make morning` / `make triage` / `docker compose run
# runner ADWs/routines/<n>.py`. Runs a routine as a one-shot container on
# the node where EvoNexus is pinned, sharing the same volumes as the stack.
#
# Usage:
#   ./scripts/run-routine.sh morning
#   ./scripts/run-routine.sh ADWs/routines/triage.py
#   STACK=evonexus IMAGE=user/evo-nexus-runtime:v0.2.0 ./scripts/run-routine.sh eod
#
# Env:
#   STACK       stack name (default: evonexus)
#   IMAGE       runtime image:tag to use (default: reads from deployed scheduler)
#   CLI_ARGS    extra args appended after the python script
# ============================================================================
set -euo pipefail

STACK="${STACK:-evonexus}"
ROUTINE="${1:-}"

if [ -z "$ROUTINE" ]; then
    cat <<USAGE >&2
Usage: $(basename "$0") <routine>
  where <routine> is either a short name (morning, triage, community, eod,
  fin-pulse, weekly, memory-lint) or a path (ADWs/routines/foo.py).

Examples:
  $(basename "$0") morning
  $(basename "$0") ADWs/routines/custom/my_routine.py
USAGE
    exit 1
fi

# Map short names to paths
case "$ROUTINE" in
    morning)      ROUTINE_PATH="ADWs/routines/good_morning.py" ;;
    triage)       ROUTINE_PATH="ADWs/routines/email_triage.py" ;;
    community)    ROUTINE_PATH="ADWs/routines/community_pulse.py" ;;
    eod)          ROUTINE_PATH="ADWs/routines/eod_consolidation.py" ;;
    fin-pulse)    ROUTINE_PATH="ADWs/routines/financial_pulse.py" ;;
    weekly)       ROUTINE_PATH="ADWs/routines/weekly_review.py" ;;
    memory-lint)  ROUTINE_PATH="ADWs/routines/memory_lint.py" ;;
    *)            ROUTINE_PATH="$ROUTINE" ;;
esac

# Discover the image from the deployed scheduler service, unless IMAGE is set
if [ -z "${IMAGE:-}" ]; then
    IMAGE=$(docker service inspect "${STACK}_scheduler" \
        --format '{{.Spec.TaskTemplate.ContainerSpec.Image}}' 2>/dev/null | \
        sed 's|@sha256:.*||')
    if [ -z "$IMAGE" ]; then
        echo "ERROR: couldn't auto-detect image. Set IMAGE=... or verify STACK=$STACK is deployed." >&2
        exit 2
    fi
fi

# Pull the Anthropic key out of its Swarm secret so the one-shot can auth.
ANTHROPIC_KEY=$(docker secret inspect anthropic_api_key \
    --format '{{.Spec.Data}}' 2>/dev/null | base64 -d || true)
if [ -z "$ANTHROPIC_KEY" ]; then
    echo "ERROR: Swarm secret 'anthropic_api_key' not found or empty." >&2
    exit 3
fi

# Split CLI_ARGS into an array so multi-arg values expand correctly
read -ra CLI_ARGS_ARR <<< "${CLI_ARGS:-}"

echo "→ running $ROUTINE_PATH via $IMAGE (stack=$STACK)"

exec docker run --rm \
    --network "${STACK}_evo-internal" \
    -v "${STACK}_evo-config:/workspace/config" \
    -v "${STACK}_evo-workspace:/workspace/workspace" \
    -v "${STACK}_evo-memory:/workspace/memory" \
    -v "${STACK}_evo-adw-logs:/workspace/ADWs/logs" \
    -v "${STACK}_evo-agent-memory:/workspace/.claude/agent-memory" \
    -v "${STACK}_evo-codex-auth:/root/.codex" \
    -e "ANTHROPIC_API_KEY=${ANTHROPIC_KEY}" \
    -e "TZ=America/Sao_Paulo" \
    "$IMAGE" \
    uv run python "$ROUTINE_PATH" "${CLI_ARGS_ARR[@]}"
