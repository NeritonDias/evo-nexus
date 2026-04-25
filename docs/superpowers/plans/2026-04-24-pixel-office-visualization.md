# Pixel Office Visualization — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a real-time pixel-art "Office" page (at `/office`) to the EvoNexus dashboard that visualises every running `.claude/agents/*.md` agent as an animated character, inspired by the pixel-agents VSCode extension but running fully in the browser.

**Architecture:** Three moving parts. (1) A richer Claude Code hook that emits lifecycle + tool events to a new Flask-Sock WebSocket broadcaster. (2) A harvested copy of the pixel-agents office engine (React 19 + Canvas 2D) placed inside `dashboard/frontend/src/pixel-office/`, stripped of all VSCode APIs. (3) A React `/office` page that mounts the canvas and maps WebSocket events onto `OfficeState` methods. Fallback polling against the existing `/api/agents/active` covers WS disconnects.

**Tech Stack:** Python 3.10+ / Flask 3.x / flask-sock 0.7 / flask-sqlalchemy / pytest (backend). TypeScript 5.x / React 19 / Vite 7 / Tailwind v4 / Canvas 2D (frontend). Bash hook scripts. MIT third-party code attribution.

**Branch:** `feat/pixel-office` (already created off `origin/develop`).

**Non-goals for this release:** in-browser furniture editor UI, drag-to-move furniture, audio cues. Team tmux visualisation is deferred but data shape is reserved. Everything else (sub-agents, seat persistence, rich runner events, heartbeat integration, roster sidebar, tool overlay, always-on labels, WS auth, Docker build parity, full asset pipeline, browser-side PNG decoder, dynamic furniture catalog, RBAC filtering, multi-source emission for triggers/tasks/terminal-server, snapshot endpoint, SSE fallback, observability metrics, E2E Playwright tests, error boundary, responsive fallback, alembic migration, CI lint) is **in scope** and covered in Phases 6–23.

**Plan revision history:**
- 2026-04-24 v1 (commit `1908cf5`): initial 14-phase plan (0–14).
- 2026-04-24 v2: deep re-analysis surfaced gaps. Phase 2 expanded with full asset pipeline (Tasks 2.5-2.7); Phase 3 gets snapshot endpoint (Task 3.3); Phase 4 gets i18n + RBAC + click→AgentDetail integration; new Phases 15–23 added: multi-source emission, RBAC, performance/scale, SSE+snapshot, observability, E2E tests, resilience UI, legacy unification, CI/build.

**Route clash resolved:** `/workspace` is already taken by the existing file browser page (`dashboard/frontend/src/pages/Workspace.tsx`). This feature lives at `/office` with page file `dashboard/frontend/src/pages/Office/index.tsx` — no rename of existing code.

**Licence compliance:** pixel-agents is MIT (`Copyright (c) 2026 Pablo De Lucca`). Every harvested file must carry a header comment `/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */` and a copy of `LICENSE` must be placed at `dashboard/frontend/src/pixel-office/LICENSE-pixel-agents`.

---

## File Structure

### Backend (Python / Flask)

| Path | Responsibility | Create / Modify |
|---|---|---|
| `.claude/hooks/agent-tracker.sh` | Enriched hook: forwards PreToolUse (any tool) / PostToolUse / Notification / Stop as HTTP POST to the local dashboard, keeps existing `agent-status.json` write for backwards-compat | Modify |
| `dashboard/backend/routes/pixel_office.py` | Blueprint: `/api/pixel-office/hook` (POST from hook), `/ws/pixel-office` (Flask-Sock), `/api/pixel-office/roster` (static list of agents derived from `.claude/agents/*.md`) | Create |
| `dashboard/backend/pixel_office_bus.py` | In-memory pub/sub: thread-safe broadcaster with bounded per-client queues; replay of last N events for late joiners | Create |
| `dashboard/backend/app.py` | Register new blueprint; whitelist WS path `/ws/pixel-office` in `auth_middleware`; existing `/ws/` passthrough already exists at line 494 | Modify |
| `tests/test_pixel_office_bus.py` | Unit tests for broadcaster (subscribe, publish, bounded queue, late-join replay) | Create |
| `tests/test_pixel_office_routes.py` | Flask test client tests for `/api/pixel-office/hook` and `/api/pixel-office/roster` | Create |

### Frontend (TypeScript / React)

| Path | Responsibility | Create / Modify |
|---|---|---|
| `dashboard/frontend/src/pixel-office/LICENSE-pixel-agents` | MIT licence copy | Create |
| `dashboard/frontend/src/pixel-office/engine/` | Harvest from `pixel-agents/webview-ui/src/office/engine/` — `officeState.ts`, `characters.ts`, `gameLoop.ts`, `renderer.ts`, `matrixEffect.ts`, `index.ts` | Create (copy + header) |
| `dashboard/frontend/src/pixel-office/layout/` | Harvest `furnitureCatalog.ts`, `tileMap.ts`, `layoutSerializer.ts`, `index.ts` | Create |
| `dashboard/frontend/src/pixel-office/sprites/` | Harvest `spriteData.ts`, `spriteCache.ts`, `bubble-permission.json`, `bubble-waiting.json`, `index.ts` | Create |
| `dashboard/frontend/src/pixel-office/assets/` | Harvest loader + decoder from `pixel-agents/shared/assets/` (`loader.ts`, `pngDecoder.ts`, `colorUtils.ts`, `manifestUtils.ts`, `constants.ts`, `types.ts`) | Create |
| `dashboard/frontend/src/pixel-office/constants.ts` | Subset of pixel-agents root `constants.ts` actually used by the engine (camera, zoom, bubbles, timings) — **not** the full file | Create |
| `dashboard/frontend/src/pixel-office/types.ts` | Copy of `office/types.ts` (TileType, Direction, CharacterState, etc.) | Create |
| `dashboard/frontend/src/pixel-office/colorize.ts` | Copy of `office/colorize.ts` (hue shift for palette variation) | Create |
| `dashboard/frontend/src/pixel-office/floorTiles.ts`, `wallTiles.ts`, `toolUtils.ts` | Copy from `office/` — pure data/utilities | Create |
| `dashboard/frontend/src/pixel-office/components/OfficeCanvasLite.tsx` | Trimmed `OfficeCanvas` — no editor, no VSCode API. Exposes `officeState`, `zoom`, `onZoomChange`, `panRef`. Hit-testing + camera follow preserved | Create |
| `dashboard/frontend/public/pixel-office/characters.png` | Copy sprite sheet from `pixel-agents/shared/assets/characters.png` | Create |
| `dashboard/frontend/public/pixel-office/manifest.json` | Generated sprite manifest (run pixel-agents `build.ts` script once, commit output). See Task 12 | Create |
| `dashboard/frontend/src/pages/Office/index.tsx` | Top-level page: loads roster, opens WS, mounts `OfficeCanvasLite`, holds zoom/pan state | Create |
| `dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts` | Custom hook — manages WS lifecycle, reconnects with backoff, falls back to polling `/api/agents/active` every 3 s when WS is down | Create |
| `dashboard/frontend/src/pages/Office/eventReducer.ts` | Pure function: `(officeState, event) => void` — maps every hook event type to OfficeState method. Independently unit-testable | Create |
| `dashboard/frontend/src/pages/Office/eventReducer.test.ts` | Vitest unit tests for the reducer | Create |
| `dashboard/frontend/src/App.tsx` | Add `<Route path="/office" element={<Office />} />`; add nav link | Modify |
| `dashboard/frontend/package.json` | Add `vitest` + `@testing-library/react` to devDependencies | Modify |
| `dashboard/frontend/vitest.config.ts` | Minimal vitest config (jsdom env) | Create |

### Documentation & housekeeping

| Path | Purpose | Create / Modify |
|---|---|---|
| `CHANGELOG.md` | New entry under Unreleased: `### Added — Pixel Office visualization (/workspace)` | Modify |
| `NOTICE.md` | Append attribution block for pixel-agents MIT | Modify |
| `docs/pixel-office.md` | Short user-facing doc: what the page does, how to enable hooks, known limitations | Create |

---

## Phase 0: Preflight

### Task 0.1: Verify toolchain on this machine

**Files:** none

- [ ] **Step 1: Confirm Python + uv work**

Run: `python3 --version && uv --version`
Expected: Python 3.10+ and uv installed. If missing, install uv per README.

- [ ] **Step 2: Confirm Node + npm work in the frontend**

Run: `cd dashboard/frontend && node --version && npm --version`
Expected: Node 20+.

- [ ] **Step 3: Install backend deps into `.venv` without running the app**

Run: `uv sync`
Expected: `.venv/` created, `flask-sock` present in `.venv/Lib/site-packages/` (Windows) or `.venv/lib/` (Unix).

- [ ] **Step 4: Install frontend deps**

Run: `cd dashboard/frontend && npm install`
Expected: no errors. Existing `node_modules` repopulated.

- [ ] **Step 5: Confirm build works before we touch anything**

Run: `cd dashboard/frontend && npm run build`
Expected: Vite build succeeds. Baseline captured.

---

## Phase 1: Event Bus (Backend)

### Task 1.1: Create the in-memory broadcaster

**Files:**
- Create: `dashboard/backend/pixel_office_bus.py`
- Test: `tests/test_pixel_office_bus.py`

- [ ] **Step 1: Write the failing tests first**

Create `tests/test_pixel_office_bus.py`:

```python
"""Unit tests for the pixel-office event bus (in-memory pub/sub)."""
import threading
import time

import pytest

from dashboard.backend.pixel_office_bus import PixelOfficeBus


def test_subscriber_receives_published_event():
    bus = PixelOfficeBus(max_queue=10, replay_size=0)
    q = bus.subscribe()
    bus.publish({"type": "agent_started", "id": 1})
    evt = q.get(timeout=1.0)
    assert evt == {"type": "agent_started", "id": 1}


def test_multiple_subscribers_each_receive_event():
    bus = PixelOfficeBus(max_queue=10, replay_size=0)
    q1, q2 = bus.subscribe(), bus.subscribe()
    bus.publish({"type": "tick"})
    assert q1.get(timeout=1.0) == {"type": "tick"}
    assert q2.get(timeout=1.0) == {"type": "tick"}


def test_full_queue_drops_oldest_to_make_room():
    bus = PixelOfficeBus(max_queue=2, replay_size=0)
    q = bus.subscribe()
    bus.publish({"n": 1})
    bus.publish({"n": 2})
    bus.publish({"n": 3})  # forces drop of {"n": 1}
    received = [q.get_nowait() for _ in range(2)]
    assert received == [{"n": 2}, {"n": 3}]


def test_late_joiner_gets_replay():
    bus = PixelOfficeBus(max_queue=10, replay_size=3)
    bus.publish({"n": 1})
    bus.publish({"n": 2})
    bus.publish({"n": 3})
    bus.publish({"n": 4})  # replay window is last 3
    q = bus.subscribe()
    first_three = [q.get_nowait() for _ in range(3)]
    assert first_three == [{"n": 2}, {"n": 3}, {"n": 4}]


def test_unsubscribe_stops_receiving():
    bus = PixelOfficeBus(max_queue=10, replay_size=0)
    q = bus.subscribe()
    bus.unsubscribe(q)
    bus.publish({"n": 1})
    with pytest.raises(Exception):
        q.get_nowait()


def test_thread_safe_concurrent_publish():
    bus = PixelOfficeBus(max_queue=10000, replay_size=0)
    q = bus.subscribe()

    def producer(start):
        for i in range(100):
            bus.publish({"n": start + i})

    threads = [threading.Thread(target=producer, args=(i * 100,)) for i in range(5)]
    for t in threads: t.start()
    for t in threads: t.join()
    time.sleep(0.05)
    received = []
    while True:
        try:
            received.append(q.get_nowait())
        except Exception:
            break
    assert len(received) == 500
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `uv run pytest tests/test_pixel_office_bus.py -v`
Expected: `ModuleNotFoundError: No module named 'dashboard.backend.pixel_office_bus'`.

- [ ] **Step 3: Implement `pixel_office_bus.py`**

Create `dashboard/backend/pixel_office_bus.py`:

```python
"""Thread-safe in-memory pub/sub bus for pixel-office events.

Subscribers receive events via a bounded thread.Queue. When a subscriber's
queue is full we drop its oldest entry rather than block the publisher — a
slow WebSocket client must never stall the hook POST handler.

Late-joining subscribers receive the last `replay_size` events so the canvas
can reconstruct state without a full history dump.
"""
from __future__ import annotations

import queue
import threading
from collections import deque
from typing import Any


class PixelOfficeBus:
    def __init__(self, max_queue: int = 500, replay_size: int = 50) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue] = []
        self._max_queue = max_queue
        self._replay: deque = deque(maxlen=replay_size) if replay_size > 0 else deque(maxlen=0)

    def subscribe(self) -> queue.Queue:
        q: queue.Queue = queue.Queue(maxsize=self._max_queue)
        with self._lock:
            for evt in list(self._replay):
                try:
                    q.put_nowait(evt)
                except queue.Full:
                    break
            self._subscribers.append(q)
        return q

    def unsubscribe(self, q: queue.Queue) -> None:
        with self._lock:
            if q in self._subscribers:
                self._subscribers.remove(q)

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._replay.append(event)
            dead: list[queue.Queue] = []
            for q in self._subscribers:
                try:
                    q.put_nowait(event)
                except queue.Full:
                    # Drop oldest to make room
                    try:
                        q.get_nowait()
                    except queue.Empty:
                        pass
                    try:
                        q.put_nowait(event)
                    except queue.Full:
                        dead.append(q)
            for q in dead:
                self._subscribers.remove(q)


# Module-level singleton used by routes + hook endpoint
bus = PixelOfficeBus()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_pixel_office_bus.py -v`
Expected: 6 tests pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/backend/pixel_office_bus.py tests/test_pixel_office_bus.py
git commit -m "feat(pixel-office): add in-memory event bus with bounded queues and replay"
```

---

### Task 1.2: Define the event schema

**Files:** Create `dashboard/backend/pixel_office_events.py`
**Test:** add to `tests/test_pixel_office_bus.py`

- [ ] **Step 1: Write failing test for schema validation**

Append to `tests/test_pixel_office_bus.py`:

```python
from dashboard.backend.pixel_office_events import validate_event, EventType


def test_validate_agent_started_accepts_valid_payload():
    e = {"type": "agent_started", "agent": "apex-architect", "session_id": "s1", "ts": "2026-04-24T10:00:00Z"}
    assert validate_event(e) is None


def test_validate_rejects_unknown_type():
    err = validate_event({"type": "garbage", "session_id": "s1"})
    assert err is not None
    assert "unknown" in err.lower()


def test_validate_rejects_missing_session_id():
    err = validate_event({"type": "agent_started", "agent": "apex-architect"})
    assert err is not None
    assert "session_id" in err


def test_event_type_enum_covers_the_spec():
    assert {e.value for e in EventType} == {
        "agent_started", "agent_stopped",
        "tool_started", "tool_finished",
        "waiting_input", "notification",
        "token_usage",
    }
```

- [ ] **Step 2: Run to verify failure**

