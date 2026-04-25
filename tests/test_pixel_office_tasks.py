"""Regression tests for pixel-office emission in dashboard.backend.routes.tasks.

Phase 15.2: the direct-subprocess branch of `_execute_task` (used for
`task.type == "script"`) must publish `agent_started` / `agent_stopped`
office events around the `subprocess.run` call. The skill/prompt branch
goes through `ADWs.runner` which is covered separately (Phase 8).

These tests avoid spinning up the full Flask app + DB by mocking at the
SQLAlchemy boundary (`ScheduledTask.query`) and the subprocess boundary.
If that mocking turns out to be too tightly coupled to internals on a
given CI image, the final test in this module guarantees at minimum that
the module imports cleanly and `_px_emit` is a callable no-op when the
ADWs client is unavailable.
"""
from __future__ import annotations

import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

import pytest

# Ensure dashboard/backend is importable as a top-level package path,
# matching how app.py loads `models`, `routes.*`, etc.
_REPO_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.join(_REPO_ROOT, "dashboard", "backend"))


def test_module_imports_and_emit_is_callable():
    """Smoke: tasks.py imports cleanly and `_px_emit` is always callable.

    This is the always-on guarantee — even if the heavier mocking tests
    below get skipped, this one proves the defensive import + no-op
    fallback are wired correctly.
    """
    from dashboard.backend.routes import tasks as tasks_mod

    assert hasattr(tasks_mod, "bp")
    assert hasattr(tasks_mod, "_px_emit")
    assert callable(tasks_mod._px_emit)
    # The no-op fallback (or the real client) must accept arbitrary kwargs
    # and never raise — visualisation is a best-effort side-channel.
    tasks_mod._px_emit({"type": "agent_started", "agent": "x", "session_id": "s"})


def _make_fake_task(task_id: int = 42, agent: str | None = "atlas-project"):
    """Build a SimpleNamespace that behaves like a ScheduledTask row.

    `_execute_task` only reads/writes a handful of attributes, so a plain
    namespace is enough to drive it.
    """
    return SimpleNamespace(
        id=task_id,
        name="emit-test",
        type="script",
        payload="dummy_routine.py",
        agent=agent,
        status="pending",
        started_at=None,
        completed_at=None,
        result_summary=None,
        error=None,
    )


@pytest.fixture
def fake_workspace(tmp_path, monkeypatch):
    """Create a fake ADWs/routines/<payload> on disk so the path validation passes."""
    routines_dir = tmp_path / "ADWs" / "routines"
    routines_dir.mkdir(parents=True)
    script = routines_dir / "dummy_routine.py"
    script.write_text("print('hi')\n", encoding="utf-8")

    # `_execute_task` derives `workspace` from __file__ of the routes module.
    # We patch Path() resolution by monkeypatching `os.path.abspath` indirectly;
    # the simplest approach is to point cwd-resolution at tmp_path via the
    # workspace var inside _execute_task. We do this by patching Path.resolve
    # behavior through the script_path variable using monkeypatch on
    # `dashboard.backend.routes.tasks` symbols at call time.
    return tmp_path


def test_script_branch_emits_started_and_stopped(fake_workspace, monkeypatch):
    """The wrapped subprocess.run block must emit agent_started before and
    agent_stopped after, even on success."""
    from dashboard.backend.routes import tasks as tasks_mod

    # Redirect the workspace path inside _execute_task so script validation
    # accepts our temp script. We do this by monkeypatching os.path.abspath
    # only for the call inside _execute_task — instead of fighting Path
    # resolution, we monkeypatch the module-level Path used inside the fn
    # by patching `os.path.dirname` chain via an intercept on the routes
    # module's `__file__`.
    fake_routes_file = fake_workspace / "dashboard" / "backend" / "routes" / "tasks.py"
    fake_routes_file.parent.mkdir(parents=True, exist_ok=True)
    fake_routes_file.write_text("# stub\n", encoding="utf-8")
    monkeypatch.setattr(tasks_mod, "__file__", str(fake_routes_file))

    task = _make_fake_task(task_id=99, agent="atlas-project")

    # Mock DB layer
    fake_query = MagicMock()
    fake_query.get.return_value = task
    monkeypatch.setattr(
        "dashboard.backend.routes.tasks.ScheduledTask",
        SimpleNamespace(query=fake_query),
    )

    fake_session = MagicMock()
    monkeypatch.setattr("dashboard.backend.routes.tasks.db", SimpleNamespace(session=fake_session))

    # Mock subprocess.run to return success
    proc_result = SimpleNamespace(returncode=0, stdout="ok\n", stderr="")
    run_mock = MagicMock(return_value=proc_result)
    monkeypatch.setattr("dashboard.backend.routes.tasks.subprocess.run", run_mock)

    # Capture pixel-office emissions
    emit_mock = MagicMock()
    monkeypatch.setattr("dashboard.backend.routes.tasks._px_emit", emit_mock)

    # Execute
    tasks_mod._execute_task(99)

    # subprocess.run must have been called exactly once for the script
    assert run_mock.call_count == 1, "subprocess.run should fire once for the script"

    # _px_emit must have been called twice: started, then stopped
    assert emit_mock.call_count == 2, (
        f"expected 2 office emissions (started+stopped), got {emit_mock.call_count}: "
        f"{emit_mock.call_args_list}"
    )

    started_payload = emit_mock.call_args_list[0].args[0]
    stopped_payload = emit_mock.call_args_list[1].args[0]

    assert started_payload["type"] == "agent_started"
    assert started_payload["session_id"] == "task-99"
    assert started_payload["agent"] == "atlas-project"
    assert "ts" in started_payload

    assert stopped_payload["type"] == "agent_stopped"
    assert stopped_payload["session_id"] == "task-99"
    assert stopped_payload["agent"] == "atlas-project"
    assert "ts" in stopped_payload

    # Task must have completed normally
    assert task.status == "completed"


