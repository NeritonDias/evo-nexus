#!/bin/bash
# Agent Activity Tracker Hook
# POSTs a structured event to /api/pixel-office/hook for the WS bus.
# Legacy .claude/agent-status.json writes retired — bus snapshot is now the source of truth.
#
# Env:
#   EVONEXUS_DASHBOARD_URL   default http://127.0.0.1:8080
#   PIXEL_OFFICE_HOOK_TOKEN  shared secret (optional — if set, server enforces)
#
# Fires on hook events: PreToolUse, PostToolUse, Notification, Stop.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
EVENT="$CLAUDE_HOOK_EVENT"
DASHBOARD_URL="${EVONEXUS_DASHBOARD_URL:-http://127.0.0.1:8080}"
HOOK_TOKEN="${PIXEL_OFFICE_HOOK_TOKEN:-}"
SESSION_ID="${CLAUDE_SESSION_ID:-unknown}"
NOW="$(date -u +"%Y-%m-%dT%H:%M:%SZ")"

# Read hook input once — it is stdin JSON
INPUT="$(cat || true)"

# --- Best-effort JSON extraction (portable; no jq dependency) ---
grep_json() {
  local key="$1"
  echo "$INPUT" | grep -o "\"$key\":\"[^\"]*\"" | head -1 | cut -d'"' -f4
}

TOOL="$(grep_json tool_name)"
TOOL_USE_ID="$(grep_json tool_use_id)"
AGENT_TYPE="$(grep_json subagent_type)"
DESCRIPTION="$(grep_json description)"
AGENT_NAME="$(grep_json agent)"
[ -z "$AGENT_NAME" ] && AGENT_NAME="$AGENT_TYPE"
[ -z "$AGENT_NAME" ] && AGENT_NAME="main"

# Legacy agent-status.json writes retired — /api/agents/active now reads from pixel-office bus

# --- Pixel-office event POST ---
post_event() {
  local payload="$1"
  local header=""
  [ -n "$HOOK_TOKEN" ] && header="-H X-Hook-Token:$HOOK_TOKEN"
  # 1s connect, 2s total; silent; discard output. Never block Claude.
  curl -sS -m 2 --connect-timeout 1 $header \
    -H "Content-Type: application/json" \
    -X POST "$DASHBOARD_URL/api/pixel-office/hook" \
    -d "$payload" >/dev/null 2>&1 &
}

esc() { python3 -c "import json,sys; print(json.dumps(sys.argv[1]))" "$1"; }

case "$EVENT" in
  PreToolUse)
    if [ "$TOOL" = "Agent" ]; then
      post_event "{\"type\":\"agent_started\",\"agent\":$(esc "$AGENT_TYPE"),\"session_id\":$(esc "$SESSION_ID"),\"ts\":\"$NOW\"}"
      post_event "{\"type\":\"subagent_started\",\"parent_session_id\":$(esc "$SESSION_ID"),\"parent_tool_id\":$(esc "$TOOL_USE_ID"),\"subagent_type\":$(esc "$AGENT_TYPE"),\"ts\":\"$NOW\"}"
    fi
    post_event "{\"type\":\"tool_started\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"tool\":$(esc "$TOOL"),\"ts\":\"$NOW\"}"
    ;;
  PostToolUse)
    post_event "{\"type\":\"tool_finished\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"tool\":$(esc "$TOOL"),\"ts\":\"$NOW\"}"
    if [ "$TOOL" = "Agent" ]; then
      post_event "{\"type\":\"subagent_finished\",\"parent_session_id\":$(esc "$SESSION_ID"),\"parent_tool_id\":$(esc "$TOOL_USE_ID"),\"ts\":\"$NOW\"}"
    fi
    ;;
  Notification)
    MESSAGE="$(grep_json message)"
    post_event "{\"type\":\"waiting_input\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"message\":$(esc "$MESSAGE"),\"ts\":\"$NOW\"}"
    ;;
  Stop)
    post_event "{\"type\":\"agent_stopped\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"ts\":\"$NOW\"}"
    ;;
esac

exit 0
