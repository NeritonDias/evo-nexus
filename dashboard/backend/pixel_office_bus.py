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
