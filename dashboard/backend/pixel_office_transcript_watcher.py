"""Tail Claude Code's JSONL transcript files and emit rich pixel-office events.

The Claude Code CLI writes a JSONL file per session at
``~/.claude/projects/<encoded-cwd>/<session-uuid>.jsonl`` (and one per
sub-agent under ``.../<session-uuid>/subagents/agent-<id>.jsonl``). Each
line is one of:

* ``{"type": "assistant", "message": {"content": [...], "usage": {...}}}``
* ``{"type": "user", "message": {"content": [...]}}``  (tool_result lives here)
* ``{"type": "system" | "summary" | other}``

This watcher polls those files at 500 ms intervals, tracks per-file read
offsets, parses incremental JSONL, and publishes pixel-office events with
**rich tool status text** ("Reading config.py", "Running: npm test", etc.) —
something the bash hook layer cannot produce because it only sees tool
NAMES at PreToolUse, not their arguments.

The watcher is the source of truth for "what an agent is currently doing"
when transcripts are visible to the dashboard process. Hook events still
fire and are accepted by the bus; the janitor reaps any session that has
no recent activity, so dual-channel duplicates self-clean.
"""
from __future__ import annotations

import json
import os
import re
import sys
import threading
from pathlib import Path
from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from pixel_office_bus import PixelOfficeBus


_DEFAULT_PROJECTS_DIR = Path.home() / ".claude" / "projects"
_POLL_INTERVAL_S = 0.5
_BASH_MAX = 50
_DESC_MAX = 50

# Tools that don't trigger a "permission required" prompt — used downstream.
_PERMISSION_EXEMPT = {"Task", "Agent", "AskUserQuestion"}


def _basename(p: object) -> str:
    if not isinstance(p, str):
        return ""
    # Handle both POSIX and Windows separators that may appear in transcripts.
    return p.replace("\\", "/").rsplit("/", 1)[-1]


def _truncate(s: str, n: int) -> str:
    return s if len(s) <= n else s[:n] + "…"


def format_tool_status(tool: str, inp: dict) -> str:
    """Produce the human-readable status string Claude itself uses.

    Mirrors pixel-agents/src/transcriptParser.ts::defaultFormatToolStatus so
    the office overlay shows ``Reading config.py`` instead of ``Read``.
    """
    if tool == "Read":
        return f"Reading {_basename(inp.get('file_path'))}".strip()
    if tool == "Edit":
        return f"Editing {_basename(inp.get('file_path'))}".strip()
    if tool == "Write":
        return f"Writing {_basename(inp.get('file_path'))}".strip()
    if tool == "Bash":
        cmd = inp.get("command")
        if not isinstance(cmd, str):
            cmd = ""
        return f"Running: {_truncate(cmd, _BASH_MAX)}"
    if tool == "Glob":
        return "Searching files"
    if tool == "Grep":
        return "Searching code"
    if tool == "WebFetch":
        return "Fetching web content"
    if tool == "WebSearch":
        return "Searching the web"
    if tool in ("Task", "Agent"):
        desc = inp.get("description")
        if isinstance(desc, str) and desc:
            return f"Subtask: {_truncate(desc, _DESC_MAX)}"
        return "Running subtask"
    if tool == "AskUserQuestion":
        return "Waiting for your answer"
    if tool == "EnterPlanMode":
        return "Planning"
    if tool == "NotebookEdit":
        return "Editing notebook"
    if tool == "TeamCreate":
        team = inp.get("team_name")
        if isinstance(team, str) and team:
            return f"Creating team: {team}"
        return "Creating team"
    if tool == "SendMessage":
        recipient = inp.get("recipient") or inp.get("to")
        if isinstance(recipient, str) and recipient:
            return f"→ {recipient}"
        return "Sending message"
    return f"Using {tool}"


_AGENT_NAME_RE = re.compile(r"^name:\s*([a-zA-Z0-9_-]+)\s*$", re.MULTILINE)
_SUBAGENT_FILE_RE = re.compile(r"^agent-([a-f0-9]+)\.jsonl$", re.IGNORECASE)