Run: `uv run pytest tests/test_pixel_office_bus.py -v -k validate_or_event_type`
Expected: ImportError.

- [ ] **Step 3: Implement `pixel_office_events.py`**

Create `dashboard/backend/pixel_office_events.py`:

```python
"""Event schema for pixel-office. Keep this file the single source of truth —
both the hook script and the frontend reducer refer to these names."""
from __future__ import annotations

from enum import Enum
from typing import Any


class EventType(str, Enum):
    AGENT_STARTED = "agent_started"     # agent session spawned
    AGENT_STOPPED = "agent_stopped"     # agent session ended (Stop hook)
    TOOL_STARTED = "tool_started"       # PreToolUse
    TOOL_FINISHED = "tool_finished"     # PostToolUse
    WAITING_INPUT = "waiting_input"     # Notification hook (permission prompt)
    NOTIFICATION = "notification"       # generic notification (banner)
    TOKEN_USAGE = "token_usage"         # periodic token counter update


_REQUIRED = {
    EventType.AGENT_STARTED: {"agent", "session_id"},
    EventType.AGENT_STOPPED: {"session_id"},
    EventType.TOOL_STARTED: {"session_id", "tool"},
    EventType.TOOL_FINISHED: {"session_id", "tool"},
    EventType.WAITING_INPUT: {"session_id"},
    EventType.NOTIFICATION: {"message"},
    EventType.TOKEN_USAGE: {"session_id", "input_tokens", "output_tokens"},
}


def validate_event(e: dict[str, Any]) -> str | None:
    """Return None if valid, else an error string."""
    t = e.get("type")
    if not t:
        return "missing type"
    try:
        et = EventType(t)
    except ValueError:
        return f"unknown event type: {t}"
    required = _REQUIRED[et]
    missing = required - set(e.keys())
    if missing:
        return f"missing required fields: {sorted(missing)}"
    return None
```

- [ ] **Step 4: Run tests**

Run: `uv run pytest tests/test_pixel_office_bus.py -v`
Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add dashboard/backend/pixel_office_events.py tests/test_pixel_office_bus.py
git commit -m "feat(pixel-office): define event schema with validator"
```

---

### Task 1.3: HTTP + WebSocket routes

**Files:**
- Create: `dashboard/backend/routes/pixel_office.py`
- Test: `tests/test_pixel_office_routes.py`
- Modify: `dashboard/backend/app.py`

- [ ] **Step 1: Write failing tests for the HTTP hook endpoint**

Create `tests/test_pixel_office_routes.py`:

```python
"""Route tests for /api/pixel-office/*."""
import os
import sys
import pytest

# Ensure dashboard/backend is importable
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "dashboard", "backend"))


@pytest.fixture
def client():
    from dashboard.backend.app import app
    app.config["TESTING"] = True
    with app.test_client() as c:
        yield c


def test_hook_endpoint_rejects_missing_token(client, monkeypatch):
    monkeypatch.setenv("PIXEL_OFFICE_HOOK_TOKEN", "secret")
    r = client.post("/api/pixel-office/hook", json={"type": "agent_started", "agent": "a", "session_id": "s"})
    assert r.status_code == 401


def test_hook_endpoint_accepts_valid_event(client, monkeypatch):
    monkeypatch.setenv("PIXEL_OFFICE_HOOK_TOKEN", "secret")
    r = client.post(
        "/api/pixel-office/hook",
        json={"type": "agent_started", "agent": "apex-architect", "session_id": "s1"},
        headers={"X-Hook-Token": "secret"},
    )
    assert r.status_code == 202


def test_hook_endpoint_rejects_malformed_event(client, monkeypatch):
    monkeypatch.setenv("PIXEL_OFFICE_HOOK_TOKEN", "secret")
    r = client.post(
        "/api/pixel-office/hook",
        json={"type": "agent_started"},  # missing agent and session_id
        headers={"X-Hook-Token": "secret"},
    )
    assert r.status_code == 400


def test_roster_returns_agents_from_claude_dir(client, tmp_path, monkeypatch):
    agents_dir = tmp_path / ".claude" / "agents"
    agents_dir.mkdir(parents=True)
    (agents_dir / "apex-architect.md").write_text(
        "---\nname: apex-architect\ndescription: Architect agent\ncolor: blue\n---\n\nbody",
        encoding="utf-8",
    )
    monkeypatch.setenv("EVONEXUS_WORKSPACE", str(tmp_path))
    r = client.get("/api/pixel-office/roster")
    assert r.status_code == 200
    data = r.get_json()
    assert any(a["name"] == "apex-architect" and a["color"] == "blue" for a in data["agents"])
