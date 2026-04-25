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
