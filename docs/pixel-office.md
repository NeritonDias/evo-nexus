# Pixel Office

Visual dashboard at `/office` showing every active `.claude/agents/*.md`
agent as an animated pixel-art character.

## How it works

1. Hook script `.claude/hooks/agent-tracker.sh` fires on every Claude Code
   `PreToolUse`, `PostToolUse`, `Notification`, `Stop`.
2. The hook POSTs a structured event to `/api/pixel-office/hook`.
3. The event bus broadcasts to every open `/ws/pixel-office` WebSocket.
4. The browser canvas consumes events and drives character animations.

## Setup

- Ensure `.claude/settings.json` enables the 4 hook events (already wired).
- Optional: set `PIXEL_OFFICE_HOOK_TOKEN=<random>` in `.env` to require a
  shared secret on the hook endpoint. The hook script reads the same var.
- Start the dashboard: `bash dashboard/start-dashboard.sh`.
- Navigate to `/office`.

## Known limitations (v1)

- Hardcoded office layout (no in-browser editor).
- No seat persistence — refreshing re-spawns characters in free seats.
- Only one dashboard instance per machine; a shared bus for multi-replica
  deployments is out of scope for v1.
- Hook latency is typically <200 ms on loopback but depends on `curl` warm-up.