```

- [ ] **Step 2: Run tests — expect failures (blueprint not registered)**

Run: `uv run pytest tests/test_pixel_office_routes.py -v`
Expected: 404s on all endpoints.

- [ ] **Step 3: Implement the blueprint**

Create `dashboard/backend/routes/pixel_office.py`:

```python
"""Pixel-office routes: hook ingestion (HTTP POST), WebSocket stream, agent roster.

Authentication: the HTTP hook endpoint expects a shared secret
`PIXEL_OFFICE_HOOK_TOKEN` env var that the hook script reads too. Missing or
wrong token → 401. This endpoint is explicitly allow-listed upstream of
login_required because local shell hooks can't carry a user session.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

from flask import Blueprint, jsonify, request
from flask_sock import Sock

from pixel_office_bus import bus
from pixel_office_events import validate_event

bp = Blueprint("pixel_office", __name__, url_prefix="/api/pixel-office")
sock = Sock()  # attached to app in app.py

_WORKSPACE_ENV = "EVONEXUS_WORKSPACE"


def _workspace_root() -> Path:
    # Tests set EVONEXUS_WORKSPACE; prod infers from this file's location.
    override = os.environ.get(_WORKSPACE_ENV)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent.parent.parent


def _expected_hook_token() -> str | None:
    return os.environ.get("PIXEL_OFFICE_HOOK_TOKEN") or None


@bp.post("/hook")
def hook_ingest():
    expected = _expected_hook_token()
    if expected:
        provided = request.headers.get("X-Hook-Token", "")
        if not provided or not secrets.compare_digest(provided, expected):
            return jsonify({"error": "unauthorized"}), 401
    event = request.get_json(silent=True) or {}
    err = validate_event(event)
    if err:
        return jsonify({"error": err}), 400
    bus.publish(event)
    return jsonify({"ok": True}), 202


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_agent_frontmatter(md_text: str) -> dict[str, str]:
    m = _FRONTMATTER_RE.match(md_text)
    if not m:
        return {}
    result: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


@bp.get("/roster")
def roster():
    agents_dir = _workspace_root() / ".claude" / "agents"
    agents: list[dict[str, str]] = []
    if agents_dir.is_dir():
        for md in sorted(agents_dir.glob("*.md")):
            try:
                meta = _parse_agent_frontmatter(md.read_text(encoding="utf-8"))
            except OSError:
                continue
            agents.append({
                "name": meta.get("name", md.stem),
                "description": meta.get("description", ""),
                "color": meta.get("color", "slate"),
                "slug": md.stem,
            })
    return jsonify({"agents": agents})


@sock.route("/ws/pixel-office")
def ws_stream(ws):
    q = bus.subscribe()
    try:
        while True:
            event = q.get()
            ws.send(json.dumps(event))
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
```

- [ ] **Step 4: Register the blueprint in `app.py`**

Edit `dashboard/backend/app.py`.

Find the block starting at line 521:
```python
# --------------- Register blueprints ---------------
from routes.overview import bp as overview_bp
```

Add near the other imports (after `databases_bp`):
```python
from routes.pixel_office import bp as pixel_office_bp, sock as pixel_office_sock
```

Add near the other `register_blueprint` calls:
```python
app.register_blueprint(pixel_office_bp)
pixel_office_sock.init_app(app)
```

The existing `auth_middleware` (lines 485-519) already allows `/ws/` paths through, and `/api/pixel-office/hook` must be added to `PUBLIC_PATHS`. Edit `PUBLIC_PATHS` (line 447):
```python
PUBLIC_PATHS = {
    "/api/auth/login",
    "/api/auth/needs-setup",
    "/api/auth/setup",
    "/api/config/workspace-status",
    "/api/version",
    "/api/version/check",
    "/api/agents/active",
    "/api/pixel-office/hook",
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `uv run pytest tests/test_pixel_office_routes.py -v`
Expected: 4 tests pass.

- [ ] **Step 6: Smoke-test the WS endpoint manually**

Run: `cd dashboard && bash start-dashboard.sh` (or `uv run python backend/app.py`)
Then in another terminal:
```bash
pip install websocket-client
python3 -c "import websocket; ws=websocket.create_connection('ws://localhost:8080/ws/pixel-office'); print('connected'); ws.close()"
```
Expected: `connected`.

- [ ] **Step 7: Commit**

```bash
git add dashboard/backend/routes/pixel_office.py dashboard/backend/app.py tests/test_pixel_office_routes.py
git commit -m "feat(pixel-office): add /api/pixel-office/hook, /api/pixel-office/roster and /ws/pixel-office"
```

---

### Task 1.4: Enrich the Claude Code hook

**Files:**
- Modify: `.claude/hooks/agent-tracker.sh`
- Modify: `.claude/settings.json`

The existing hook is called only for `PreToolUse(Agent)` and `Stop`. We need broader coverage: `PreToolUse(*)`, `PostToolUse(*)`, `Notification`, `Stop`. The existing `agent-status.json` write stays (other dashboard endpoint uses it).

- [ ] **Step 1: Rewrite `agent-tracker.sh`**

Replace `.claude/hooks/agent-tracker.sh` with:

```bash
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
```

- [ ] **Step 2: Expand hook coverage in `.claude/settings.json`**

Edit `.claude/settings.json`. Replace the `hooks` block with:

```json
"hooks": {
  "PreToolUse": [
    {
      "matcher": "",
      "hooks": [
        { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/agent-tracker.sh\"" }
      ]
    }
  ],
  "PostToolUse": [
    {
      "matcher": "",
      "hooks": [
        { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/agent-tracker.sh\"" }
      ]
    }
  ],
  "Notification": [
    {
      "matcher": "",
      "hooks": [
        { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/agent-tracker.sh\"" }
      ]
    }
  ],
  "Stop": [
    {
      "matcher": "",
      "hooks": [
        { "type": "command", "command": "bash \"$CLAUDE_PROJECT_DIR/.claude/hooks/agent-tracker.sh\"" }
      ]
    }
  ]
}
```

- [ ] **Step 3: Verify the hook doesn't break the existing agent-status.json flow**

Run: `bash .claude/hooks/agent-tracker.sh <<< '{"tool_name":"Read"}'`
(set `CLAUDE_HOOK_EVENT=PreToolUse` first)

Expected: no stderr. `agent-status.json` still parseable.

- [ ] **Step 4: Smoke test the full chain**

Start the dashboard (`bash dashboard/start-dashboard.sh`), then in another terminal run a small Claude session inside the workspace:

```bash
export CLAUDE_HOOK_EVENT=PreToolUse
export CLAUDE_SESSION_ID=smoketest
export PIXEL_OFFICE_HOOK_TOKEN=local
echo '{"tool_name":"Read"}' | bash .claude/hooks/agent-tracker.sh
```

Then inspect the WS by opening `ws://localhost:8080/ws/pixel-office` — you should see the `tool_started` event.

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/agent-tracker.sh .claude/settings.json
git commit -m "feat(pixel-office): extend Claude hook to POST tool/notification events"
```

---

## Phase 2: Frontend Harvest

### Task 2.1: Copy the engine

**Files:** see "Frontend" table above.

- [ ] **Step 1: Create target directories**

Run:
```bash
cd dashboard/frontend/src
mkdir -p pixel-office/{engine,layout,sprites,assets,components}
mkdir -p ../public/pixel-office
```

- [ ] **Step 2: Copy engine files**

Copy from `C:\Users\Neriton\.claude\cache\pixel-agents-ref\webview-ui\src\office\engine\` into `dashboard/frontend/src/pixel-office/engine/`:
`officeState.ts`, `characters.ts`, `gameLoop.ts`, `renderer.ts`, `matrixEffect.ts`, `index.ts`.

Likewise for `layout/` (`furnitureCatalog.ts`, `tileMap.ts`, `layoutSerializer.ts`, `index.ts`) and `sprites/` (`spriteData.ts`, `spriteCache.ts`, `bubble-permission.json`, `bubble-waiting.json`, `index.ts`).

Copy `types.ts`, `colorize.ts`, `floorTiles.ts`, `wallTiles.ts`, `toolUtils.ts` into `pixel-office/`.

Copy `shared/assets/*.ts` into `pixel-office/assets/`.

Do **not** copy `editor/` — v1 is view-only.

- [ ] **Step 3: Copy the LICENSE**

Copy `C:\Users\Neriton\.claude\cache\pixel-agents-ref\LICENSE` to `dashboard/frontend/src/pixel-office/LICENSE-pixel-agents` verbatim.

- [ ] **Step 4: Add attribution header to every copied `.ts`/`.tsx` file**

Prepend this single line to each harvested file:

```ts
/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
```

Script to do it safely:
```bash
cd dashboard/frontend/src/pixel-office
for f in $(find . -name "*.ts" -o -name "*.tsx"); do
  grep -q "Adapted from pixel-agents" "$f" || sed -i '1i\/\* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca \*\/' "$f"
done
```

- [ ] **Step 5: Commit (still broken — not building yet)**

```bash
git add dashboard/frontend/src/pixel-office
git commit -m "chore(pixel-office): harvest office engine from pixel-agents (MIT)"
```

---

### Task 2.2: Strip VSCode dependencies

**Files:** multiple under `dashboard/frontend/src/pixel-office/`

- [ ] **Step 1: Remove every import of `vscodeApi` or `notificationSound`**

Run: `grep -rln "vscodeApi\|notificationSound" dashboard/frontend/src/pixel-office/`
Expected after fix: empty.

Typical fix is in engine files that do nothing VSCode-related but have a stale import — just delete the line. For `OfficeCanvas.tsx` we copy into `OfficeCanvasLite.tsx` (Task 2.3) and delete the original.

- [ ] **Step 2: Delete `browserMock.ts` references if any were copied**

The engine itself doesn't import browserMock; only `App.tsx` in pixel-agents did. If any file under `pixel-office/` references it, delete the import.

- [ ] **Step 3: Type-check**

Run: `cd dashboard/frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: errors only in `OfficeCanvas.tsx` (still references `vscode`). We fix that in Task 2.3.

- [ ] **Step 4: Commit**

```bash
git add -u dashboard/frontend/src/pixel-office
git commit -m "chore(pixel-office): remove VSCode-specific imports from harvested engine"
```

---

### Task 2.3: Build `OfficeCanvasLite`

**Files:**
- Create: `dashboard/frontend/src/pixel-office/components/OfficeCanvasLite.tsx`
- Delete: `dashboard/frontend/src/pixel-office/components/OfficeCanvas.tsx` (original)

- [ ] **Step 1: Scaffold the lite component**

Create `dashboard/frontend/src/pixel-office/components/OfficeCanvasLite.tsx`:

```tsx
/* Adapted from pixel-agents (https://github.com/pablodelucca/pixel-agents) — MIT © 2026 Pablo De Lucca */
import { useCallback, useEffect, useRef } from 'react';

import {
  CAMERA_FOLLOW_LERP,
  CAMERA_FOLLOW_SNAP_THRESHOLD,
  PAN_MARGIN_FRACTION,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_SCROLL_THRESHOLD,
} from '../constants.js';
import { startGameLoop } from '../engine/gameLoop.js';
import type { OfficeState } from '../engine/officeState.js';
import type { SelectionRenderState } from '../engine/renderer.js';
import { renderFrame } from '../engine/renderer.js';
import { TILE_SIZE } from '../types.js';

interface Props {
  officeState: OfficeState;
  onSelect: (agentId: number | null) => void;
  zoom: number;
  onZoomChange: (z: number) => void;
  panRef: React.MutableRefObject<{ x: number; y: number }>;
}

export function OfficeCanvasLite({ officeState, onSelect, zoom, onZoomChange, panRef }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const offsetRef = useRef({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const panStartRef = useRef({ mouseX: 0, mouseY: 0, panX: 0, panY: 0 });
  const zoomAccumulatorRef = useRef(0);

  const clampPan = useCallback(
    (px: number, py: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return { x: px, y: py };
      const layout = officeState.getLayout();
      const mapW = layout.cols * TILE_SIZE * zoom;
      const mapH = layout.rows * TILE_SIZE * zoom;
      const marginX = canvas.width * PAN_MARGIN_FRACTION;
      const marginY = canvas.height * PAN_MARGIN_FRACTION;
      const maxPanX = mapW / 2 + canvas.width / 2 - marginX;
      const maxPanY = mapH / 2 + canvas.height / 2 - marginY;
      return {
        x: Math.max(-maxPanX, Math.min(maxPanX, px)),
        y: Math.max(-maxPanY, Math.min(maxPanY, py)),
      };
    },
    [officeState, zoom],
  );

  const resizeCanvas = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const rect = container.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(rect.width * dpr);
    canvas.height = Math.round(rect.height * dpr);
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    resizeCanvas();
    const observer = new ResizeObserver(() => resizeCanvas());
    if (containerRef.current) observer.observe(containerRef.current);

    const stop = startGameLoop(canvas, {
      update: (dt) => officeState.update(dt),
      render: (ctx) => {
        const w = canvas.width;
        const h = canvas.height;

        if (officeState.cameraFollowId !== null) {
          const followCh = officeState.characters.get(officeState.cameraFollowId);
          if (followCh) {
            const layout = officeState.getLayout();
            const mapW = layout.cols * TILE_SIZE * zoom;
            const mapH = layout.rows * TILE_SIZE * zoom;
            const targetX = mapW / 2 - followCh.x * zoom;
            const targetY = mapH / 2 - followCh.y * zoom;
            const dx = targetX - panRef.current.x;
            const dy = targetY - panRef.current.y;
            if (Math.abs(dx) < CAMERA_FOLLOW_SNAP_THRESHOLD && Math.abs(dy) < CAMERA_FOLLOW_SNAP_THRESHOLD) {
              panRef.current = { x: targetX, y: targetY };
            } else {
              panRef.current = {
                x: panRef.current.x + dx * CAMERA_FOLLOW_LERP,
                y: panRef.current.y + dy * CAMERA_FOLLOW_LERP,
              };
            }
          }
        }

        const selectionRender: SelectionRenderState = {
          selectedAgentId: officeState.selectedAgentId,
          hoveredAgentId: officeState.hoveredAgentId,
          hoveredTile: officeState.hoveredTile,
          seats: officeState.seats,
          characters: officeState.characters,
        };

        const { offsetX, offsetY } = renderFrame(
          ctx, w, h,
          officeState.tileMap,
          officeState.furniture,
          officeState.getCharacters(),
          zoom,
          panRef.current.x,
          panRef.current.y,
          selectionRender,
          undefined,
          officeState.getLayout().tileColors,
          officeState.getLayout().cols,
          officeState.getLayout().rows,
        );
        offsetRef.current = { x: offsetX, y: offsetY };
      },
    });

    return () => { stop(); observer.disconnect(); };
  }, [officeState, resizeCanvas, zoom, panRef]);

  const screenToWorld = useCallback(
    (clientX: number, clientY: number) => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      const rect = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const deviceX = (clientX - rect.left) * dpr;
      const deviceY = (clientY - rect.top) * dpr;
      return {
        worldX: (deviceX - offsetRef.current.x) / zoom,
        worldY: (deviceY - offsetRef.current.y) / zoom,
      };
    },
    [zoom],
  );

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      const pos = screenToWorld(e.clientX, e.clientY);
      if (!pos) return;
      const hit = officeState.getCharacterAt(pos.worldX, pos.worldY);
      if (hit !== null) {
        officeState.dismissBubble(hit);
        if (officeState.selectedAgentId === hit) {
          officeState.selectedAgentId = null;
          officeState.cameraFollowId = null;
          onSelect(null);
        } else {
          officeState.selectedAgentId = hit;
          officeState.cameraFollowId = hit;
          onSelect(hit);
        }
      } else if (officeState.selectedAgentId !== null) {
        officeState.selectedAgentId = null;
        officeState.cameraFollowId = null;
        onSelect(null);
      }
    },
    [officeState, onSelect, screenToWorld],
  );

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 1) return;
    e.preventDefault();
    officeState.cameraFollowId = null;
    isPanningRef.current = true;
    panStartRef.current = { mouseX: e.clientX, mouseY: e.clientY, panX: panRef.current.x, panY: panRef.current.y };
  }, [officeState, panRef]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isPanningRef.current) return;
    const dpr = window.devicePixelRatio || 1;
    const dx = (e.clientX - panStartRef.current.mouseX) * dpr;
    const dy = (e.clientY - panStartRef.current.mouseY) * dpr;
    panRef.current = clampPan(panStartRef.current.panX + dx, panStartRef.current.panY + dy);
  }, [panRef, clampPan]);

  const handleMouseUp = useCallback(() => { isPanningRef.current = false; }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAccumulatorRef.current += e.deltaY;
        if (Math.abs(zoomAccumulatorRef.current) >= ZOOM_SCROLL_THRESHOLD) {
          const delta = zoomAccumulatorRef.current < 0 ? 1 : -1;
          zoomAccumulatorRef.current = 0;
          const z = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
          if (z !== zoom) onZoomChange(z);
        }
      } else {
        const dpr = window.devicePixelRatio || 1;
        officeState.cameraFollowId = null;
        panRef.current = clampPan(panRef.current.x - e.deltaX * dpr, panRef.current.y - e.deltaY * dpr);
      }
    },
    [zoom, onZoomChange, officeState, panRef, clampPan],
  );

  return (
    <div ref={containerRef} className="w-full h-full relative overflow-hidden bg-slate-900">
      <canvas
        ref={canvasRef}
        onClick={handleClick}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
        className="block"
      />
    </div>
  );
}
```

- [ ] **Step 2: Delete the original (VSCode-coupled) canvas**

```bash
rm dashboard/frontend/src/pixel-office/components/OfficeCanvas.tsx
```

- [ ] **Step 3: Type-check**

Run: `cd dashboard/frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: Any remaining errors should be in `constants.ts` (still references editor constants). Trim the file to only the constants imported by the engine. If trimming breaks an import, adjust until `tsc --noEmit` passes with exit 0.

- [ ] **Step 4: Commit**

```bash
git add dashboard/frontend/src/pixel-office
git commit -m "feat(pixel-office): replace OfficeCanvas with OfficeCanvasLite (view-only, no VSCode)"
```

---

### Task 2.4: Generate sprite manifest + copy PNG

**Files:**
- Copy: `dashboard/frontend/public/pixel-office/characters.png`
- Copy: `dashboard/frontend/public/pixel-office/manifest.json`
- Modify: `dashboard/frontend/src/pixel-office/sprites/spriteData.ts` (fetch URL)

- [ ] **Step 1: Copy the sprite sheet**

```bash
cp /c/Users/Neriton/.claude/cache/pixel-agents-ref/shared/assets/characters.png \
   dashboard/frontend/public/pixel-office/characters.png
```

- [ ] **Step 2: Generate the manifest**

The pixel-agents repo ships a `shared/assets/build.ts` script. Reuse it headlessly:

```bash
cd /c/Users/Neriton/.claude/cache/pixel-agents-ref
npm install
npx tsx shared/assets/build.ts > /tmp/manifest.json
cp /tmp/manifest.json /d/evo-nexus/dashboard/frontend/public/pixel-office/manifest.json
```

If the script writes the manifest somewhere else (check `shared/assets/build.ts` — it may write to `webview-ui/public/…`), follow its own output path and copy from there.

- [ ] **Step 3: Point the loader at `/pixel-office/manifest.json`**

Edit `dashboard/frontend/src/pixel-office/sprites/spriteData.ts`. Find the fetch of the manifest/PNG (likely `fetch('./characters.png')` or similar) and replace with `fetch('/pixel-office/characters.png')` and `/pixel-office/manifest.json`.

- [ ] **Step 4: Manual smoke test**

Run: `cd dashboard/frontend && npm run dev`
Open http://localhost:5173 and check the browser Network tab: both `/pixel-office/characters.png` and `/pixel-office/manifest.json` should return 200. (They won't be visible in UI yet — no Office route.)

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/public/pixel-office dashboard/frontend/src/pixel-office/sprites/spriteData.ts
git commit -m "feat(pixel-office): ship sprite sheet and manifest under /pixel-office/"
```

> **Important correction (v2):** pixel-agents does NOT ship a single `characters.png`. The real asset tree is `webview-ui/public/assets/{characters,floors,walls,furniture,fonts}/...` with 6 character PNGs, 9 floor PNGs, 1 wall PNG, ~25 furniture subfolders (each with manifest.json + N PNGs), `default-layout-1.json`, and a custom pixel TTF font. Treat Task 2.4 as "minimal happy path"; the real asset pipeline is Tasks 2.5–2.7.

---

### Task 2.5: Full public asset harvest

**Goal:** copy the entire `webview-ui/public/assets/` tree (plus `webview-ui/public/fonts/`) to `dashboard/frontend/public/pixel-office/`, preserving relative structure, so the catalog/loader can find them at runtime.

**Files:**
- Create: `dashboard/frontend/public/pixel-office/characters/char_0..5.png`
- Create: `dashboard/frontend/public/pixel-office/floors/floor_0..8.png`
- Create: `dashboard/frontend/public/pixel-office/walls/wall_0.png`
- Create: `dashboard/frontend/public/pixel-office/furniture/<TYPE>/manifest.json` + sprite PNGs (≈25 subfolders)
- Create: `dashboard/frontend/public/pixel-office/default-layout-1.json`
- Create: `dashboard/frontend/public/pixel-office/fonts/FSPixelSansUnicode-Regular.ttf`
- Create: `dashboard/frontend/public/pixel-office/index.json` — generated index `{floors:[...], walls:[...], characters:[...], furniture:[<id>...], defaultLayout: "default-layout-1.json"}`

- [ ] **Step 1: Bulk copy preserving structure**

```bash
cd /d/evo-nexus
mkdir -p dashboard/frontend/public/pixel-office
cp -R /c/Users/Neriton/.claude/cache/pixel-agents-ref/webview-ui/public/assets/* \
      dashboard/frontend/public/pixel-office/
cp -R /c/Users/Neriton/.claude/cache/pixel-agents-ref/webview-ui/public/fonts \
      dashboard/frontend/public/pixel-office/
```

Sanity:
```bash
ls dashboard/frontend/public/pixel-office/{characters,floors,walls,furniture,fonts,default-layout-1.json}
find dashboard/frontend/public/pixel-office -name '*.png' | wc -l   # expect 60+
find dashboard/frontend/public/pixel-office -name 'manifest.json' | wc -l  # expect 24+
```

- [ ] **Step 2: Generate `index.json`**

This is the runtime equivalent of pixel-agents' `buildAssetIndex` in `shared/assets/build.ts` — a single JSON the browser fetches once to know what's available.

Create `dashboard/frontend/public/pixel-office/_build_index.mjs`:

```javascript
// Run once at build/harvest time. Idempotent.
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = new URL('.', import.meta.url).pathname;
const matchPng = (prefix) => (f) => new RegExp(`^${prefix}_\\d+\\.png$`, 'i').test(f);
const sortByNumber = (a, b) => parseInt(/(\d+)/.exec(a)?.[1] ?? '0') - parseInt(/(\d+)/.exec(b)?.[1] ?? '0');
const listSorted = (sub, prefix) => {
  try {
    return readdirSync(join(ROOT, sub)).filter(matchPng(prefix)).sort(sortByNumber);
  } catch { return []; }
};
const furniture = readdirSync(join(ROOT, 'furniture'), { withFileTypes: true })
  .filter(d => d.isDirectory()).map(d => d.name).sort();
let defaultLayout = null, bestRev = 0;
for (const f of readdirSync(ROOT)) {
  const m = /^default-layout-(\d+)\.json$/.exec(f);
  if (m && +m[1] > bestRev) { bestRev = +m[1]; defaultLayout = f; }
}
const idx = {
  floors: listSorted('floors', 'floor'),
  walls: listSorted('walls', 'wall'),
  characters: listSorted('characters', 'char'),
  furniture,
  defaultLayout,
};
writeFileSync(join(ROOT, 'index.json'), JSON.stringify(idx, null, 2));
console.log('Wrote index.json:', idx);
```

Run: `node dashboard/frontend/public/pixel-office/_build_index.mjs`

- [ ] **Step 3: Sanity-check generated index**

`cat dashboard/frontend/public/pixel-office/index.json` should list all PNGs and furniture folders.

- [ ] **Step 4: Tests — at least one frontend test verifies fetchability**

Create `dashboard/frontend/src/pixel-office/assets/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import indexJson from '../../../public/pixel-office/index.json';

describe('pixel-office asset index', () => {
  it('lists at least 6 character palettes', () => {
    expect(indexJson.characters.length).toBeGreaterThanOrEqual(6);
  });
  it('lists at least 8 floor variants', () => {
    expect(indexJson.floors.length).toBeGreaterThanOrEqual(8);
  });
  it('lists at least 20 furniture types', () => {
    expect(indexJson.furniture.length).toBeGreaterThanOrEqual(20);
  });
  it('has a default layout', () => {
    expect(indexJson.defaultLayout).toMatch(/^default-layout-\d+\.json$/);
  });
});
```

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/public/pixel-office dashboard/frontend/src/pixel-office/assets/index.test.ts
git commit -m "feat(pixel-office): full public asset harvest (chars+floors+walls+furniture+layout+font)"
```

---

### Task 2.6: Browser-side PNG decoder pipeline

**Goal:** port the relevant decoders from pixel-agents `shared/assets/pngDecoder.ts` (Node) to a browser equivalent that uses `fetch` + `OffscreenCanvas` + `getImageData`. Produces the same `SpriteData = string[][]` shape that the engine consumes.

**Files:**
- Modify: `dashboard/frontend/src/pixel-office/assets/pngDecoder.ts` (replace Node fs/Buffer paths)
- Create: `dashboard/frontend/src/pixel-office/assets/browserDecoder.ts` (canvas-backed loader)
- Test: `dashboard/frontend/src/pixel-office/assets/browserDecoder.test.ts`

- [ ] **Step 1: Audit the existing harvested decoder**

Read the harvested `pixel-office/assets/pngDecoder.ts`. Identify Node-specific calls (`fs`, `Buffer`, `path`). The pure-pixel logic (RGB→hex, anim-frame slicing) stays.

- [ ] **Step 2: Write the failing tests**

Create `browserDecoder.test.ts` with vitest + a small fixture PNG (use the actual `char_0.png` from public/):

```ts
import { describe, it, expect, beforeAll } from 'vitest';
import { decodeCharacterPngFromUrl, rgbaToHex } from './browserDecoder';

describe('browserDecoder', () => {
  it('rgbaToHex converts a fully opaque pixel', () => {
    expect(rgbaToHex([255, 0, 0, 255])).toBe('#ff0000');
  });
  it('rgbaToHex returns empty string for fully transparent', () => {
    expect(rgbaToHex([255, 0, 0, 0])).toBe('');
  });
  it('decodes char_0.png into walking/typing/reading frames', async () => {
    const sprites = await decodeCharacterPngFromUrl('/pixel-office/characters/char_0.png');
    expect(sprites.down.length).toBeGreaterThanOrEqual(7);  // walk×3 + typing×2 + reading×2
    expect(sprites.up.length).toBeGreaterThanOrEqual(7);
    expect(sprites.right.length).toBeGreaterThanOrEqual(7);
  });
});
```

- [ ] **Step 3: Implement the browser decoder**

```ts
// dashboard/frontend/src/pixel-office/assets/browserDecoder.ts
/* Adapted from pixel-agents pngDecoder.ts (MIT © 2026 Pablo De Lucca) */
import type { SpriteData } from '../types';
import { CHAR_FRAMES_PER_ROW } from './constants';

export interface CharacterDirectionSprites {
  down: SpriteData[];
  up: SpriteData[];
  right: SpriteData[];
}

export function rgbaToHex([r, g, b, a]: [number, number, number, number]): string {
  if (a === 0) return '';
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

async function fetchImageData(url: string): Promise<ImageData> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch ${url}: ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('OffscreenCanvas 2d unavailable');
  ctx.drawImage(bmp, 0, 0);
  return ctx.getImageData(0, 0, bmp.width, bmp.height);
}

function imageDataToSprite(img: ImageData, x: number, y: number, w: number, h: number): SpriteData {
  const out: string[][] = [];
  for (let row = 0; row < h; row++) {
    const r: string[] = [];
    for (let col = 0; col < w; col++) {
      const i = ((y + row) * img.width + (x + col)) * 4;
      r.push(rgbaToHex([img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]]));
    }
    out.push(r);
  }
  return out;
}

/** Slice a character PNG into [down, up, right] direction strips, each containing
 *  N animation frames (walk, typing, reading) of size 16×32. */
export async function decodeCharacterPngFromUrl(url: string): Promise<CharacterDirectionSprites> {
  const img = await fetchImageData(url);
  const FRAME_W = 16;
  const FRAME_H = 32;
  const decode = (rowIdx: number, frames: number): SpriteData[] => {
    const arr: SpriteData[] = [];
    for (let i = 0; i < frames; i++) {
      arr.push(imageDataToSprite(img, i * FRAME_W, rowIdx * FRAME_H, FRAME_W, FRAME_H));
    }
    return arr;
  };
  return {
    down: decode(0, CHAR_FRAMES_PER_ROW),
    up: decode(1, CHAR_FRAMES_PER_ROW),
    right: decode(2, CHAR_FRAMES_PER_ROW),
  };
}

export async function decodeFloorPngFromUrl(url: string): Promise<SpriteData> {
  const img = await fetchImageData(url);
  return imageDataToSprite(img, 0, 0, img.width, img.height);
}

export async function decodeWallPngFromUrl(url: string): Promise<SpriteData[]> {
  // Wall PNG is a horizontal strip of bitmask variants
  const img = await fetchImageData(url);
  const frameW = img.height; // square tiles
  const frameH = img.height;
  const count = Math.floor(img.width / frameW);
  const out: SpriteData[] = [];
  for (let i = 0; i < count; i++) out.push(imageDataToSprite(img, i * frameW, 0, frameW, frameH));
  return out;
}

export async function decodeFurnitureSpritePngFromUrl(url: string, w: number, h: number): Promise<SpriteData> {
  const img = await fetchImageData(url);
  return imageDataToSprite(img, 0, 0, w, h);
}
```

- [ ] **Step 4: Make tests pass**

Run: `npx vitest run src/pixel-office/assets/browserDecoder.test.ts`. May require enabling a `happy-dom` or `jsdom-like` environment that provides `OffscreenCanvas`. If vitest's jsdom doesn't ship it, add `vitest-environment-jsdom-canvas` or run those tests in a real browser via Playwright (deferred to Phase 20).

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/src/pixel-office/assets/browserDecoder.ts dashboard/frontend/src/pixel-office/assets/browserDecoder.test.ts
git commit -m "feat(pixel-office): browser-side PNG decoder (fetch + OffscreenCanvas)"
```

---

### Task 2.7: Dynamic furniture catalog + asset orchestrator

**Goal:** at runtime, after fetching `index.json`, fetch each furniture `manifest.json`, run the catalog flatten logic (already harvested from pixel-agents), and call the engine's `setCharacterTemplates` / `setFloorSprites` / `setWallSprites` / `buildDynamicCatalog`.

**Files:**
- Create: `dashboard/frontend/src/pixel-office/assets/orchestrator.ts`
- Test: `dashboard/frontend/src/pixel-office/assets/orchestrator.test.ts` (vitest with mocked fetch)

- [ ] **Step 1: Write failing test**

```ts
// orchestrator.test.ts
import { describe, it, expect, vi } from 'vitest';
import { loadAllAssets } from './orchestrator';

describe('orchestrator', () => {
  it('fetches index.json then each furniture manifest', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: async () => ({ characters: ['char_0.png'], floors: ['floor_0.png'], walls: ['wall_0.png'], furniture: ['DESK'], defaultLayout: 'default-layout-1.json' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'DESK', name: 'Desk', category: 'desks', type: 'asset', width: 16, height: 32, footprintW: 1, footprintH: 1 }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ /* default layout */ version: 1, cols: 5, rows: 5, tiles: [], tileColors: [], furniture: [] }) });
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadAllAssets({ skipDecode: true });
    expect(result.indexLoaded).toBe(true);
    expect(result.furnitureCount).toBe(1);
    expect(result.layout).toBeDefined();
  });
});
```

- [ ] **Step 2: Implement orchestrator**

Two-phase:
1. Fetch `index.json` + `default-layout-X.json` (parallel).
2. For each character/floor/wall PNG: decode in parallel via Promise.all → call `setCharacterTemplates` / `setFloorSprites` / `setWallSprites` from the engine.
3. For each furniture folder: fetch manifest, flatten via the harvested `flattenManifest` helper, decode each sprite PNG, build the in-memory sprite map → call `buildDynamicCatalog`.

Public API:
```ts
export interface LoadResult {
  indexLoaded: boolean;
  furnitureCount: number;
  layout: OfficeLayout;
}
export async function loadAllAssets(opts?: { skipDecode?: boolean }): Promise<LoadResult>;
```

- [ ] **Step 3: Wire from `pages/Office/index.tsx`**

In the page mount effect, before opening the WS, await `loadAllAssets()`. Show a "Loading office…" spinner while it runs (target <2s on loopback / cached fetch). Pass the loaded layout to `new OfficeState(layout)`.

- [ ] **Step 4: Tests pass**

Run: `npx vitest run src/pixel-office/assets`

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/src/pixel-office/assets/orchestrator.ts dashboard/frontend/src/pixel-office/assets/orchestrator.test.ts dashboard/frontend/src/pages/Office/index.tsx
git commit -m "feat(pixel-office): dynamic asset orchestrator loads layout + sprites at runtime"
```

---

## Phase 3: Reducer + WebSocket Client

### Task 3.1: Write the event reducer (TDD)

**Files:**
- Create: `dashboard/frontend/src/pages/Office/eventReducer.ts`
- Create: `dashboard/frontend/src/pages/Office/eventReducer.test.ts`
- Create: `dashboard/frontend/vitest.config.ts`

- [ ] **Step 1: Add vitest**

Run:
```bash
cd dashboard/frontend
npm install -D vitest @vitest/coverage-v8 jsdom @testing-library/react @testing-library/jest-dom
```

Create `dashboard/frontend/vitest.config.ts`:

```ts
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: { environment: 'jsdom', globals: true },
});
```

- [ ] **Step 2: Write failing tests**

Create `dashboard/frontend/src/pages/Office/eventReducer.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { OfficeState } from '../../pixel-office/engine/officeState.js';
import { applyEvent } from './eventReducer.js';

const sess = (id: string) => ({ session_id: id, ts: '2026-04-24T10:00:00Z' });

describe('applyEvent', () => {
  it('spawns a character on agent_started', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'apex-architect', ...sess('s1') });
    expect(os.characters.size).toBe(1);
  });

  it('marks agent active on tool_started', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.isActive).toBe(true);
  });

  it('shows permission bubble on waiting_input', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'waiting_input', agent: 'a', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.bubbleType).toBe('permission');
  });

  it('despawns on agent_stopped', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    applyEvent(os, { type: 'agent_stopped', agent: 'a', ...sess('s1') });
    const id = Array.from(os.characters.keys())[0];
    expect(os.characters.get(id)?.matrixEffect).toBe('despawn');
  });

  it('ignores tool_started for unknown session', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('ghost') });
    expect(os.characters.size).toBe(0);
  });

  it('reuses the same character id across events with matching session_id', () => {
    const os = new OfficeState();
    applyEvent(os, { type: 'agent_started', agent: 'a', ...sess('s1') });
    const first = Array.from(os.characters.keys())[0];
    applyEvent(os, { type: 'tool_started', agent: 'a', tool: 'Read', ...sess('s1') });
    const ids = Array.from(os.characters.keys());
    expect(ids).toEqual([first]);
  });
});
```

- [ ] **Step 3: Run and expect failure**

Run: `cd dashboard/frontend && npx vitest run src/pages/Office/eventReducer.test.ts`
Expected: cannot import `./eventReducer.js`.

- [ ] **Step 4: Implement the reducer**

Create `dashboard/frontend/src/pages/Office/eventReducer.ts`:

```ts
import type { OfficeState } from '../../pixel-office/engine/officeState.js';

export type PixelOfficeEvent =
  | { type: 'agent_started'; agent: string; session_id: string; ts: string }
  | { type: 'agent_stopped'; session_id: string; agent?: string; ts: string }
  | { type: 'tool_started'; session_id: string; agent: string; tool: string; ts: string }
  | { type: 'tool_finished'; session_id: string; agent: string; tool: string; ts: string }
  | { type: 'waiting_input'; session_id: string; agent?: string; message?: string; ts: string }
  | { type: 'notification'; message: string; ts: string }
  | { type: 'token_usage'; session_id: string; input_tokens: number; output_tokens: number; ts: string };

// Stable mapping session_id → character id so repeated events hit the same char.
const sessionToId = new Map<string, number>();
let nextId = 1;

function resolveId(sessionId: string): number {
  let id = sessionToId.get(sessionId);
  if (id === undefined) {
    id = nextId++;
    sessionToId.set(sessionId, id);
  }
  return id;
}

export function applyEvent(os: OfficeState, evt: PixelOfficeEvent): void {
  switch (evt.type) {
    case 'agent_started': {
      const id = resolveId(evt.session_id);
      os.addAgent(id, undefined, undefined, undefined, false, evt.agent);
      break;
    }
    case 'agent_stopped': {
      const id = sessionToId.get(evt.session_id);
      if (id !== undefined) {
        os.removeAgent(id);
        sessionToId.delete(evt.session_id);
      }
      break;
    }
    case 'tool_started': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentActive(id, true);
      os.setAgentTool(id, evt.tool);
      break;
    }
    case 'tool_finished': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentTool(id, null);
      // leave isActive=true; the next tool_started refreshes it or agent_stopped clears it
      break;
    }
    case 'waiting_input': {
      const id = evt.session_id ? sessionToId.get(evt.session_id) : undefined;
      if (id === undefined) return;
      os.showPermissionBubble(id);
      break;
    }
    case 'token_usage': {
      const id = sessionToId.get(evt.session_id);
      if (id === undefined) return;
      os.setAgentTokens(id, evt.input_tokens, evt.output_tokens);
      break;
    }
    case 'notification':
      // banner handled at a higher level — no-op here
      break;
  }
}

// Exposed for tests
export const _internals = { sessionToId, reset: () => { sessionToId.clear(); nextId = 1; } };
```

- [ ] **Step 5: Make tests pass**

Run: `npx vitest run src/pages/Office/eventReducer.test.ts`
Expected: 6 tests pass. If any fail because of shared state across tests, add a `beforeEach(() => _internals.reset())` in the test file.

- [ ] **Step 6: Commit**

```bash
git add dashboard/frontend/vitest.config.ts dashboard/frontend/package.json dashboard/frontend/package-lock.json dashboard/frontend/src/pages/Office
git commit -m "feat(pixel-office): add event reducer mapping WS events to OfficeState"
```

---

### Task 3.2: WebSocket hook with polling fallback

**Files:** Create `dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts`

- [ ] **Step 1: Implement the hook**

Create `dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts`:

```ts
import { useEffect, useRef } from 'react';
import type { OfficeState } from '../../pixel-office/engine/officeState.js';
import { applyEvent, type PixelOfficeEvent } from './eventReducer.js';

const RECONNECT_MIN_MS = 500;
const RECONNECT_MAX_MS = 15_000;
const POLL_INTERVAL_MS = 3_000;

export function usePixelOfficeSocket(os: OfficeState | null) {
  const retryRef = useRef(RECONNECT_MIN_MS);
  const pollTimer = useRef<number | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!os) return;
    let closed = false;

    const startPolling = () => {
      if (pollTimer.current !== null) return;
      pollTimer.current = window.setInterval(async () => {
        try {
          const r = await fetch('/api/agents/active');
          const data = await r.json();
          const active: Array<{ agent: string; started_at: string }> = data.active_agents ?? [];
          // Crude: ensure a character per active agent. session_id is missing here so we
          // key on agent name alone.
          for (const a of active) {
            applyEvent(os, { type: 'agent_started', agent: a.agent, session_id: `poll:${a.agent}`, ts: a.started_at });
          }
        } catch { /* ignore */ }
      }, POLL_INTERVAL_MS);
    };

    const stopPolling = () => {
      if (pollTimer.current !== null) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    };

    const connect = () => {
      if (closed) return;
      const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const url = `${proto}//${window.location.host}/ws/pixel-office`;
      const ws = new WebSocket(url);
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = RECONNECT_MIN_MS;
        stopPolling();
      };
      ws.onmessage = (msg) => {
        try {
          const evt = JSON.parse(msg.data) as PixelOfficeEvent;
          applyEvent(os, evt);
        } catch { /* drop */ }
      };
      ws.onerror = () => { /* will trigger onclose */ };
      ws.onclose = () => {
        if (closed) return;
        startPolling();
        const delay = retryRef.current;
        retryRef.current = Math.min(retryRef.current * 2, RECONNECT_MAX_MS);
        setTimeout(connect, delay);
      };
    };

    connect();
    return () => {
      closed = true;
      stopPolling();
      wsRef.current?.close();
    };
  }, [os]);
}
```

- [ ] **Step 2: Type-check**

Run: `cd dashboard/frontend && npx tsc --noEmit -p tsconfig.app.json`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts
git commit -m "feat(pixel-office): add WS hook with exponential backoff + polling fallback"
```

---

### Task 3.3: Snapshot endpoint for late joiners

**Goal:** when a client opens the WS or page after agents have already started, it should reconstruct full state — not just receive future deltas. Endpoint `/api/pixel-office/snapshot` returns the bus's current view: list of active sessions with their last-known state.

**Files:**
- Modify: `dashboard/backend/pixel_office_bus.py` (add `snapshot()` returning current sessions map)
- Modify: `dashboard/backend/routes/pixel_office.py` (add `/snapshot` endpoint)
- Modify: `dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts` (call snapshot on mount before WS open)
- Test: append to `tests/test_pixel_office_bus.py` and `tests/test_pixel_office_routes.py`

- [ ] **Step 1: Failing tests**

Append to `tests/test_pixel_office_bus.py`:
```python
def test_bus_snapshot_returns_current_sessions():
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    bus.publish({"type": "tool_started", "session_id": "s1", "agent": "a", "tool": "Read", "ts": "t2"})
    bus.publish({"type": "agent_started", "agent": "b", "session_id": "s2", "ts": "t3"})
    snap = bus.snapshot()
    assert "s1" in snap and snap["s1"]["agent"] == "a" and snap["s1"]["tool"] == "Read"
    assert "s2" in snap and snap["s2"]["agent"] == "b"

def test_bus_snapshot_drops_stopped_sessions():
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    bus.publish({"type": "agent_stopped", "session_id": "s1", "agent": "a", "ts": "t2"})
    assert "s1" not in bus.snapshot()
```

- [ ] **Step 2: Implement snapshot in `PixelOfficeBus`**

Add a `_sessions: dict[str, dict]` populated in `publish()` based on event type. Track per-session `{agent, tool, status, started_at, input_tokens, output_tokens}`. Drop on `agent_stopped`. Expose `snapshot() → dict[str, dict]` (deep copy under lock).

- [ ] **Step 3: Endpoint**

In `routes/pixel_office.py`:
```python
@bp.get("/snapshot")
def snapshot():
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    return jsonify({"sessions": bus.snapshot()})
```

- [ ] **Step 4: Frontend uses it on mount**

In `usePixelOfficeSocket`, before opening the WS:
```ts
const r = await fetch('/api/pixel-office/snapshot');
if (r.ok) {
  const { sessions } = await r.json();
  for (const [sid, info] of Object.entries(sessions)) {
    applyEvent(os, { type: 'agent_started', agent: info.agent, session_id: sid, ts: info.started_at });
    if (info.tool) applyEvent(os, { type: 'tool_started', agent: info.agent, session_id: sid, tool: info.tool, ts: info.started_at });
  }
}
```

- [ ] **Step 5: Tests pass**

Run pytest + vitest. Verify a refresh in mid-session reconstructs all visible characters.

- [ ] **Step 6: Commit**

```bash
git add dashboard/backend/pixel_office_bus.py dashboard/backend/routes/pixel_office.py dashboard/frontend/src/pages/Office/usePixelOfficeSocket.ts tests/test_pixel_office_bus.py tests/test_pixel_office_routes.py
git commit -m "feat(pixel-office): /api/pixel-office/snapshot for late-joiner state recovery"
```

---

## Phase 4: Office Page (route scaffolding)

### Task 4.1: Build the page

**Files:** Create `dashboard/frontend/src/pages/Office/index.tsx`

- [ ] **Step 1: Scaffold the page**

Create `dashboard/frontend/src/pages/Office/index.tsx`:

```tsx
import { useEffect, useRef, useState } from 'react';
import { OfficeState } from '../../pixel-office/engine/officeState.js';
import { OfficeCanvasLite } from '../../pixel-office/components/OfficeCanvasLite.js';
import { usePixelOfficeSocket } from './usePixelOfficeSocket.js';

export default function Office() {
  const [ready, setReady] = useState(false);
  const osRef = useRef<OfficeState | null>(null);
  const [zoom, setZoom] = useState(2);
  const panRef = useRef({ x: 0, y: 0 });

  useEffect(() => {
    osRef.current = new OfficeState();
    setReady(true);
  }, []);

  usePixelOfficeSocket(ready ? osRef.current : null);

  if (!ready || !osRef.current) return <div className="p-4 text-slate-400">Loading workspace…</div>;

  return (
    <div className="w-full h-[calc(100vh-56px)] flex flex-col">
      <header className="px-4 py-2 border-b border-slate-800 text-slate-200 text-sm">
        Office — live agent activity
      </header>
      <div className="flex-1 min-h-0">
        <OfficeCanvasLite
          officeState={osRef.current}
          onSelect={() => { /* reserved for drawer */ }}
          zoom={zoom}
          onZoomChange={setZoom}
          panRef={panRef}
        />
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Add the route + permission gate + nav + i18n + click→AgentDetail**

(2a) `dashboard/frontend/src/App.tsx`: import + route, but gate with `hasPermission('agents','view')`:
```tsx
import Office from './pages/Office';
// …
{hasPermission('agents', 'view') && <Route path="/office" element={<Office />} />}
```

(2b) `dashboard/frontend/src/components/Sidebar.tsx`: the file is structured as `navGroups` with `key`, `items: NavItem[]` shape. Append to the `operations` group items:
```ts
{ to: '/office', labelKey: 'office', icon: Building2, resource: 'agents' },
```
Import `Building2` from lucide-react.

(2c) i18n: add to `dashboard/frontend/src/i18n/locales/en.json` (and equivalent files for other locales) under `nav`:
```json
{ "nav": { "office": "Office" } }
```
Mirror in `pt.json` (or whatever locales exist) → `"office": "Escritório"`.

(2d) Click→AgentDetail: in `pages/Office/index.tsx` update `onSelect`:
```tsx
import { useNavigate } from 'react-router-dom';
const navigate = useNavigate();
// …
const handleSelect = (agentId: number | null) => {
  if (agentId === null) return;
  const ch = osRef.current?.characters.get(agentId);
  if (ch?.folderName) navigate(`/agents/${ch.folderName}`);
};
// …
<OfficeCanvasLite … onSelect={handleSelect} />
```

(2e) Replace the static header copy with `{t('office.title')}` once i18n keys exist.

(2f) `i18n/locales/*.json` add:
```json
{ "office": { "title": "Office — live agent activity", "loading": "Loading office…", "empty": "Office is quiet. Trigger an agent to see them at work." } }
```

- [ ] **Step 3: Dev smoke test**

```bash
cd dashboard/frontend && npm run dev
# separate terminal:
uv run python dashboard/backend/app.py
```

Open http://localhost:5173/office. Expected: empty office renders. Tiles + walls visible. No agents.

- [ ] **Step 4: Trigger a fake event**

```bash
curl -X POST http://localhost:8080/api/pixel-office/hook \
  -H 'Content-Type: application/json' \
  -d '{"type":"agent_started","agent":"apex-architect","session_id":"demo1","ts":"2026-04-24T10:00:00Z"}'
```

Expected: a character appears. Send `tool_started`, `tool_finished`, `waiting_input`, `agent_stopped` to exercise states.

- [ ] **Step 5: Production build sanity check**

Run: `cd dashboard/frontend && npm run build`
Expected: build succeeds, `dist/pixel-office/characters.png` present.

- [ ] **Step 6: Commit**

```bash
git add dashboard/frontend/src/App.tsx dashboard/frontend/src/pages/Office/index.tsx
git commit -m "feat(pixel-office): add /workspace page with live pixel-art canvas"
```

---

## Phase 5: Docs, Changelog, Final Review

### Task 5.1: Documentation

**Files:**
- Create: `docs/pixel-office.md`
- Modify: `CHANGELOG.md`, `NOTICE.md`

- [ ] **Step 1: Write user doc**

Create `docs/pixel-office.md`:

```markdown
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
```

- [ ] **Step 2: Add CHANGELOG entry**

Prepend to `CHANGELOG.md` under `## [Unreleased]`:

```markdown
### Added

- **Pixel Office** (`/office`): real-time pixel-art visualization of all
  active Claude Code agents, adapted from pixel-agents (MIT) by Pablo De Lucca.
- Broader Claude Code hook coverage (`PreToolUse *`, `PostToolUse *`,
  `Notification`) feeding a new `/ws/pixel-office` WebSocket stream.
```

- [ ] **Step 3: Update `NOTICE.md`**

Append:

```markdown
## Pixel Office

`dashboard/frontend/src/pixel-office/` and `dashboard/frontend/public/pixel-office/`
contain code and art assets adapted from
[pablodelucca/pixel-agents](https://github.com/pablodelucca/pixel-agents),
licensed under MIT. See
`dashboard/frontend/src/pixel-office/LICENSE-pixel-agents` for the full text.
```

- [ ] **Step 4: Commit**

```bash
git add docs/pixel-office.md CHANGELOG.md NOTICE.md
git commit -m "docs(pixel-office): user guide, changelog, third-party notice"
```

---

### Task 5.2: End-to-end acceptance test

**Files:** none — manual.

- [ ] **Step 1: Clean-slate run**

```bash
rm -rf dashboard/frontend/dist
cd dashboard/frontend && npm run build
cd ../..
uv run python dashboard/backend/app.py
```

- [ ] **Step 2: Navigate to `http://localhost:8080/office`**

Expected: empty office.

- [ ] **Step 3: In a separate shell, run a real Claude Code session in the workspace**

```bash
cd D:/evo-nexus
export CLAUDE_SESSION_ID=real
claude --print "list files in ADWs" --agent scout-explorer
```

Expected on the `/office` page:
1. A character appears (spawn effect).
2. It becomes active as tools fire.
3. On completion, it despawns with the matrix effect.

- [ ] **Step 4: Disconnect the backend mid-session**

Kill the Flask process. Expected: frontend starts polling `/api/agents/active` and gracefully falls back.

- [ ] **Step 5: Run the full test suite**

```bash
uv run pytest tests/test_pixel_office_bus.py tests/test_pixel_office_routes.py -v
cd dashboard/frontend && npx vitest run
```

Expected: all tests pass.

- [ ] **Step 6: Final commit bundling any last fixes**

```bash
git add -A
git diff --cached --stat
git commit -m "chore(pixel-office): post-acceptance adjustments"
```

---

---

## Phase 6: Agent Identity & Visual Polish

Purpose: make each of the 38 evo-nexus agents visually distinct — deterministic palette per agent slug, always-on name labels above each character, tool-icon overlay.

### Task 6.1: Deterministic palette & hue-shift from agent slug

**Files:**
- Create: `dashboard/frontend/src/pixel-office/agentIdentity.ts`
- Test: `dashboard/frontend/src/pixel-office/agentIdentity.test.ts`
- Modify: `dashboard/frontend/src/pages/Office/eventReducer.ts` (pass palette/hue into `addAgent`)

- [ ] **Step 1: Write failing test**

Create `dashboard/frontend/src/pixel-office/agentIdentity.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { paletteForAgent, labelColorForAgent } from './agentIdentity.js';

describe('paletteForAgent', () => {
  it('returns stable palette for same slug', () => {
    expect(paletteForAgent('apex-architect')).toEqual(paletteForAgent('apex-architect'));
  });

  it('distinct slugs tend to hash to different base palettes', () => {
    const a = paletteForAgent('apex-architect');
    const b = paletteForAgent('nex-sales');
    expect(a.palette !== b.palette || a.hueShift !== b.hueShift).toBe(true);
  });

  it('honours explicit frontmatter color when provided', () => {
    const r = paletteForAgent('apex-architect', { color: 'blue' });
    expect(r.palette).toBeGreaterThanOrEqual(0);
    expect(r.hueShift).toBeGreaterThanOrEqual(0);
  });
});

describe('labelColorForAgent', () => {
  it('returns a tailwind-compatible color token per frontmatter color', () => {
    expect(labelColorForAgent('blue')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(labelColorForAgent('red')).toMatch(/^#[0-9a-f]{6}$/i);
    expect(labelColorForAgent('unknown')).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
```

- [ ] **Step 2: Run — expect failure**

Run: `cd dashboard/frontend && npx vitest run src/pixel-office/agentIdentity.test.ts`

- [ ] **Step 3: Implement**

Create `dashboard/frontend/src/pixel-office/agentIdentity.ts`:

```ts
/* Deterministic visual identity for evo-nexus agents.
   Slug → {palette, hueShift}: stable across reloads, distinct per agent. */

const BASE_PALETTES = 6; // matches characters.png column count
const HUE_STEPS = [0, 45, 90, 135, 180, 225, 270, 315];

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

const COLOR_TO_PALETTE: Record<string, number> = {
  red: 0, orange: 1, yellow: 1, green: 2, teal: 2,
  blue: 3, cyan: 3, purple: 4, pink: 4, slate: 5, gray: 5,
};

const COLOR_TO_HEX: Record<string, string> = {
  red: '#ef4444', orange: '#f97316', yellow: '#eab308',
  green: '#22c55e', teal: '#14b8a6', blue: '#3b82f6',
  cyan: '#06b6d4', purple: '#a855f7', pink: '#ec4899',
  slate: '#64748b', gray: '#9ca3af',
};

export function paletteForAgent(
  slug: string,
  frontmatter?: { color?: string },
): { palette: number; hueShift: number } {
  const h = djb2(slug);
  const basePalette = frontmatter?.color && COLOR_TO_PALETTE[frontmatter.color] !== undefined
    ? COLOR_TO_PALETTE[frontmatter.color]
    : h % BASE_PALETTES;
  const hueShift = HUE_STEPS[(h >> 3) % HUE_STEPS.length];
  return { palette: basePalette, hueShift };
}

export function labelColorForAgent(color?: string): string {
  if (!color) return '#cbd5e1';
  return COLOR_TO_HEX[color.toLowerCase()] ?? '#cbd5e1';
}
```

- [ ] **Step 4: Wire roster into reducer**

Edit `dashboard/frontend/src/pages/Office/eventReducer.ts`. Add a module-level roster cache and integrate:

```ts
import { paletteForAgent } from '../../pixel-office/agentIdentity.js';

type RosterEntry = { name: string; description: string; color: string; slug: string };
const roster = new Map<string, RosterEntry>();

export function setRoster(entries: RosterEntry[]): void {
  roster.clear();
  for (const e of entries) roster.set(e.slug, e);
}
```

Then in the `agent_started` case, before `os.addAgent`, resolve identity:

```ts
const entry = roster.get(evt.agent);
const { palette, hueShift } = paletteForAgent(evt.agent, { color: entry?.color });
os.addAgent(id, palette, hueShift, undefined, false, evt.agent);
```

- [ ] **Step 5: Run tests — both files**

Run: `npx vitest run src/pixel-office src/pages/Office`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add dashboard/frontend/src/pixel-office/agentIdentity.ts dashboard/frontend/src/pixel-office/agentIdentity.test.ts dashboard/frontend/src/pages/Office/eventReducer.ts
git commit -m "feat(pixel-office): deterministic palette and hue-shift per agent slug"
```

---

### Task 6.2: Always-on name labels

**Files:** Modify `dashboard/frontend/src/pixel-office/engine/renderer.ts` or add overlay. The pixel-agents engine already supports an "always show labels" flag — check `renderer.ts` for `alwaysShowLabels` or equivalent.

- [ ] **Step 1: Locate the label rendering code**

Run: `grep -rn "showLabels\|agentName\|folderName" dashboard/frontend/src/pixel-office/engine/renderer.ts`

The engine typically draws a label when `alwaysShowOverlay` is true. We need it default-on.

- [ ] **Step 2: Add an `alwaysShowLabels` prop to `OfficeCanvasLite`**

Edit `dashboard/frontend/src/pixel-office/components/OfficeCanvasLite.tsx`. Default to `true`.

Pass through to `renderFrame` via an extra field on the existing `selectionRender` object or as a new parameter. Mirror the pixel-agents call signature — check if `renderFrame` already accepts a labels flag. If yes, just pass it. If not, add it.

- [ ] **Step 3: Verify in dev**

Run: `npm run dev`. Each character should have its agent slug rendered in a small pixel font above its head.

- [ ] **Step 4: Commit**

```bash
git add -u dashboard/frontend/src/pixel-office
git commit -m "feat(pixel-office): always-show agent name labels above characters"
```

---

### Task 6.3: Tool-icon overlay (harvest `ToolOverlay.tsx`)

**Files:**
- Copy: `C:\...\pixel-agents-ref\webview-ui\src\office\components\ToolOverlay.tsx` → `dashboard/frontend/src/pixel-office/components/ToolOverlay.tsx`
- Modify: `dashboard/frontend/src/pages/Office/index.tsx` to render the overlay

- [ ] **Step 1: Copy the file, add attribution header, remove any VSCode imports**

Run: `cp /c/Users/Neriton/.claude/cache/pixel-agents-ref/webview-ui/src/office/components/ToolOverlay.tsx dashboard/frontend/src/pixel-office/components/ToolOverlay.tsx`

Then inspect and strip `vscodeApi` imports if present.

- [ ] **Step 2: Mount in `Office/index.tsx`**

In the Office page, add below `<OfficeCanvasLite …/>`:

```tsx
<ToolOverlay officeState={osRef.current} zoom={zoom} panRef={panRef} />
```

Position it with `absolute inset-0 pointer-events-none` so it layers over the canvas without blocking clicks.

- [ ] **Step 3: Visual smoke test**

With backend running, push a `tool_started` event with different tools (`Read`, `Bash`, `Edit`). Expect a small icon to pop above the corresponding character.

- [ ] **Step 4: Commit**

```bash
git add dashboard/frontend/src/pixel-office/components/ToolOverlay.tsx dashboard/frontend/src/pages/Office/index.tsx
git commit -m "feat(pixel-office): tool-icon overlay above characters"
```

---

## Phase 7: Sub-Agent Visualisation

Purpose: when a main agent calls a sub-agent via the Agent tool, spawn a smaller character next to the parent. Despawn on tool completion.

### Task 7.1: Hook emits parent + subagent correlation

**Files:** Modify `.claude/hooks/agent-tracker.sh`, `dashboard/backend/pixel_office_events.py`

- [ ] **Step 1: Extend event schema**

Edit `dashboard/backend/pixel_office_events.py`, add to `EventType`:

```python
SUBAGENT_STARTED = "subagent_started"
SUBAGENT_FINISHED = "subagent_finished"
```

Add required fields:

```python
_REQUIRED[EventType.SUBAGENT_STARTED] = {"parent_session_id", "parent_tool_id", "subagent_type"}
_REQUIRED[EventType.SUBAGENT_FINISHED] = {"parent_session_id", "parent_tool_id"}
```

Update existing test expectations in `tests/test_pixel_office_bus.py::test_event_type_enum_covers_the_spec` to include the two new values.

- [ ] **Step 2: Extend hook script**

Edit `.claude/hooks/agent-tracker.sh`. Inside `PreToolUse` branch, when `TOOL == "Agent"`, also emit:

```bash
TOOL_USE_ID="$(grep_json tool_use_id)"
post_event "{\"type\":\"subagent_started\",\"parent_session_id\":$(esc "$SESSION_ID"),\"parent_tool_id\":$(esc "$TOOL_USE_ID"),\"subagent_type\":$(esc "$AGENT_TYPE"),\"ts\":\"$NOW\"}"
```

And inside `PostToolUse` branch:

```bash
if [ "$TOOL" = "Agent" ]; then
  TOOL_USE_ID="$(grep_json tool_use_id)"
  post_event "{\"type\":\"subagent_finished\",\"parent_session_id\":$(esc "$SESSION_ID"),\"parent_tool_id\":$(esc "$TOOL_USE_ID"),\"ts\":\"$NOW\"}"
fi
```

- [ ] **Step 3: Extend reducer**

Edit `dashboard/frontend/src/pages/Office/eventReducer.ts`. Add case for `subagent_started`:

```ts
case 'subagent_started': {
  const parentId = sessionToId.get(evt.parent_session_id);
  if (parentId === undefined) return;
  os.addSubagent(parentId, evt.parent_tool_id);
  break;
}
case 'subagent_finished': {
  const parentId = sessionToId.get(evt.parent_session_id);
  if (parentId === undefined) return;
  os.removeSubagent(parentId, evt.parent_tool_id);
  break;
}
```

Update the `PixelOfficeEvent` union type accordingly.

- [ ] **Step 4: Vitest coverage**

Append to `eventReducer.test.ts`:

```ts
it('spawns a sub-agent next to parent', () => {
  const os = new OfficeState();
  applyEvent(os, { type: 'agent_started', agent: 'apex', session_id: 'p', ts: 't' });
  applyEvent(os, {
    type: 'subagent_started', parent_session_id: 'p',
    parent_tool_id: 'T1', subagent_type: 'general-purpose', ts: 't',
  });
  expect(os.characters.size).toBe(2);
  applyEvent(os, {
    type: 'subagent_finished', parent_session_id: 'p', parent_tool_id: 'T1', ts: 't',
  });
  // Despawn is animated — character remains but starts despawn effect
  const sub = Array.from(os.characters.values()).find(c => c.isSubagent);
  expect(sub?.matrixEffect).toBe('despawn');
});
```

Run: `npx vitest run src/pages/Office/eventReducer.test.ts`

- [ ] **Step 5: Commit**

```bash
git add .claude/hooks/agent-tracker.sh dashboard/backend/pixel_office_events.py dashboard/frontend/src/pages/Office/eventReducer.ts dashboard/frontend/src/pages/Office/eventReducer.test.ts tests/test_pixel_office_bus.py
git commit -m "feat(pixel-office): visualise sub-agents as attached characters"
```

---

## Phase 8: Rich Runner Events (Python-side emission)

Purpose: `run_claude()` in `ADWs/runner.py` has information the bash hook doesn't — total cost, duration, agent param, log_name. Emit a final `token_usage` + `agent_stopped` with that context directly.

### Task 8.1: Runner publishes to the bus

**Files:**
- Create: `ADWs/pixel_office_client.py`
- Modify: `ADWs/runner.py`
- Test: `tests/test_runner_pixel_office.py`

- [ ] **Step 1: Failing test**

Create `tests/test_runner_pixel_office.py`:

```python
from unittest.mock import patch, MagicMock
from ADWs.pixel_office_client import post_event


def test_post_event_posts_json_with_token_header(monkeypatch):
    monkeypatch.setenv("PIXEL_OFFICE_HOOK_TOKEN", "secret")
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    with patch("ADWs.pixel_office_client.urlopen") as mock_open:
        resp = MagicMock(); resp.__enter__.return_value.status = 202
        mock_open.return_value = resp
        post_event({"type": "agent_started", "agent": "a", "session_id": "s"})
    args, _ = mock_open.call_args
    req = args[0]
    assert req.get_header("X-hook-token") == "secret"
    assert req.data is not None


def test_post_event_swallows_exceptions(monkeypatch):
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    with patch("ADWs.pixel_office_client.urlopen", side_effect=OSError("boom")):
        # Must not raise
        post_event({"type": "notification", "message": "hi"})
```

- [ ] **Step 2: Implement `pixel_office_client.py`**

Create `ADWs/pixel_office_client.py`:

```python
"""Tiny client for ADWs code to publish pixel-office events without blocking.

