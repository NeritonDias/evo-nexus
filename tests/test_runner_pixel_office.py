"""Tests for ADWs.pixel_office_client — best-effort HTTP emission of office events.

The client must:
- POST JSON payloads to the dashboard hook URL.
- Forward the X-Hook-Token header when PIXEL_OFFICE_HOOK_TOKEN is set.
- Never raise — visualization is a side-channel and must not break runs.
"""

from unittest.mock import MagicMock, patch

from ADWs.pixel_office_client import post_event


def _wait_for_emission(mock_open, timeout: float = 2.0) -> None:
    """post_event fires a daemon thread; give it a moment to dispatch."""
    import time

    deadline = time.time() + timeout
    while time.time() < deadline:
        if mock_open.call_args is not None:
            return
        time.sleep(0.01)


def test_post_event_posts_json_with_token_header(monkeypatch):
    monkeypatch.setenv("PIXEL_OFFICE_HOOK_TOKEN", "secret")
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    with patch("ADWs.pixel_office_client.urlopen") as mock_open:
        resp = MagicMock()
        resp.__enter__.return_value.status = 202
        mock_open.return_value = resp
        post_event({"type": "agent_started", "agent": "a", "session_id": "s"})
        _wait_for_emission(mock_open)
    assert mock_open.call_args is not None, "urlopen was never invoked"
    args, _ = mock_open.call_args
    req = args[0]
    assert req.get_header("X-hook-token") == "secret"
    assert req.data is not None


def test_post_event_swallows_exceptions(monkeypatch):
    monkeypatch.setenv("EVONEXUS_DASHBOARD_URL", "http://localhost:8080")
    with patch("ADWs.pixel_office_client.urlopen", side_effect=OSError("boom")) as mock_open:
        # Must not raise, even though urlopen blows up
        post_event({"type": "notification", "message": "hi"})
        _wait_for_emission(mock_open)
    # If we got here without an exception leaking out of post_event, success.
    assert mock_open.call_args is not None
