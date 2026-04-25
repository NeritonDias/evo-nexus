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
    assert r.status_code in (401, 403)  # 401 from current_user check, 403 from setup/auth middleware


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


# ── Snapshot endpoint (Phase 3.3) ─────────────────────────────────────────

def test_snapshot_rejects_unauth(client):
    r = client.get("/api/pixel-office/snapshot")
    assert r.status_code in (401, 403)  # 401 from current_user check, 403 from setup/auth middleware


# ── Seats endpoints (Phase 10) ────────────────────────────────────────────

def test_seats_list_rejects_unauth(client):
    r = client.get("/api/pixel-office/seats")
    assert r.status_code in (401, 403)  # 401 from current_user check, 403 from setup/auth middleware


def test_seats_put_rejects_unauth(client):
    r = client.put("/api/pixel-office/seats", json={"seats": []})
    assert r.status_code in (401, 403)  # 401 from current_user check, 403 from setup/auth middleware


# ── WebSocket endpoint (Phase 12) ─────────────────────────────────────────

def test_ws_route_exists_and_not_open_by_default(client):
    # Without upgrade headers Flask-Sock returns 400/426 not 200 — we just confirm not 200.
    r = client.get("/ws/pixel-office")
    assert r.status_code != 200


# ── Metrics endpoint (Phase 19) ───────────────────────────────────────────

def test_metrics_requires_auth(client):
    r = client.get("/api/pixel-office/metrics")
    assert r.status_code in (401, 403)