This runs in-process inside the scheduler / runner. It fires HTTP POSTs with a
short timeout and swallows any exception — visualisation is a best-effort
side-channel, never a failure mode.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.error
from urllib.request import Request, urlopen


def _post_sync(url: str, payload: dict, token: str | None, timeout: float) -> None:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Hook-Token"] = token
    req = Request(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as _:
            pass
    except (urllib.error.URLError, OSError, TimeoutError):
        pass


def post_event(payload: dict, timeout: float = 1.5) -> None:
    url = os.environ.get("EVONEXUS_DASHBOARD_URL", "http://127.0.0.1:8080")
    url = url.rstrip("/") + "/api/pixel-office/hook"
    token = os.environ.get("PIXEL_OFFICE_HOOK_TOKEN") or None
    t = threading.Thread(target=_post_sync, args=(url, payload, token, timeout), daemon=True)
    t.start()
```

- [ ] **Step 3: Wire into `run_claude`**

Edit `ADWs/runner.py`. Top of file:

```python
from ADWs.pixel_office_client import post_event as _px_emit
```

(Guard the import — runner.py is called from multiple contexts and the dashboard env var may be absent; import errors should not break runs.)

Inside `run_claude`, right after `start_time = datetime.now()`:

```python
_session_id = f"{log_name}-{_timestamp()}"
try:
    _px_emit({
        "type": "agent_started",
        "agent": agent or "main",
        "session_id": _session_id,
        "ts": datetime.now().isoformat(),
    })
except Exception:
    pass
```

Right before the final `return` of the success path (after usage is parsed):

```python
try:
    if usage:
        _px_emit({
            "type": "token_usage",
            "session_id": _session_id,
            "input_tokens": usage["input_tokens"],
            "output_tokens": usage["output_tokens"],
            "ts": datetime.now().isoformat(),
        })
    _px_emit({
        "type": "agent_stopped",
        "session_id": _session_id,
        "agent": agent or "main",
        "ts": datetime.now().isoformat(),
    })
except Exception:
    pass
```

Do the same on the timeout / exception paths so characters don't stick around forever.

- [ ] **Step 4: Tests**

Run: `uv run pytest tests/test_runner_pixel_office.py -v`
Expected: 2 tests pass.

- [ ] **Step 5: Commit**

```bash
git add ADWs/pixel_office_client.py ADWs/runner.py tests/test_runner_pixel_office.py
git commit -m "feat(pixel-office): runner emits lifecycle + token_usage events directly"
```

---

## Phase 9: Heartbeat Integration

### Task 9.1: Heartbeat dispatcher emits events

**Files:** Modify `dashboard/backend/heartbeat_dispatcher.py`

- [ ] **Step 1: Inspect the current dispatch path**

Run: `grep -n "run_claude\|subprocess\|Popen" /d/evo-nexus/dashboard/backend/heartbeat_dispatcher.py`

Locate the function that actually launches the agent (likely `_run_heartbeat` or similar).

- [ ] **Step 2: Wrap the call**

At the top of the file:

```python
try:
    from ADWs.pixel_office_client import post_event as _px_emit
except ImportError:
    _px_emit = lambda *_: None  # noqa: E731
```

Before the CLI launch:

```python
_px_emit({"type": "agent_started", "agent": heartbeat.agent, "session_id": f"hb-{run_id}", "ts": _iso_now()})
```

After:

```python
_px_emit({"type": "agent_stopped", "session_id": f"hb-{run_id}", "agent": heartbeat.agent, "ts": _iso_now()})
```

- [ ] **Step 3: Manual test**

Create a dummy heartbeat via the dashboard, enable it for a 60 s interval, watch `/office` — the configured agent should pop in every tick.

- [ ] **Step 4: Commit**

```bash
git add dashboard/backend/heartbeat_dispatcher.py
git commit -m "feat(pixel-office): heartbeat runs appear in office canvas"
```

---

## Phase 10: Seat Persistence

### Task 10.1: SQLite table + GET/PUT endpoints

**Files:**
- Modify: `dashboard/backend/app.py` (migration block)
- Modify: `dashboard/backend/routes/pixel_office.py` (add `/seats`)
- Test: append to `tests/test_pixel_office_routes.py`

- [ ] **Step 1: Add migration**

Edit `dashboard/backend/app.py`. Inside the existing auto-migrate `with app.app_context():` block, before `_conn.close()`:

```python
_existing_tables_px = {row[0] for row in _cur.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()}
if "pixel_office_seats" not in _existing_tables_px:
    _cur.executescript("""
        CREATE TABLE IF NOT EXISTS pixel_office_seats (
            agent_slug TEXT PRIMARY KEY,
            seat_id TEXT NOT NULL,
            palette INTEGER NOT NULL,
            hue_shift INTEGER NOT NULL DEFAULT 0,
            updated_at TEXT NOT NULL
        );
    """)
    _conn.commit()
```

- [ ] **Step 2: Routes**

Append to `dashboard/backend/routes/pixel_office.py`:

```python
import sqlite3
from datetime import datetime, timezone


def _db_path() -> str:
    from flask import current_app
    return current_app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")


@bp.get("/seats")
def list_seats():
    conn = sqlite3.connect(_db_path())
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT agent_slug, seat_id, palette, hue_shift FROM pixel_office_seats"
    ).fetchall()
    conn.close()
    return jsonify({
        "seats": [
            {"agent_slug": r[0], "seat_id": r[1], "palette": r[2], "hue_shift": r[3]}
            for r in rows
        ]
    })