class TranscriptWatcher:
    """Background poller. One instance owns its own thread; safe to start once."""

    def __init__(
        self,
        bus: "PixelOfficeBus",
        projects_dir: Path | None = None,
        poll_interval_s: float = _POLL_INTERVAL_S,
    ) -> None:
        self._bus = bus
        self._projects_dir = projects_dir or _DEFAULT_PROJECTS_DIR
        self._poll_interval_s = poll_interval_s
        self._offsets: dict[str, int] = {}
        # Cache: file path -> agent slug we already inferred / published
        self._known_agent: dict[str, str] = {}
        # Track which session_ids we've already announced, so we don't spam
        # agent_started repeatedly.
        self._announced: set[str] = set()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is not None and self._thread.is_alive():
            return
        self._stop.clear()
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="pixel-office-transcript"
        )
        self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    # ── Polling loop ──────────────────────────────────────────────────────

    def _loop(self) -> None:
        while not self._stop.is_set():
            try:
                self._scan_once()
            except Exception as exc:  # never let one bad cycle kill the thread
                print(f"[transcript-watcher] scan error: {exc!r}", file=sys.stderr)
            self._stop.wait(self._poll_interval_s)

    def _scan_once(self) -> None:
        if not self._projects_dir.is_dir():
            return
        # Walk all *.jsonl files under projects/
        for jsonl in self._projects_dir.rglob("*.jsonl"):
            self._read_new_lines(jsonl)

    def _read_new_lines(self, path: Path) -> None:
        key = str(path)
        try:
            size = path.stat().st_size
        except OSError:
            return
        offset = self._offsets.get(key, 0)
        if size == offset:
            return
        if size < offset:
            # File was truncated / rotated — restart from the beginning.
            offset = 0
        try:
            with open(path, "rb") as fh:
                fh.seek(offset)
                data = fh.read(size - offset)
        except OSError:
            return
        # Only emit complete lines; remember partial-line tail offset.
        text = data.decode("utf-8", errors="replace")
        last_nl = text.rfind("\n")
        if last_nl < 0:
            return  # nothing complete yet
        complete = text[: last_nl + 1]
        # Advance offset by exact byte-length of complete portion.
        self._offsets[key] = offset + len(complete.encode("utf-8"))

        session_id = self._session_id_for(path)
        agent = self._agent_for(path, session_id)
        for line in complete.splitlines():
            if not line.strip():
                continue
            try:
                self._process_line(session_id, agent, path, line)
            except Exception as exc:
                print(
                    f"[transcript-watcher] line error in {path.name}: {exc!r}",
                    file=sys.stderr,
                )

    # ── Session + agent identity ──────────────────────────────────────────

    def _session_id_for(self, path: Path) -> str:
        """Use the file stem as session_id. Subagents get their own ids
        because Claude writes them under .../<parent>/subagents/agent-<x>.jsonl
        and parses them as independent sessions."""
        return path.stem

    def _agent_for(self, path: Path, session_id: str) -> str:
        cached = self._known_agent.get(str(path))
        if cached:
            return cached

        # Subagent file: agent-<hexid>.jsonl — give it a generic name
        # (real subagent slug isn't in the filename; it's in the parent's
        # tool_use record. We could correlate later if needed.)
        m = _SUBAGENT_FILE_RE.match(path.name)
        if m:
            agent = "subagent"
            self._known_agent[str(path)] = agent
            return agent

        # Top-level session — try to read first ~10 lines to find an agent
        # slug in the system prompt or settings. Fall back to "main".
        agent = self._infer_agent_from_head(path) or "main"
        self._known_agent[str(path)] = agent
        return agent

    def _infer_agent_from_head(self, path: Path) -> str | None:
        """Best-effort agent-slug detection from the first few JSONL records."""
        try:
            with open(path, "r", encoding="utf-8", errors="replace") as fh:
                for _ in range(10):
                    line = fh.readline()
                    if not line:
                        break
                    try:
                        rec = json.loads(line)
                    except Exception:
                        continue
                    # Some Claude writes include {"agent": "<slug>"} in summary
                    a = rec.get("agent")
                    if isinstance(a, str) and a:
                        return a
                    # System prompt may carry "name: <slug>" YAML-style header
                    msg = rec.get("message") or {}
                    content = msg.get("content")
                    if isinstance(content, list):
                        for block in content:
                            if (
                                isinstance(block, dict)
                                and block.get("type") == "text"
                            ):
                                m = _AGENT_NAME_RE.search(str(block.get("text", "")))
                                if m:
                                    return m.group(1)
        except OSError:
            return None
        return None

    # ── Per-line processing ───────────────────────────────────────────────

    def _ensure_session_announced(self, session_id: str, agent: str) -> None:
        if session_id in self._announced:
            return
        # Check whether the bus already knows about this session via hook
        # events; if so we don't need to announce, but it's cheap to publish
        # because publish() updates last_event_at and is idempotent on
        # session map shape.
        try:
            snap = self._bus.snapshot()
        except Exception:
            snap = {}
        if session_id not in snap:
            self._bus.publish({
                "type": "agent_started",
                "agent": agent,
                "session_id": session_id,
                "ts": "",
            })
        self._announced.add(session_id)

    def _process_line(
        self, session_id: str, agent: str, path: Path, line: str
    ) -> None:
        try:
            record = json.loads(line)
        except Exception:
            return
        rtype = record.get("type")
        if rtype == "assistant":
            self._process_assistant(session_id, agent, record)
        elif rtype == "user":
            self._process_user(session_id, agent, record)

    def _process_assistant(self, session_id: str, agent: str, record: dict) -> None:
        msg = record.get("message") or {}
        content = msg.get("content", record.get("content"))
        # Token usage — emit even before we ensure session, because the
        # ensure call also publishes which would create the session entry.
        usage = msg.get("usage") or {}
        if isinstance(usage, dict) and usage:
            self._ensure_session_announced(session_id, agent)
            self._bus.publish({
                "type": "token_usage",
                "session_id": session_id,
                "input_tokens": int(usage.get("input_tokens", 0) or 0),
                "output_tokens": int(usage.get("output_tokens", 0) or 0),
                "ts": "",
            })

        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_use" and block.get("id"):
                tool_name = block.get("name") or ""
                inp = block.get("input") or {}
                status = format_tool_status(tool_name, inp if isinstance(inp, dict) else {})
                self._ensure_session_announced(session_id, agent)
                self._bus.publish({
                    "type": "tool_started",
                    "session_id": session_id,
                    "agent": agent,
                    "tool": status,  # rich status, not just the tool name
                    "ts": "",
                })

    def _process_user(self, session_id: str, agent: str, record: dict) -> None:
        msg = record.get("message") or {}
        content = msg.get("content", record.get("content"))
        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "tool_result" and block.get("tool_use_id"):
                self._ensure_session_announced(session_id, agent)
                self._bus.publish({
                    "type": "tool_finished",
                    "session_id": session_id,
                    "agent": agent,
                    "tool": "",
                    "ts": "",
                })


