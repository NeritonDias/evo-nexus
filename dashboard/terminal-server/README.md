# Terminal Server

Internal HTTP/WebSocket bridge that spawns `claude` CLI sessions for the EvoNexus dashboard UI.

Consumed by `dashboard/frontend/src/components/AgentTerminal.tsx`. Not meant to be used standalone.

## Endpoints

- `GET  /api/health` — liveness
- `POST /api/sessions/for-agent` — find-or-create a session for a given `agentName`
- `GET  /api/sessions/:sessionId` — session metadata
- `DELETE /api/sessions/:sessionId` — kill and delete a session
- `WS   /` — per-session WebSocket (messages: `join_session`, `start_claude`, `input`, `resize`, `ping`, `stop`)

## Run

```bash
npm install
npm run dev        # port 32352
# or
node bin/server.js --dev --port 32352
```

Sessions are persisted to `~/.claude-code-web/sessions.json` (auto-saved every 30s, restored on boot).

## Files

- `bin/server.js` — CLI entrypoint
- `src/server.js` — HTTP + WebSocket server
- `src/claude-bridge.js` — spawns the `claude` CLI via `node-pty`
- `src/utils/session-store.js` — JSON persistence