@bp.put("/seats")
def put_seats():
    data = request.get_json(silent=True) or {}
    items = data.get("seats", [])
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(_db_path())
    cur = conn.cursor()
    for item in items:
        slug = item.get("agent_slug")
        if not slug: continue
        cur.execute("""
            INSERT INTO pixel_office_seats (agent_slug, seat_id, palette, hue_shift, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT(agent_slug) DO UPDATE SET
              seat_id=excluded.seat_id, palette=excluded.palette,
              hue_shift=excluded.hue_shift, updated_at=excluded.updated_at
        """, (slug, item.get("seat_id", ""), int(item.get("palette", 0)), int(item.get("hue_shift", 0)), now))
    conn.commit()
    conn.close()
    return jsonify({"ok": True})
```

- [ ] **Step 3: Tests**

Append to `tests/test_pixel_office_routes.py`:

```python
def test_seats_roundtrip(client):
    client.put("/api/pixel-office/seats", json={"seats": [
        {"agent_slug": "apex-architect", "seat_id": "seat-12", "palette": 3, "hue_shift": 45}
    ]})
    r = client.get("/api/pixel-office/seats")
    data = r.get_json()
    assert any(s["agent_slug"] == "apex-architect" and s["seat_id"] == "seat-12" for s in data["seats"])
