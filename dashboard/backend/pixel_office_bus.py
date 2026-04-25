"""Thread-safe in-memory pub/sub bus for pixel-office events.

Subscribers receive events via a bounded thread.Queue. When a subscriber's
queue is full we drop its oldest entry rather than block the publisher — a
slow WebSocket client must never stall the hook POST handler.

Late-joining subscribers receive the last `replay_size` events so the canvas
can reconstruct state without a full history dump.

The bus also maintains a `_sessions` map (session_id → last-known state) so
late-joining clients can fetch a full snapshot via /api/pixel-office/snapshot
without replaying the entire event log.
"""
from __future__ import annotations

import copy
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
        self._sessions: dict[str, dict[str, Any]] = {}

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

    def _update_sessions(self, event: dict[str, Any]) -> None:
        """Update the session-state map based on event type. Must be called under self._lock."""
        t = event.get("type")
        sid = event.get("session_id")
        if not sid:
            return
        if t == "agent_started":
            self._sessions[sid] = {
                "agent": event.get("agent", "main"),
                "started_at": event.get("ts", ""),
                "tool": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "waiting": False,
            }
        elif t == "tool_started":
            if sid in self._sessions:
                self._sessions[sid]["tool"] = event.get("tool")
        elif t == "tool_finished":
            if sid in self._sessions:
                self._sessions[sid]["tool"] = None
        elif t == "waiting_input":
            if sid in self._sessions:
                self._sessions[sid]["waiting"] = True
        elif t == "token_usage":
            if sid in self._sessions:
                self._sessions[sid]["input_tokens"] = int(event.get("input_tokens", 0))
                self._sessions[sid]["output_tokens"] = int(event.get("output_tokens", 0))
        elif t == "agent_stopped":
            self._sessions.pop(sid, None)

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._update_sessions(event)
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

    def snapshot(self) -> dict[str, dict[str, Any]]:
        """Return a deep-copy of the current session map. Safe for concurrent reads."""
        with self._lock:
            return copy.deepcopy(self._sessions)


# Module-level singleton used by routes + hook endpoint
bus = PixelOfficeBus()
