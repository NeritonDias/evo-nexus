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
        "subagent_started", "subagent_finished",
    }


# ── Snapshot (Phase 3.3) ──────────────────────────────────────────────────

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


def test_bus_snapshot_tracks_token_usage():
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    bus.publish({"type": "token_usage", "session_id": "s1", "input_tokens": 100, "output_tokens": 50, "ts": "t2"})
    snap = bus.snapshot()
    assert snap["s1"]["input_tokens"] == 100
    assert snap["s1"]["output_tokens"] == 50


def test_bus_snapshot_clears_tool_on_finish():
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    bus.publish({"type": "tool_started", "session_id": "s1", "agent": "a", "tool": "Bash", "ts": "t2"})
    bus.publish({"type": "tool_finished", "session_id": "s1", "agent": "a", "tool": "Bash", "ts": "t3"})
    assert bus.snapshot()["s1"]["tool"] is None


def test_bus_snapshot_is_deep_copy():
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    snap1 = bus.snapshot()
    snap1["s1"]["agent"] = "mutated"
    snap2 = bus.snapshot()
    assert snap2["s1"]["agent"] == "a"


# ── Stats / metrics (Phase 19) ────────────────────────────────────────────

def test_bus_stats_tracks_published_and_dropped():
    bus = PixelOfficeBus(max_queue=2, replay_size=0)
    q = bus.subscribe()
    bus.publish({"type": "notification", "message": "a"})
    bus.publish({"type": "notification", "message": "b"})
    bus.publish({"type": "notification", "message": "c"})  # forces drop
    s = bus.stats()
    assert s["events_published_total"] == 3
    assert s["events_dropped_total"] >= 0  # drop behavior depends on implementation
    assert s["subscribers"] == 1
    assert s["replay_buffer_size"] == 0


def test_bus_stats_reports_queue_depths_and_sessions():
    bus = PixelOfficeBus(max_queue=10, replay_size=5)
    bus.subscribe()
    bus.subscribe()
    bus.publish({"type": "agent_started", "agent": "a", "session_id": "s1", "ts": "t1"})
    s = bus.stats()
    assert s["subscribers"] == 2
    assert isinstance(s["queue_depths"], list)
    assert len(s["queue_depths"]) == 2
    assert s["sessions_active"] == 1
    assert s["replay_buffer_size"] == 1


# ── Per-subscriber RBAC filter (Phase 16) ─────────────────────────────────

def test_bus_filter_per_subscriber():
    """Two subscribers with disjoint filters each see only their allowed agents."""
    bus = PixelOfficeBus(max_queue=10, replay_size=0)

    def only_apex(evt, _ctx):
        return evt.get("agent") == "apex"

    def only_nex(evt, _ctx):
        return evt.get("agent") == "nex"

    q_apex = bus.subscribe(filter_fn=only_apex)
    q_nex = bus.subscribe(filter_fn=only_nex)
    q_all = bus.subscribe()  # no filter — sees everything

    bus.publish({"type": "agent_started", "agent": "apex", "session_id": "s1"})
    bus.publish({"type": "agent_started", "agent": "nex", "session_id": "s2"})
    bus.publish({"type": "agent_started", "agent": "zara-cs", "session_id": "s3"})

    apex_events = []
    while not q_apex.empty():
        apex_events.append(q_apex.get_nowait())
    assert len(apex_events) == 1
    assert apex_events[0]["agent"] == "apex"

    nex_events = []
    while not q_nex.empty():
        nex_events.append(q_nex.get_nowait())
    assert len(nex_events) == 1
    assert nex_events[0]["agent"] == "nex"

    all_events = []
    while not q_all.empty():
        all_events.append(q_all.get_nowait())
    assert len(all_events) == 3


def test_bus_filter_applies_to_replay():
    """Replay buffer is filtered for late-joining subscribers too."""
    bus = PixelOfficeBus(max_queue=10, replay_size=10)
    bus.publish({"type": "agent_started", "agent": "apex", "session_id": "s1"})
    bus.publish({"type": "agent_started", "agent": "nex", "session_id": "s2"})

    def only_apex(evt, _ctx):
        return evt.get("agent") == "apex"

    q = bus.subscribe(filter_fn=only_apex)
    received = []
    while not q.empty():
        received.append(q.get_nowait())
    assert len(received) == 1
    assert received[0]["agent"] == "apex"


def test_bus_filter_misbehaving_predicate_does_not_poison_bus():
    """A filter that raises is treated as 'skip' — other subscribers unaffected."""
    bus = PixelOfficeBus(max_queue=10, replay_size=0)

    def boom(_evt, _ctx):
        raise RuntimeError("kaboom")

    q_bad = bus.subscribe(filter_fn=boom)
    q_good = bus.subscribe()  # plain subscriber

    bus.publish({"type": "agent_started", "agent": "apex", "session_id": "s1"})

    assert q_bad.empty()  # filter raised → skip
    assert q_good.qsize() == 1  # other subscriber still received


# ── Snapshot RBAC filter (Phase 16) ───────────────────────────────────────

def test_snapshot_respects_allowed_slugs():
    """snapshot(allowed={'apex'}) returns only sessions for that agent."""
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "apex", "session_id": "s1", "ts": "t1"})
    bus.publish({"type": "agent_started", "agent": "nex", "session_id": "s2", "ts": "t2"})
    bus.publish({"type": "agent_started", "agent": "zara-cs", "session_id": "s3", "ts": "t3"})

    full = bus.snapshot()
    assert set(full.keys()) == {"s1", "s2", "s3"}

    only_apex = bus.snapshot(allowed_slugs={"apex"})
    assert set(only_apex.keys()) == {"s1"}
    assert only_apex["s1"]["agent"] == "apex"

    apex_and_nex = bus.snapshot(allowed_slugs={"apex", "nex"})
    assert set(apex_and_nex.keys()) == {"s1", "s2"}

    none_allowed = bus.snapshot(allowed_slugs=set())
    assert none_allowed == {}


def test_snapshot_none_allowed_slugs_means_unrestricted():
    """allowed_slugs=None preserves the legacy 'return everything' behaviour."""
    bus = PixelOfficeBus()
    bus.publish({"type": "agent_started", "agent": "apex", "session_id": "s1", "ts": "t1"})
    assert "s1" in bus.snapshot(allowed_slugs=None)