```

- [ ] **Step 4: Frontend wiring**

In `pages/Office/index.tsx` `useEffect`, after state init, fetch `/api/pixel-office/seats` and call `os.reassignSeat(charId, seatId)` once characters exist. On window unload or seat change, PUT the current mapping.

Implementation detail (do in 3 sub-steps):
- Load: `const r = await fetch('/api/pixel-office/seats'); const {seats} = await r.json();` — stash in ref
- After `agent_started` reducer call, if roster has a saved seat, call `os.reassignSeat(id, seats[agent_slug])`
- Expose `PUT` on unmount.

- [ ] **Step 5: Commit**

```bash
git add dashboard/backend/app.py dashboard/backend/routes/pixel_office.py tests/test_pixel_office_routes.py dashboard/frontend/src/pages/Office
git commit -m "feat(pixel-office): persist seat + palette per agent slug"
```

---

## Phase 11: Roster Sidebar

### Task 11.1: Left panel listing all agents with live status

**Files:** Create `dashboard/frontend/src/pages/Office/RosterPanel.tsx`, modify `Office/index.tsx`

- [ ] **Step 1: Build the panel**

```tsx
import { useEffect, useState } from 'react';
import { paletteForAgent, labelColorForAgent } from '../../pixel-office/agentIdentity.js';
import type { OfficeState } from '../../pixel-office/engine/officeState.js';

