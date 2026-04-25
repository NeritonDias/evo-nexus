#!/bin/bash
# Agent Activity Tracker Hook
# (1) Keeps .claude/agent-status.json up-to-date for /api/agents/active.
# (2) POSTs a structured event to /api/pixel-office/hook for the WS bus.
#
# Env:
#   EVONEXUS_DASHBOARD_URL   default http://127.0.0.1:8080
#   PIXEL_OFFICE_HOOK_TOKEN  shared secret (optional — if set, server enforces)
#
# Fires on hook events: PreToolUse, PostToolUse, Notification, Stop.

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel 2>/dev/null || pwd)}"
STATUS_FILE="$PROJECT_DIR/.claude/agent-status.json"
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
AGENT_TYPE="$(grep_json subagent_type)"
DESCRIPTION="$(grep_json description)"
AGENT_NAME="$(grep_json agent)"
[ -z "$AGENT_NAME" ] && AGENT_NAME="$AGENT_TYPE"
[ -z "$AGENT_NAME" ] && AGENT_NAME="main"

# --- Legacy status file maintenance (existing behaviour) ---
if [ ! -f "$STATUS_FILE" ]; then
  echo '{"active_agents":[],"last_updated":""}' > "$STATUS_FILE"
fi
if [ "$EVENT" = "PreToolUse" ] && [ "$TOOL" = "Agent" ]; then
  python3 - <<PY 2>/dev/null
import json
try:
    with open("$STATUS_FILE") as f: data = json.load(f)
except Exception:
    data = {"active_agents": [], "last_updated": ""}
data["active_agents"].append({
    "agent": "$AGENT_TYPE" or "general-purpose",
    "description": "$DESCRIPTION",
    "started_at": "$NOW",
})
data["active_agents"] = data["active_agents"][-20:]
data["last_updated"] = "$NOW"
with open("$STATUS_FILE", "w") as f: json.dump(data, f)
PY
elif [ "$EVENT" = "Stop" ]; then
  echo "{\"active_agents\":[],\"last_updated\":\"$NOW\"}" > "$STATUS_FILE"
fi

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
    fi
    post_event "{\"type\":\"tool_started\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"tool\":$(esc "$TOOL"),\"ts\":\"$NOW\"}"
    ;;
  PostToolUse)
    post_event "{\"type\":\"tool_finished\",\"session_id\":$(esc "$SESSION_ID"),\"agent\":$(esc "$AGENT_NAME"),\"tool\":$(esc "$TOOL"),\"ts\":\"$NOW\"}"
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
