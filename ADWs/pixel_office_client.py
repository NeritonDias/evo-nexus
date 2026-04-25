"""Tiny client for ADWs code to publish pixel-office events without blocking.

This runs in-process inside the scheduler / runner. It fires HTTP POSTs with a
short timeout and swallows any exception — visualisation is a best-effort
side-channel, never a failure mode.
"""
from __future__ import annotations

import json
import os
import threading
import urllib.error
from urllib.request import Request, urlopen


def _post_sync(url: str, payload: dict, token: str | None, timeout: float) -> None:
    data = json.dumps(payload).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["X-Hook-Token"] = token
    req = Request(url, data=data, headers=headers, method="POST")
    try:
        with urlopen(req, timeout=timeout) as _:
            pass
    except (urllib.error.URLError, OSError, TimeoutError):
        pass


def post_event(payload: dict, timeout: float = 1.5) -> None:
    url = os.environ.get("EVONEXUS_DASHBOARD_URL", "http://127.0.0.1:8080")
    url = url.rstrip("/") + "/api/pixel-office/hook"
    token = os.environ.get("PIXEL_OFFICE_HOOK_TOKEN") or None
    t = threading.Thread(target=_post_sync, args=(url, payload, token, timeout), daemon=True)
    t.start()
