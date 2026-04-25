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
    SUBAGENT_STARTED = "subagent_started"   # Agent tool launched a sub-agent
    SUBAGENT_FINISHED = "subagent_finished"  # Agent tool sub-agent completed


_REQUIRED = {
    EventType.AGENT_STARTED: {"agent", "session_id"},
    EventType.AGENT_STOPPED: {"session_id"},
    EventType.TOOL_STARTED: {"session_id", "tool"},
    EventType.TOOL_FINISHED: {"session_id", "tool"},
    EventType.WAITING_INPUT: {"session_id"},
    EventType.NOTIFICATION: {"message"},
    EventType.TOKEN_USAGE: {"session_id", "input_tokens", "output_tokens"},
    EventType.SUBAGENT_STARTED: {"parent_session_id", "parent_tool_id", "subagent_type"},
    EventType.SUBAGENT_FINISHED: {"parent_session_id", "parent_tool_id"},
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