# ── Module-level singleton + janitor ─────────────────────────────────────

_watcher: TranscriptWatcher | None = None


def start_transcript_watcher(
    bus: "PixelOfficeBus",
    projects_dir: str | Path | None = None,
) -> TranscriptWatcher:
    """Start the watcher once. Subsequent calls return the existing instance."""
    global _watcher
    if _watcher is not None:
        return _watcher
    pd = Path(projects_dir) if projects_dir else None
    # Honour env override — useful in tests / docker-compose
    if pd is None:
        env_dir = os.environ.get("CLAUDE_PROJECTS_DIR")
        if env_dir:
            pd = Path(env_dir)
    _watcher = TranscriptWatcher(bus, projects_dir=pd)
    _watcher.start()
    print(
        f"[transcript-watcher] started (projects_dir={_watcher._projects_dir}, "
        f"poll={_watcher._poll_interval_s}s)",
        file=sys.stderr,
        flush=True,
    )
    return _watcher


def start_session_janitor(
    bus: "PixelOfficeBus",
    interval_s: int = 60,
    max_idle_s: int = 600,
) -> threading.Thread:
    """Background thread that calls ``bus.reap_stale_sessions`` every ``interval_s``.

    A session that hasn't received any event for ``max_idle_s`` is dropped
    and a synthetic ``agent_stopped`` is broadcast so the canvas removes it.
    Default 60 s sweep with 10 min idle is conservative — Claude turns can
    legitimately sit on a long Bash command for ~5 min, so 10 min is a
    safe floor.
    """
    stop = threading.Event()

    def _loop() -> None:
        while not stop.is_set():
            try:
                reaped = bus.reap_stale_sessions(max_idle_seconds=max_idle_s)
                if reaped:
                    print(
                        f"[session-janitor] reaped {len(reaped)} stale session(s): "
                        f"{', '.join(reaped[:5])}{'...' if len(reaped) > 5 else ''}",
                        file=sys.stderr,
                    )
            except Exception as exc:
                print(f"[session-janitor] error: {exc!r}", file=sys.stderr)
            stop.wait(interval_s)

    t = threading.Thread(target=_loop, daemon=True, name="pixel-office-janitor")
    t.start()
    print(
        f"[session-janitor] started (interval={interval_s}s, max_idle={max_idle_s}s)",
        file=sys.stderr,
        flush=True,
    )
    return t