interface RosterEntry { name: string; description: string; color: string; slug: string; }

export function RosterPanel({
  officeState,
  onSelect,
}: {
  officeState: OfficeState;
  onSelect: (agentId: number | null) => void;
}) {
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    fetch('/api/pixel-office/roster')
      .then(r => r.json())
      .then(d => setRoster(d.agents ?? []));
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Map slug → character to compute status
  const active = new Set<string>();
  for (const ch of officeState.characters.values()) {
    if (ch.folderName) active.add(ch.folderName);
  }
  void tick;

  return (
    <aside className="w-64 border-r border-slate-800 overflow-y-auto bg-[#0C111D]">
      <header className="px-4 py-3 text-xs uppercase tracking-wide text-slate-400">
        Agents ({roster.length})
      </header>
      <ul className="px-2 space-y-0.5">
        {roster.map(a => {
          const isActive = active.has(a.slug);
          const dot = isActive ? '#22c55e' : '#475569';
          return (
            <li
              key={a.slug}
              onClick={() => {
                for (const [id, ch] of officeState.characters)
                  if (ch.folderName === a.slug) { onSelect(id); return; }
              }}
              className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-slate-800 cursor-pointer text-sm"
            >
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: dot }} />
              <span className="flex-1 text-slate-200 truncate">{a.name}</span>
              <span className="inline-block w-2 h-2 rounded-full" style={{ background: labelColorForAgent(a.color) }} />
            </li>
          );
        })}
      </ul>
    </aside>
  );
}
```

- [ ] **Step 2: Mount in page**

Edit `pages/Office/index.tsx`:

```tsx
<div className="flex flex-1 min-h-0">
  <RosterPanel officeState={osRef.current} onSelect={(id) => { osRef.current!.selectedAgentId = id; osRef.current!.cameraFollowId = id; }} />
  <div className="flex-1 relative">
    <OfficeCanvasLite … />
    <ToolOverlay … />
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add dashboard/frontend/src/pages/Office
git commit -m "feat(pixel-office): roster sidebar listing all agents with live status"
```

---

## Phase 12: WebSocket Authentication

Purpose: the existing `auth_middleware` passes all `/ws/*` through — the handler must authenticate. Protect `/ws/pixel-office` so only logged-in dashboard users connect.

### Task 12.1: Session-cookie auth on the WS handler

**Files:** Modify `dashboard/backend/routes/pixel_office.py`

- [ ] **Step 1: Read how the dashboard authenticates WS elsewhere**

Run: `grep -rn "sock.route\|@sock.route" dashboard/backend/ | head`

If the terminal server already has a WS auth pattern, mirror it. Flask-Login exposes the session cookie; `current_user.is_authenticated` should work inside the WS handler if the handshake carried the cookie.

- [ ] **Step 2: Enforce auth**

Edit the WS route:

```python
from flask_login import current_user

@sock.route("/ws/pixel-office")
def ws_stream(ws):
    if not current_user.is_authenticated:
        # also accept DASHBOARD_API_TOKEN bearer via query string for CLI tools
        token_qs = request.args.get("token", "")
        expected = os.environ.get("DASHBOARD_API_TOKEN", "").strip()
        if not (token_qs and expected and secrets.compare_digest(token_qs, expected)):
            ws.close(code=4401, reason="unauthorized")
            return
    q = bus.subscribe()
    try:
        while True:
            ws.send(json.dumps(q.get()))
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
```

- [ ] **Step 3: Tests**

Add to `tests/test_pixel_office_routes.py`:

```python
def test_ws_rejects_unauthenticated(client):
    # Flask-Sock provides a synchronous test client via flask_sock.test
    # If not available in this repo, document the manual smoke check instead.
    r = client.get("/ws/pixel-office")  # without upgrade — will 400 but not 200
    assert r.status_code != 200
```

If the repo has no WS test client, document the manual smoke check: `wscat -c ws://localhost:8080/ws/pixel-office` unauthenticated should close with code 4401; with a valid session cookie, it should stay open.

- [ ] **Step 4: Commit**

```bash
git add dashboard/backend/routes/pixel_office.py tests/test_pixel_office_routes.py
git commit -m "feat(pixel-office): require auth on /ws/pixel-office (session cookie or bearer token)"
```

---

## Phase 13: Docker & Production

### Task 13.1: Dockerfile parity

**Files:** Modify `Dockerfile.dashboard`, verify build output

- [ ] **Step 1: Inspect current Dockerfile.dashboard**

Run: `cat Dockerfile.dashboard`. Identify the step that runs `npm run build` and copies `dist/`.

- [ ] **Step 2: Ensure public assets are in the build**

Vite copies `public/` into `dist/` by default, so `public/pixel-office/*` ships automatically. Verify:

```bash
docker build -f Dockerfile.dashboard -t evonexus-dash:office .
docker run --rm evonexus-dash:office ls /app/dashboard/frontend/dist/pixel-office/
```

Expected: `characters.png` and `manifest.json`.

- [ ] **Step 3: Environment vars in compose files**

Edit `docker-compose.yml` — add under the dashboard service env:

```yaml
environment:
  EVONEXUS_DASHBOARD_URL: http://dashboard:8080
  PIXEL_OFFICE_HOOK_TOKEN: ${PIXEL_OFFICE_HOOK_TOKEN:-}
```

Repeat for `docker-compose.hub.yml` and `evonexus.stack.yml`.

- [ ] **Step 4: Update `.env.example`**

Append:

```
# Shared secret for pixel-office hook ingestion. Generate with: openssl rand -hex 32
PIXEL_OFFICE_HOOK_TOKEN=
```

- [ ] **Step 5: Commit**

```bash
git add Dockerfile.dashboard docker-compose.yml docker-compose.hub.yml evonexus.stack.yml .env.example
git commit -m "chore(pixel-office): ship sprite assets in Docker build, expose hook token env"
```

---

## Phase 14: Final Polish & Sign-Off

### Task 14.1: Empty-state copy, metrics bar, theme

**Files:** Modify `pages/Office/index.tsx`

- [ ] **Step 1: Metrics bar**

Above the canvas, add a small strip:

```tsx
<div className="h-10 flex items-center gap-4 px-4 text-xs text-slate-400 border-b border-slate-800">
  <span>{officeState.characters.size} agent(s) online</span>
  <span>{totalInputTokens.toLocaleString()} in · {totalOutputTokens.toLocaleString()} out tokens</span>
  <span className={wsConnected ? 'text-emerald-400' : 'text-amber-400'}>
    {wsConnected ? '● live' : '○ reconnecting'}
  </span>
</div>
```

Compute `totalInputTokens`/`totalOutputTokens` by iterating `officeState.characters` each render (throttle to 1 Hz with a `tick` state if needed).

- [ ] **Step 2: Empty-state**

When `officeState.characters.size === 0`, overlay:

```tsx
<div className="absolute inset-0 flex items-center justify-center pointer-events-none">
  <div className="text-slate-500 text-sm">Office is quiet. Trigger an agent to see them at work.</div>
</div>
```

- [ ] **Step 3: Theme**

Match the existing dashboard palette (`bg-[#0C111D]`, slate text). Already mostly aligned; just verify no hard-coded whites/blacks broke theme.

- [ ] **Step 4: Accessibility**

- `canvas` gets `role="img"` + `aria-label="Animated agent workspace"`.
- Roster `li` gets `role="button" tabIndex={0} onKeyDown=(Enter/Space)`.

- [ ] **Step 5: Commit**

```bash
git add dashboard/frontend/src/pages/Office
git commit -m "feat(pixel-office): metrics bar, empty-state, a11y roles"
```

---

### Task 14.2: Full regression

- [ ] **Step 1: Backend tests**

Run: `uv run pytest tests/ -v`
Expected: all green; no regressions in unrelated test files.

- [ ] **Step 2: Frontend tests**

Run: `cd dashboard/frontend && npx vitest run && npm run build`
Expected: all tests pass, production build succeeds, `dist/pixel-office/` populated.

- [ ] **Step 3: Manual acceptance**

Run a real Claude Code session in the workspace that invokes sub-agents and tools. Confirm:

- Characters spawn with stable palettes per slug (reload keeps same colors).
- Sub-agents appear next to parents during `Agent` tool calls, despawn on return.
- Tool icons float above active characters.
- Name labels always visible.
- Seat persists across refresh.
- Roster panel mirrors real-time status.
- `/office` respects login (`/login` redirect when logged out).
- Metrics bar shows sane numbers.
- Docker build serves the page correctly.

- [ ] **Step 4: Commit any last fixes**

```bash
git add -A && git commit -m "chore(pixel-office): regression sweep" || echo "nothing to commit"
```

---

---

## Phase 15: Multi-Source Event Integration

Phase 8 covers `ADWs/runner.py::run_claude`. Phase 9 covers heartbeat dispatcher. But evo-nexus has at least three other paths that spawn agents and currently bypass our emission:

1. `dashboard/backend/routes/triggers.py::_execute_trigger` line 471 — calls `run_claude` (auto-covered) **and** `subprocess.run` directly at line 527 for the `script` action_type (NOT covered).
2. `dashboard/backend/routes/tasks.py::_execute_task` line 170 — same pattern; line 227 has direct `subprocess.run` for script tasks.
3. `dashboard/terminal-server/src/claude-bridge.js` — Node service spawning Claude for interactive terminals; never touches Python.

### Task 15.1: Trigger script-path emission

**Files:** Modify `dashboard/backend/routes/triggers.py`

- [ ] **Step 1:** Locate `_execute_trigger` script branch (around line 527). Wrap the `subprocess.run(...)` with:
  ```python
  from ADWs.pixel_office_client import post_event as _px_emit  # safe — no-op if env missing
  _session_id = f"trigger-{trigger.id}-{execution_id}"
  _px_emit({"type":"agent_started","agent":trigger.action_target or "script","session_id":_session_id,"ts":datetime.now(timezone.utc).isoformat()})
  try:
      proc = subprocess.run(...)
  finally:
      _px_emit({"type":"agent_stopped","session_id":_session_id,"agent":trigger.action_target or "script","ts":datetime.now(timezone.utc).isoformat()})
  ```
- [ ] **Step 2:** Add a regression test that mocks `subprocess.run` and verifies `post_event` is called twice.
- [ ] **Step 3:** Commit `feat(pixel-office): trigger script executions emit office events`.

### Task 15.2: Scheduled task script-path emission

**Files:** Modify `dashboard/backend/routes/tasks.py`

Same pattern as 15.1 but for `_execute_task`. Use `_session_id = f"task-{task_id}"`.

Commit `feat(pixel-office): scheduled task executions emit office events`.

### Task 15.3: Terminal-server Node bridge emission

**Files:** Modify `dashboard/terminal-server/src/claude-bridge.js`, optionally add `dashboard/terminal-server/src/pixel-office-client.js`.

- [ ] **Step 1:** Read `claude-bridge.js` and `chat-bridge.js` to find the Claude spawn point (likely a `child_process.spawn(...)`).
- [ ] **Step 2:** Create `pixel-office-client.js`:
  ```js
  const http = require('node:http');
  function postEvent(payload) {
    try {
      const url = new URL(process.env.EVONEXUS_DASHBOARD_URL || 'http://127.0.0.1:8080');
      const req = http.request({
        host: url.hostname, port: url.port, path: '/api/pixel-office/hook',
        method: 'POST',
        headers: { 'Content-Type': 'application/json',
                   ...(process.env.PIXEL_OFFICE_HOOK_TOKEN ? { 'X-Hook-Token': process.env.PIXEL_OFFICE_HOOK_TOKEN } : {}) },
        timeout: 1500,
      });
      req.on('error', () => {}); req.on('timeout', () => req.destroy());
      req.write(JSON.stringify(payload)); req.end();
    } catch { /* swallow */ }
  }
  module.exports = { postEvent };
  ```
- [ ] **Step 3:** In `claude-bridge.js`, on spawn: `postEvent({type:'agent_started', agent: agentName, session_id: terminalSessionId, ts: new Date().toISOString()})`. On exit: `agent_stopped`.
- [ ] **Step 4:** Test by opening an agent terminal in the dashboard — character should appear in `/office`.
- [ ] **Step 5:** Commit `feat(pixel-office): terminal-server emits office events for interactive sessions`.

---

## Phase 16: Permissions, RBAC & Privacy

The dashboard has a Role model with `agent_access_json` (`{"mode": "all"|"none"|"allowlist", "agents": [...]}`) and `permissions_json` per resource. `agents.view` gates listing; `agents.manage` gates editing.

### Task 16.1: Reuse `/api/agents` for the roster (drop the duplicate)

**Files:** Modify `dashboard/backend/routes/pixel_office.py`, `dashboard/frontend/src/pages/Office/RosterPanel.tsx`, `eventReducer.ts`.

- [ ] **Step 1:** Delete the `/api/pixel-office/roster` endpoint added in Phase 1.3. Update tests.
- [ ] **Step 2:** Frontend uses `/api/agents` (which already returns `name/description/color/locked/model`). The `locked` flag means the current user has no `agent_access` for that agent.
- [ ] **Step 3:** In RosterPanel, render locked agents in slate at the bottom of the list, non-clickable. Don't expect them to ever appear in the office (they get filtered server-side).
- [ ] **Step 4:** Commit `refactor(pixel-office): reuse /api/agents for roster, drop pixel-office/roster`.

### Task 16.2: Server-side WS event filtering

**Files:** Modify `dashboard/backend/routes/pixel_office.py`, `dashboard/backend/pixel_office_bus.py`.

- [ ] **Step 1:** Per-subscriber filter: `bus.subscribe(filter_fn=None)` accepts an optional predicate `(event, allowed_slugs) → bool`. The WS handler builds `allowed_slugs` from `current_user.role.agent_access` once at connect; passes the filter.
- [ ] **Step 2:** In `publish()`, after building the event, run each subscriber's filter; only enqueue if it passes.
- [ ] **Step 3:** Concurrency-safe tests: subscribe two subscribers with different allowlists, publish 10 events, assert each got the right subset.
- [ ] **Step 4:** Snapshot endpoint also filters: `bus.snapshot(allowed_slugs)`.
- [ ] **Step 5:** Commit `feat(pixel-office): per-user RBAC filtering on WS events and snapshot`.

### Task 16.3: Sanitise `waiting_input` payloads

**Files:** Modify `dashboard/backend/routes/pixel_office.py` (hook ingestion).

- [ ] **Step 1:** Strip `message` field from `waiting_input` events before publishing — only the bubble icon matters; the prompt text could leak sensitive data to viewers without `agents.manage`.
- [ ] **Step 2:** When `current_user.role` has `agents.manage`, allow the unredacted version to flow (use a separate event type `waiting_input_full` filtered to managers only).
- [ ] **Step 3:** Tests verifying reader-role sees redacted, manager sees full.
- [ ] **Step 4:** Commit `feat(pixel-office): sanitise waiting_input prompts for non-managers`.

### Task 16.4: Audit log on seat reassignment

Use existing `models.audit(actor, action, resource, payload)` helper in the seats PUT endpoint. Action `pixel_office.seat_reassigned`. Commit `feat(pixel-office): audit log seat reassignments`.

---

## Phase 17: Performance & Scale

### Task 17.1: Character cap + overflow indicator

**Files:** Modify `pages/Office/index.tsx`, `pixel-office/engine/officeState.ts` (small extension).

- [ ] **Step 1:** Define `MAX_VISIBLE_CHARACTERS = 50` in constants.
- [ ] **Step 2:** Reducer maintains a hidden queue once the cap is hit. Show "+N agents queued" overlay when cap hit.
- [ ] **Step 3:** When a character despawns, dequeue the next.
- [ ] **Step 4:** Tests verify overflow indicator + dequeue.
- [ ] **Step 5:** Commit `feat(pixel-office): cap visible characters and show overflow indicator`.

### Task 17.2: Tab visibility throttling

**Files:** Modify `pixel-office/engine/gameLoop.ts` or `OfficeCanvasLite`.

- [ ] **Step 1:** Listen on `document.visibilitychange`. When `document.hidden`, drop the gameLoop frame rate from 60→4 fps; restore on visibility.
- [ ] **Step 2:** Commit `perf(pixel-office): throttle gameLoop when tab is hidden`.

### Task 17.3: Bus back-pressure metrics

**Files:** Modify `dashboard/backend/pixel_office_bus.py`.

- [ ] **Step 1:** Add counters: `dropped_events`, `slow_subscribers`, exposed via `bus.stats()`.
- [ ] **Step 2:** Used by Phase 19 metrics endpoint.
- [ ] **Step 3:** Commit `feat(pixel-office): bus exposes back-pressure stats`.

---

## Phase 18: SSE & Polling Enrichment

### Task 18.1: SSE endpoint as third transport

Some corporate networks block WS but allow SSE. Add `/sse/pixel-office` returning `text/event-stream`.

**Files:** Modify `dashboard/backend/routes/pixel_office.py`, frontend `usePixelOfficeSocket.ts`.

- [ ] **Step 1:** Endpoint subscribes to bus, yields `data: {json}\n\n` per event. Auth via session cookie or `?token=` query param.
- [ ] **Step 2:** Frontend tries WS first; on close after 3 retries, switches to `EventSource('/sse/pixel-office')`. Polling becomes the third tier.
- [ ] **Step 3:** Tests: mock `WebSocket = undefined` in jsdom and verify SSE path.
- [ ] **Step 4:** Commit `feat(pixel-office): SSE fallback when WebSocket is blocked`.

### Task 18.2: Enrich `/api/agents/active`

**Files:** Modify `dashboard/backend/app.py` (the existing `/api/agents/active` route reads `agent-status.json`).

- [ ] **Step 1:** Replace the implementation with `bus.snapshot()` filtered to last 10 minutes. Backward-compatible response shape.
- [ ] **Step 2:** Add `session_id` field to each entry.
- [ ] **Step 3:** Update polling fallback in `usePixelOfficeSocket.ts` to use the new field.
- [ ] **Step 4:** Commit `refactor(pixel-office): /api/agents/active reads from bus snapshot`.

---

## Phase 19: Observability

### Task 19.1: `/api/pixel-office/metrics` endpoint

**Files:** Modify `dashboard/backend/routes/pixel_office.py`.

- [ ] **Step 1:** Returns JSON:
  ```json
  {
    "subscribers": 3,
    "events_published_total": 12345,
    "events_dropped_total": 2,
    "queue_depths": [12, 0, 1],
    "replay_buffer_size": 50,
    "uptime_seconds": 3600
  }
  ```
- [ ] **Step 2:** Optional Prometheus exposition at `/api/pixel-office/metrics?format=prometheus` if `EVONEXUS_PROMETHEUS=1`.
- [ ] **Step 3:** Commit `feat(pixel-office): expose runtime metrics for the bus`.

### Task 19.2: Frontend debug overlay

**Files:** Modify `pages/Office/index.tsx`, add `pages/Office/DebugOverlay.tsx`.

- [ ] **Step 1:** When `?debug=1` query param: show floating panel with FPS (from gameLoop), event lag (now − last event ts), character count, WS state.
- [ ] **Step 2:** Commit `feat(pixel-office): debug overlay (?debug=1) shows FPS + event lag`.

---

## Phase 20: E2E Tests (Playwright)

### Task 20.1: Playwright setup + first spec

**Files:** Create `dashboard/frontend/e2e/playwright.config.ts`, `dashboard/frontend/e2e/office.spec.ts`.

- [ ] **Step 1:** `npm i -D @playwright/test` in `dashboard/frontend`. Add `e2e:install` and `e2e` scripts in `package.json`.
- [ ] **Step 2:** Config targets the running dashboard at `http://localhost:8080`. Reuses an existing test user (created in setup).
- [ ] **Step 3:** Specs:
  - `office-empty.spec.ts`: login → navigate `/office` → assert canvas present, no characters.
  - `office-spawn.spec.ts`: login → POST `/api/pixel-office/hook` with `agent_started` → wait for character → assert canvas pixel non-empty around expected coords (use `toHaveScreenshot()` baseline).
  - `office-rbac.spec.ts`: login as user with `agents.view = false` → `/office` redirects to `/`.
  - `office-reconnect.spec.ts`: kill backend mid-session → frontend shows `○ reconnecting`. Restart → `● live`.
