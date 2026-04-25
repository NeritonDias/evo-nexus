"""Pixel-office routes: hook ingestion (HTTP POST), WebSocket stream, agent roster,
snapshot for late joiners, seat persistence.

Authentication: the HTTP hook endpoint expects a shared secret
`PIXEL_OFFICE_HOOK_TOKEN` env var that the hook script reads too. Missing or
wrong token → 401. This endpoint is explicitly allow-listed upstream of
login_required because local shell hooks can't carry a user session.

Authenticated endpoints (/snapshot, /seats) require session login.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, current_app, jsonify, request
from flask_login import current_user
from flask_sock import Sock

from pixel_office_bus import bus
from pixel_office_events import validate_event

bp = Blueprint("pixel_office", __name__, url_prefix="/api/pixel-office")
sock = Sock()  # attached to app in app.py

_WORKSPACE_ENV = "EVONEXUS_WORKSPACE"
_BUS_STARTED_AT = datetime.now(timezone.utc)


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


@bp.get("/snapshot")
def snapshot():
    """Return the current session map for late joiners reconstructing state."""
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    return jsonify({"sessions": bus.snapshot()})


@bp.get("/metrics")
def metrics():
    """Return runtime metrics for the pixel-office bus (Phase 19 observability)."""
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    stats = bus.stats()
    stats["uptime_seconds"] = int((datetime.now(timezone.utc) - _BUS_STARTED_AT).total_seconds())
    return jsonify(stats)


# ── Seat persistence (Phase 10) ──────────────────────────────────────────────


def _db_path() -> str:
    return current_app.config["SQLALCHEMY_DATABASE_URI"].replace("sqlite:///", "")


@bp.get("/seats")
def list_seats():
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    conn = sqlite3.connect(_db_path())
    try:
        rows = conn.execute(
            "SELECT agent_slug, seat_id, palette, hue_shift FROM pixel_office_seats"
        ).fetchall()
    except sqlite3.OperationalError:
        # Table may not exist yet (migration runs on app startup). Return empty.
        rows = []
    finally:
        conn.close()
    return jsonify({
        "seats": [
            {"agent_slug": r[0], "seat_id": r[1], "palette": r[2], "hue_shift": r[3]}
            for r in rows
        ]
    })


@bp.put("/seats")
def put_seats():
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    data = request.get_json(silent=True) or {}
    items = data.get("seats", [])
    if not isinstance(items, list):
        return jsonify({"error": "seats must be a list"}), 400
    now = datetime.now(timezone.utc).isoformat()
    conn = sqlite3.connect(_db_path())
    try:
        for item in items:
            if not isinstance(item, dict):
                continue
            slug = item.get("agent_slug")
            if not slug or not isinstance(slug, str):
                continue
            conn.execute(
                """INSERT INTO pixel_office_seats (agent_slug, seat_id, palette, hue_shift, updated_at)
                   VALUES (?, ?, ?, ?, ?)
                   ON CONFLICT(agent_slug) DO UPDATE SET
                     seat_id=excluded.seat_id, palette=excluded.palette,
                     hue_shift=excluded.hue_shift, updated_at=excluded.updated_at""",
                (
                    slug,
                    str(item.get("seat_id", "")),
                    int(item.get("palette", 0)),
                    int(item.get("hue_shift", 0)),
                    now,
                ),
            )
        conn.commit()
    finally:
        conn.close()
    return jsonify({"ok": True})


@sock.route("/ws/pixel-office")
def ws_stream(ws):
    # Require either a logged-in session OR a valid DASHBOARD_API_TOKEN via
    # ?token= query string. Frontend uses session cookies automatically; the
    # query-string token is for CLI / headless clients (wscat, integration tests).
    authed = current_user.is_authenticated
    if not authed:
        token_qs = request.args.get("token", "")
        expected = os.environ.get("DASHBOARD_API_TOKEN", "").strip()
        if token_qs and expected and secrets.compare_digest(token_qs, expected):
            authed = True
    if not authed:
        try:
            ws.close(code=4401, reason="unauthorized")
        except Exception:
            pass
        return
    q = bus.subscribe()
    try:
        while True:
            event = q.get()
            ws.send(json.dumps(event))
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