def test_script_branch_emits_stopped_even_on_subprocess_failure(fake_workspace, monkeypatch):
    """If `subprocess.run` raises (e.g. TimeoutExpired), the `finally`
    block must still emit `agent_stopped` so the office character disappears."""
    import subprocess as _subprocess

    from dashboard.backend.routes import tasks as tasks_mod

    fake_routes_file = fake_workspace / "dashboard" / "backend" / "routes" / "tasks.py"
    fake_routes_file.parent.mkdir(parents=True, exist_ok=True)
    fake_routes_file.write_text("# stub\n", encoding="utf-8")
    monkeypatch.setattr(tasks_mod, "__file__", str(fake_routes_file))

    task = _make_fake_task(task_id=7, agent=None)  # no agent → falls back to "script"

    fake_query = MagicMock()
    fake_query.get.return_value = task
    monkeypatch.setattr(
        "dashboard.backend.routes.tasks.ScheduledTask",
        SimpleNamespace(query=fake_query),
    )
    monkeypatch.setattr("dashboard.backend.routes.tasks.db", SimpleNamespace(session=MagicMock()))

    # Force subprocess.run to time out
    run_mock = MagicMock(side_effect=_subprocess.TimeoutExpired(cmd="x", timeout=900))
    monkeypatch.setattr("dashboard.backend.routes.tasks.subprocess.run", run_mock)

    emit_mock = MagicMock()
    monkeypatch.setattr("dashboard.backend.routes.tasks._px_emit", emit_mock)

    # Should NOT raise (the surrounding try/except in _execute_task absorbs it)
    tasks_mod._execute_task(7)

    assert run_mock.call_count == 1
    assert emit_mock.call_count == 2, (
        f"agent_stopped must fire from `finally` even on TimeoutExpired; "
        f"got {emit_mock.call_args_list}"
    )

    started_payload = emit_mock.call_args_list[0].args[0]
    stopped_payload = emit_mock.call_args_list[1].args[0]
    assert started_payload["type"] == "agent_started"
    assert started_payload["session_id"] == "task-7"
    assert started_payload["agent"] == "script"  # fallback when task.agent is None
    assert stopped_payload["type"] == "agent_stopped"
    assert stopped_payload["session_id"] == "task-7"
    assert stopped_payload["agent"] == "script"

    # Outer except branch should have flagged it as failed
    assert task.status == "failed"


def test_emit_failure_does_not_break_task_execution(fake_workspace, monkeypatch):
    """If the pixel-office emit itself raises, task execution must still complete."""
    from dashboard.backend.routes import tasks as tasks_mod

    fake_routes_file = fake_workspace / "dashboard" / "backend" / "routes" / "tasks.py"
    fake_routes_file.parent.mkdir(parents=True, exist_ok=True)
    fake_routes_file.write_text("# stub\n", encoding="utf-8")
    monkeypatch.setattr(tasks_mod, "__file__", str(fake_routes_file))

    task = _make_fake_task(task_id=1, agent="flux-finance")

    fake_query = MagicMock()
    fake_query.get.return_value = task
    monkeypatch.setattr(
        "dashboard.backend.routes.tasks.ScheduledTask",
        SimpleNamespace(query=fake_query),
    )
    monkeypatch.setattr("dashboard.backend.routes.tasks.db", SimpleNamespace(session=MagicMock()))

    proc_result = SimpleNamespace(returncode=0, stdout="ok\n", stderr="")
    run_mock = MagicMock(return_value=proc_result)
    monkeypatch.setattr("dashboard.backend.routes.tasks.subprocess.run", run_mock)

    # Make every emit raise; the wrapper code must swallow it.
    emit_mock = MagicMock(side_effect=RuntimeError("network gone"))
    monkeypatch.setattr("dashboard.backend.routes.tasks._px_emit", emit_mock)

    # Must not raise.
    tasks_mod._execute_task(1)

    # Subprocess still ran; task still marked completed.
    assert run_mock.call_count == 1
    assert task.status == "completed"