- [ ] **Step 4:** Add `playwright` step to CI (Phase 23).
- [ ] **Step 5:** Commit `test(pixel-office): Playwright e2e suite covering empty/spawn/rbac/reconnect`.

---

## Phase 21: Resilience UI

### Task 21.1: ErrorBoundary around the canvas

**Files:** Create `dashboard/frontend/src/pages/Office/ErrorBoundary.tsx`, modify `pages/Office/index.tsx`.

- [ ] **Step 1:** Standard React class ErrorBoundary capturing render-phase exceptions; fallback UI: "The Office canvas crashed. Reload to retry. Logs: <copy button>".
- [ ] **Step 2:** Wrap `<OfficeCanvasLite />` and the asset orchestrator's loading code.
- [ ] **Step 3:** Sentry-style hook so the error can be surfaced to the existing notification system.
- [ ] **Step 4:** Commit `feat(pixel-office): ErrorBoundary keeps the dashboard alive on canvas crash`.

### Task 21.2: Responsive list-view fallback

**Files:** Modify `pages/Office/index.tsx`.

- [ ] **Step 1:** When `window.innerWidth < 720`, render only `RosterPanel` (full-width) and a banner "Pixel Office requires a wider screen". No canvas mount → no asset decode cost.
- [ ] **Step 2:** Commit `feat(pixel-office): list-view fallback for narrow screens`.

---

## Phase 22: Legacy Unification

### Task 22.1: Retire `agent-status.json` writes

The hook script writes to `.claude/agent-status.json` which the existing `/api/agents/active` reads. Once Phase 18.2 lands, the JSON file is dead code.

**Files:** Modify `.claude/hooks/agent-tracker.sh`.

- [ ] **Step 1:** Remove the JSON-writing branch from the hook. Keep only the HTTP POST.
- [ ] **Step 2:** Update `/api/agents/active` (already done in 18.2).
- [ ] **Step 3:** Manual smoke: delete `.claude/agent-status.json` → ensure `/api/agents/active` still works (now sourced from bus).
- [ ] **Step 4:** Commit `chore(pixel-office): retire .claude/agent-status.json file in favour of bus snapshot`.

---

## Phase 23: Build, Migrations & CI

### Task 23.1: Alembic migration for `pixel_office_seats`

The Phase 10 migration is raw SQL inside `app.py`'s startup. Promote to a proper alembic revision so the schema change is tracked.

**Files:** Create `dashboard/backend/alembic/versions/<rev>_pixel_office_seats.py` (or whatever the existing alembic layout is), remove the raw SQL block from `app.py`.

- [ ] **Step 1:** `grep -rn "alembic" /d/evo-nexus/dashboard/backend/` to find the alembic config.
- [ ] **Step 2:** `alembic revision -m "add pixel_office_seats"` and fill in the upgrade/downgrade.
- [ ] **Step 3:** Remove the inline `CREATE TABLE` from `app.py`.
- [ ] **Step 4:** Test fresh DB + existing DB upgrade paths.
- [ ] **Step 5:** Commit `chore(pixel-office): alembic migration for seats table`.

### Task 23.2: Lint + typecheck CI

**Files:** Modify `.github/workflows/ci.yml` (or whatever the CI file is).

- [ ] **Step 1:** Inspect existing CI workflow.
- [ ] **Step 2:** Add jobs:
  - `pytest tests/test_pixel_office_*`
  - `cd dashboard/frontend && npm ci && npx tsc --noEmit && npx vitest run --coverage && npm run lint`
  - `cd dashboard/frontend && npx playwright install --with-deps && npx playwright test` (gated behind label `e2e` to keep PR cycle fast)
- [ ] **Step 3:** Commit `ci(pixel-office): lint, typecheck, test pixel-office on every PR`.

### Task 23.3: README + ROADMAP updates

**Files:** Modify root `README.md`, `ROADMAP.md`.

- [ ] **Step 1:** Add a "Pixel Office" subsection to the README features list with a screenshot path placeholder.
- [ ] **Step 2:** Add the feature to ROADMAP.md as completed once merged.
- [ ] **Step 3:** Commit `docs(pixel-office): mention feature in README and ROADMAP`.

---

## PR Workflow (DO NOT EXECUTE UNTIL USER EXPLICITLY ASKS)

The user has asked to hold off on the PR until manual testing is complete.
When green-lit:

1. Ensure the working tree is clean and `git log --oneline origin/develop..HEAD` shows a clean story of atomic commits.
2. Confirm the user has a fork of `EvolutionAPI/evo-nexus` on their GitHub account.
3. Add the fork as a second remote: `git remote add fork git@github.com:<user>/evo-nexus.git`.
4. Push: `git push -u fork feat/pixel-office`.
5. Open PR from `<user>:feat/pixel-office` → `EvolutionAPI:develop`.
6. PR body sections: summary, screenshots, test plan, licence attribution, breaking-change callouts (none expected).

---

## Self-Review Checklist (v2)

- **Spec coverage**:
  - Goal "visualise agents in pixel-art" → Phases 2 (harvest), 3 (state mapping), 4 (page) are the core. Phases 6 (visual identity), 11 (roster), 14 (polish) raise the bar from MVP to production.
  - Realistic compatibility assessment → confirmed locally: flask-sock present, React 19 + Vite + Tailwind v4 match, `/api/agents` already exists with RBAC, `.claude/hooks/agent-tracker.sh` already exists, dashboard already serves `dashboard/frontend/dist/`, `/workspace` route is taken so we use `/office`.
  - Deep gaps surfaced in v2 review: full asset pipeline (Phase 2.5–2.7), browser-side PNG decoder (no extension host), snapshot endpoint (3.3), multi-source emission (Phase 15), RBAC at WS subscriber level (Phase 16), performance/scale (17), SSE fallback (18), observability (19), e2e Playwright (20), error boundary + responsive (21), legacy unification (22), alembic + CI (23).
  - PR workflow deferred until manual user sign-off.

- **Placeholders**: None left except `<rev>` in alembic filename (Task 23.1) which alembic itself fills in.

- **Type consistency** across Python ↔ TypeScript ↔ Bash:
  - Event field names: `type`, `agent`, `session_id`, `tool`, `ts`, `parent_session_id`, `parent_tool_id`, `subagent_type`, `input_tokens`, `output_tokens`, `message`. Defined once in `pixel_office_events.py`, mirrored in `eventReducer.ts` union type.
  - Method names on `OfficeState` referenced in plan: `addAgent(id, palette?, hueShift?, seatId?, skipSpawn?, folderName?)`, `removeAgent`, `setAgentActive`, `setAgentTool`, `showPermissionBubble`, `dismissBubble`, `setAgentTokens`, `addSubagent(parent, toolId)`, `removeSubagent`, `reassignSeat`, `getCharacterAt` — all confirmed against the harvested `officeState.ts`.
  - Asset pipeline contract: `setCharacterTemplates`, `setFloorSprites`, `setWallSprites`, `buildDynamicCatalog` are the four engine entry points; orchestrator calls all four after decode.

- **Scope discipline**: still excluded — in-browser furniture editor, drag-to-move, audio cues. Everything else (sub-agents, seats, runner emission, heartbeat, trigger/task/terminal-server emission, RBAC, perf, SSE, metrics, Playwright, ErrorBoundary, responsive, alembic, CI, README) is in scope.

- **Open assumptions worth validating during execution**:
  1. Vitest's jsdom environment may lack `OffscreenCanvas`. Plan-B is to gate browser-decoder unit tests behind Playwright (Phase 20) rather than vitest. Acceptance: if `npx vitest run` skips/errors on canvas tests, mark them `it.skip` with a comment pointing to Phase 20 e2e.
  2. The pixel-agents `flattenManifest` helper in `manifestUtils.ts` is harvested in Phase 2.1 but used in Phase 2.7. Confirm during 2.7 that no Node-only API leaked through.
  3. `terminal-server/src/claude-bridge.js` may already track sessions in its own `session-store.js`. Phase 15.3 should reuse that session id rather than fabricate a new one.
  4. RBAC `agent_access_json` allowlist filtering at WS level (Phase 16.2) needs a re-evaluation when a role changes mid-session — currently the filter is captured at connect. Acceptable for v1; document the limitation.

- **Effort estimate (v2 plan)**: original 14-phase plan ≈ 2 weeks of focused engineering. v2 with 23 phases ≈ 3.5–4 weeks. Asset pipeline (2.5–2.7) alone is ~3 days. RBAC + SSE + observability + Playwright are another ~5 days. The new ceiling is "production-ready, not MVP" exactly as the user requested.
