"""Pixel-office routes: hook ingestion (HTTP POST), WebSocket stream, agent roster.

Authentication: the HTTP hook endpoint expects a shared secret
`PIXEL_OFFICE_HOOK_TOKEN` env var that the hook script reads too. Missing or
wrong token → 401. This endpoint is explicitly allow-listed upstream of
login_required because local shell hooks can't carry a user session.
"""
from __future__ import annotations

import json
import os
import re
import secrets
from pathlib import Path

from flask import Blueprint, jsonify, request
from flask_sock import Sock

from pixel_office_bus import bus
from pixel_office_events import validate_event

bp = Blueprint("pixel_office", __name__, url_prefix="/api/pixel-office")
sock = Sock()  # attached to app in app.py

_WORKSPACE_ENV = "EVONEXUS_WORKSPACE"


def _workspace_root() -> Path:
    # Tests set EVONEXUS_WORKSPACE; prod infers from this file's location.
    override = os.environ.get(_WORKSPACE_ENV)
    if override:
        return Path(override)
    return Path(__file__).resolve().parent.parent.parent.parent


def _expected_hook_token() -> str | None:
    return os.environ.get("PIXEL_OFFICE_HOOK_TOKEN") or None


@bp.post("/hook")
def hook_ingest():
    expected = _expected_hook_token()
    if expected:
        provided = request.headers.get("X-Hook-Token", "")
        if not provided or not secrets.compare_digest(provided, expected):
            return jsonify({"error": "unauthorized"}), 401
    event = request.get_json(silent=True) or {}
    err = validate_event(event)
    if err:
        return jsonify({"error": err}), 400
    bus.publish(event)
    return jsonify({"ok": True}), 202


_FRONTMATTER_RE = re.compile(r"^---\s*\n(.*?)\n---\s*\n", re.DOTALL)


def _parse_agent_frontmatter(md_text: str) -> dict[str, str]:
    m = _FRONTMATTER_RE.match(md_text)
    if not m:
        return {}
    result: dict[str, str] = {}
    for line in m.group(1).splitlines():
        if ":" not in line:
            continue
        key, _, value = line.partition(":")
        result[key.strip()] = value.strip()
    return result


@bp.get("/roster")
def roster():
    agents_dir = _workspace_root() / ".claude" / "agents"
    agents: list[dict[str, str]] = []
    if agents_dir.is_dir():
        for md in sorted(agents_dir.glob("*.md")):
            try:
                meta = _parse_agent_frontmatter(md.read_text(encoding="utf-8"))
            except OSError:
                continue
            agents.append({
                "name": meta.get("name", md.stem),
                "description": meta.get("description", ""),
                "color": meta.get("color", "slate"),
                "slug": md.stem,
            })
    return jsonify({"agents": agents})


@sock.route("/ws/pixel-office")
def ws_stream(ws):
    q = bus.subscribe()
    try:
        while True:
            event = q.get()
            ws.send(json.dumps(event))
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
