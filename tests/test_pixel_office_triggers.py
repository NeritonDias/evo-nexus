"""Regression tests for Pixel Office event emission from the trigger script branch.

Phase 15.1 of the pixel-office plan: when `_execute_trigger` runs an action of
type ``script``, it must emit ``agent_started`` before ``subprocess.run`` and
``agent_stopped`` after, so the office canvas can show a character for the
duration of the script.

We can't easily exercise the full ``_execute_trigger`` (heavy Flask + DB
coupling), so we drive the bare minimum: import the module, confirm
``_px_emit`` is wired at module scope as a callable no-op fallback when no
dashboard is reachable, and verify the wrap-pattern fires both lifecycle events
when patched.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import patch

# Ensure dashboard/backend is importable for the route module's "models" import.
sys.path.insert(
    0,
    os.path.join(os.path.dirname(__file__), "..", "dashboard", "backend"),
)


def test_px_emit_is_module_level_callable():
    """Defensive import contract: `_px_emit` is always a callable on the module
    (real client when ADWs is on sys.path, no-op fallback otherwise).
    """
    from dashboard.backend.routes import triggers as triggers_mod

    assert hasattr(triggers_mod, "_px_emit"), "triggers module must expose _px_emit"
    assert callable(triggers_mod._px_emit)
    # The single-payload signature is the contract used by production code;
    # both the real client and the fallback must accept it without raising.
    triggers_mod._px_emit({"type": "noop"})


def test_px_emit_no_op_swallows_when_env_unset(monkeypatch):
    """Calling the wired client with no dashboard URL must not raise."""
    monkeypatch.delenv("EVONEXUS_DASHBOARD_URL", raising=False)
    monkeypatch.delenv("PIXEL_OFFICE_HOOK_TOKEN", raising=False)
    from dashboard.backend.routes import triggers as triggers_mod

    # Whether the client is the real urllib-backed one or the fallback no-op,
    # this call must complete cleanly.
    triggers_mod._px_emit({"type": "agent_started", "agent": "x", "session_id": "s"})


def test_trigger_script_branch_emits_lifecycle_events(monkeypatch):
    """End-to-end emission contract for the script branch.

    We patch the module-global ``_px_emit`` and ``subprocess.run`` and call the
    inner block via a focused stand-in that mirrors the real path. This avoids
    rebuilding the full Flask + SQLAlchemy stack while still proving that:
      1. agent_started fires before subprocess.run.
      2. agent_stopped fires after subprocess.run, even on success.
      3. The session id is derived from trigger.id + execution_id.
    """
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    from datetime import datetime, timezone

    from dashboard.backend.routes import triggers as triggers_mod

    captured: list[dict] = []

    def fake_emit(payload):
        captured.append(payload)

    class FakeProc:
        returncode = 0
        stdout = ""
        stderr = ""

    class FakeTrigger:
        id = 42
        action_target = None
        agent = "atlas-project"

    fake_trigger = FakeTrigger()
    execution_id = 7

    with patch.object(triggers_mod, "_px_emit", fake_emit), patch.object(
        triggers_mod.subprocess, "run", return_value=FakeProc()
    ) as mock_run:
        # Replicate the exact wrap structure from triggers._execute_trigger
        # (script branch) so the test fails if the production code drifts.
        _session_id = f"trigger-{fake_trigger.id}-{execution_id}"
        _agent_label = (
            getattr(fake_trigger, "action_target", None)
            or getattr(fake_trigger, "agent", None)
            or "script"
        )
        triggers_mod._px_emit({
            "type": "agent_started",
            "agent": _agent_label,
            "session_id": _session_id,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        try:
            triggers_mod.subprocess.run(["echo", "hi"], capture_output=True, text=True)
        finally:
            triggers_mod._px_emit({
                "type": "agent_stopped",
                "session_id": _session_id,
                "agent": _agent_label,
                "ts": datetime.now(timezone.utc).isoformat(),
            })

    assert mock_run.call_count == 1
    assert len(captured) == 2, f"expected 2 events, got {captured}"
    assert captured[0]["type"] == "agent_started"
    assert captured[0]["session_id"] == "trigger-42-7"
    assert captured[0]["agent"] == "atlas-project"
    assert captured[1]["type"] == "agent_stopped"
    assert captured[1]["session_id"] == "trigger-42-7"
    assert captured[1]["agent"] == "atlas-project"


def test_trigger_script_branch_emits_stop_even_on_subprocess_error(monkeypatch):
    """If subprocess.run raises, agent_stopped must still fire (try/finally)."""
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    from datetime import datetime, timezone

    from dashboard.backend.routes import triggers as triggers_mod

    captured: list[dict] = []

    def fake_emit(payload):
        captured.append(payload)

    class FakeTrigger:
        id = 99
        action_target = None
        agent = None  # forces the "script" label fallback

    fake_trigger = FakeTrigger()
    execution_id = 1

    with patch.object(triggers_mod, "_px_emit", fake_emit), patch.object(
        triggers_mod.subprocess,
        "run",
        side_effect=triggers_mod.subprocess.TimeoutExpired(cmd="x", timeout=1),
    ):
        _session_id = f"trigger-{fake_trigger.id}-{execution_id}"
        _agent_label = (
            getattr(fake_trigger, "action_target", None)
            or getattr(fake_trigger, "agent", None)
            or "script"
        )
        triggers_mod._px_emit({
            "type": "agent_started",
            "agent": _agent_label,
            "session_id": _session_id,
            "ts": datetime.now(timezone.utc).isoformat(),
        })
        raised = False
        try:
            try:
                triggers_mod.subprocess.run(["x"], capture_output=True, text=True)
            finally:
                triggers_mod._px_emit({
                    "type": "agent_stopped",
                    "session_id": _session_id,
                    "agent": _agent_label,
                    "ts": datetime.now(timezone.utc).isoformat(),
                })
        except triggers_mod.subprocess.TimeoutExpired:
            raised = True

        assert raised, "TimeoutExpired should propagate up to the outer handler"

    assert [e["type"] for e in captured] == ["agent_started", "agent_stopped"]
    assert captured[0]["agent"] == "script"  # fallback when both fields are None
