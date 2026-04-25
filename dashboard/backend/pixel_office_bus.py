"""Thread-safe in-memory pub/sub bus for pixel-office events.

Subscribers receive events via a bounded thread.Queue. When a subscriber's
queue is full we drop its oldest entry rather than block the publisher — a
slow WebSocket client must never stall the hook POST handler.

Late-joining subscribers receive the last `replay_size` events so the canvas
can reconstruct state without a full history dump.

The bus also maintains a `_sessions` map (session_id → last-known state) so
late-joining clients can fetch a full snapshot via /api/pixel-office/snapshot
without replaying the entire event log.

Per-subscriber RBAC filtering (Phase 16): subscribers may pass a `filter_fn`
predicate `(event, context) -> bool` at subscribe time. Events for which the
predicate returns ``False`` are skipped for that subscriber only — replay
buffer + dispatch + drop accounting all honour the filter. The filter is
intended to be cheap (set-membership lookup); heavy work belongs upstream.
"""
from __future__ import annotations

import copy
import queue
import threading
import time
from collections import deque
from typing import Any, Callable, Optional

# Per-subscriber filter predicate. Receives the event dict and an opaque
# `context` placeholder reserved for future use (subscriber metadata, request
# context, etc.). Returns True to deliver, False to skip.
FilterFn = Callable[[dict[str, Any], Any], bool]


class PixelOfficeBus:
    def __init__(self, max_queue: int = 500, replay_size: int = 50) -> None:
        self._lock = threading.Lock()
        self._subscribers: list[queue.Queue] = []
        self._filters: dict[int, Optional[FilterFn]] = {}
        self._max_queue = max_queue
        self._replay: deque = deque(maxlen=replay_size) if replay_size > 0 else deque(maxlen=0)
        self._sessions: dict[str, dict[str, Any]] = {}
        self._events_published: int = 0
        self._events_dropped: int = 0

    def subscribe(self, filter_fn: Optional[FilterFn] = None) -> queue.Queue:
        """Register a new subscriber.

        ``filter_fn`` is an optional predicate ``(event, context) -> bool``
        applied per-event. When ``None`` (default) the subscriber receives
        every event — backward compatible with all existing call sites.
        """
        q: queue.Queue = queue.Queue(maxsize=self._max_queue)
        with self._lock:
            self._filters[id(q)] = filter_fn
            for evt in list(self._replay):
                if filter_fn is not None and not filter_fn(evt, None):
                    continue
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
            self._filters.pop(id(q), None)

    def _update_sessions(self, event: dict[str, Any]) -> None:
        """Update the session-state map based on event type. Must be called under self._lock."""
        t = event.get("type")
        sid = event.get("session_id")
        if not sid:
            return
        now = time.time()
        if t == "agent_started":
            self._sessions[sid] = {
                "agent": event.get("agent", "main"),
                "started_at": event.get("ts", ""),
                "tool": None,
                "input_tokens": 0,
                "output_tokens": 0,
                "waiting": False,
                "last_event_at": now,
            }
        elif t == "tool_started":
            if sid in self._sessions:
                self._sessions[sid]["tool"] = event.get("tool")
                self._sessions[sid]["last_event_at"] = now
        elif t == "tool_finished":
            if sid in self._sessions:
                self._sessions[sid]["tool"] = None
                self._sessions[sid]["last_event_at"] = now
        elif t == "waiting_input":
            if sid in self._sessions:
                self._sessions[sid]["waiting"] = True
                self._sessions[sid]["last_event_at"] = now
        elif t == "token_usage":
            if sid in self._sessions:
                self._sessions[sid]["input_tokens"] = int(event.get("input_tokens", 0))
                self._sessions[sid]["output_tokens"] = int(event.get("output_tokens", 0))
                self._sessions[sid]["last_event_at"] = now
        elif t == "agent_stopped":
            self._sessions.pop(sid, None)

    def publish(self, event: dict[str, Any]) -> None:
        with self._lock:
            self._events_published += 1
            self._update_sessions(event)
            self._replay.append(event)
            dead: list[queue.Queue] = []
            for q in self._subscribers:
                # Apply per-subscriber filter (Phase 16 RBAC). A predicate
                # raising or returning False simply skips delivery for this
                # subscriber — drop counter is unaffected because the event
                # was *intentionally* withheld, not dropped under pressure.
                fn = self._filters.get(id(q))
                if fn is not None:
                    try:
                        if not fn(event, None):
                            continue
                    except Exception:
                        # A misbehaving filter must not poison the bus.
                        continue
                try:
                    q.put_nowait(event)
                except queue.Full:
                    # Drop oldest to make room
                    try:
                        q.get_nowait()
                        self._events_dropped += 1
                    except queue.Empty:
                        pass
                    try:
                        q.put_nowait(event)
                    except queue.Full:
                        dead.append(q)
            for q in dead:
                self._subscribers.remove(q)
                self._filters.pop(id(q), None)

    def snapshot(
        self, allowed_slugs: Optional[set[str]] = None
    ) -> dict[str, dict[str, Any]]:
        """Return a deep-copy of the current session map. Safe for concurrent reads.

        When ``allowed_slugs`` is provided, only sessions whose ``agent``
        appears in the set are returned. ``None`` returns everything
        (admin / unrestricted callers).
        """
        with self._lock:
            if allowed_slugs is None:
                return copy.deepcopy(self._sessions)
            return {
                sid: copy.deepcopy(info)
                for sid, info in self._sessions.items()
                if info.get("agent") in allowed_slugs
            }

    def reap_stale_sessions(self, max_idle_seconds: int = 600) -> list[str]:
        """Drop sessions that have not seen any event for ``max_idle_seconds``.

        Returns the list of session_ids that were reaped. Each reaping
        publishes a synthetic ``agent_stopped`` event so any connected
        subscriber removes the character cleanly. Default idle threshold
        is 10 minutes — long enough for a slow Claude turn, short enough
        to clear zombie sessions from network blips, aborts, or test
        traffic that never sent ``agent_stopped``.
        """
        reaped: list[str] = []
        cutoff = time.time() - max_idle_seconds
        with self._lock:
            for sid, info in list(self._sessions.items()):
                last = info.get("last_event_at", 0) or 0
                if last < cutoff:
                    reaped.append(sid)
                    self._sessions.pop(sid, None)
        # Publish stop events OUTSIDE the lock so subscribers can flow
        # through publish() naturally.
        for sid in reaped:
            self.publish({
                "type": "agent_stopped",
                "session_id": sid,
                "agent": "reaper",
                "ts": "",
            })
        return reaped

    def clear_all_sessions(self) -> list[str]:
        """Drop every session right now (admin reset). Returns the list of cleared ids."""
        with self._lock:
            cleared = list(self._sessions.keys())
            self._sessions.clear()
        for sid in cleared:
            self.publish({
                "type": "agent_stopped",
                "session_id": sid,
                "agent": "admin",
                "ts": "",
            })
        return cleared

    def stats(self) -> dict[str, Any]:
        """Return runtime metrics for the bus. Safe for concurrent reads."""
        with self._lock:
            return {
                "subscribers": len(self._subscribers),
                "events_published_total": self._events_published,
                "events_dropped_total": self._events_dropped,
                "queue_depths": [q.qsize() for q in self._subscribers],
                "replay_buffer_size": len(self._replay),
                "sessions_active": len(self._sessions),
            }


# Module-level singleton used by routes + hook endpoint
bus = PixelOfficeBus()
