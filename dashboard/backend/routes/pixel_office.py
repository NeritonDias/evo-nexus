"""Pixel-office routes: hook ingestion (HTTP POST), WebSocket stream,
snapshot for late joiners, seat persistence.

Authentication: the HTTP hook endpoint expects a shared secret
`PIXEL_OFFICE_HOOK_TOKEN` env var that the hook script reads too. Missing or
wrong token → 401. This endpoint is explicitly allow-listed upstream of
login_required because local shell hooks can't carry a user session.

Authenticated endpoints (/snapshot, /seats) require session login.

Agent roster is served by /api/agents (in routes/agents.py) — pixel-office
no longer exposes its own roster endpoint.

RBAC (Phase 16): WebSocket / SSE streams and the snapshot endpoint filter
events and sessions by the caller's agent allow-list (derived once at
connect time from the user's role). The `waiting_input` event prompt is
redacted for users without `agents:manage` permission.
"""
from __future__ import annotations

import json
import os
import secrets
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import Blueprint, Response, current_app, jsonify, request, stream_with_context
from flask_login import current_user
from flask_sock import Sock

from models import audit, has_agent_access, has_permission
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


# ── RBAC helpers ─────────────────────────────────────────────────────────────


def _agent_slugs_from_disk() -> list[str]:
    """Return all agent slugs in `.claude/agents/` (file stems)."""
    agents_dir = _workspace_root() / ".claude" / "agents"
    if not agents_dir.is_dir():
        return []
    return sorted(p.stem for p in agents_dir.glob("*.md"))


def _allowed_agent_slugs(role: str) -> set[str] | None:
    """Build an allow-list of agent slugs for a role.

    Returns `None` when the role has unrestricted access (admin or
    `agent_access.mode == 'all'`) — callers treat `None` as "no filter".
    Returns an empty set if the role has no access at all.
    """
    if role == "admin":
        return None
    slugs = _agent_slugs_from_disk()
    # If no agents on disk we can't tell — fall back to "no filter" so the
    # caller still sees session events.
    if not slugs:
        return None
    allowed = {s for s in slugs if has_agent_access(role, s)}
    # Optimisation: if every agent is allowed, signal "no filter" so the bus
    # doesn't bother running a per-event predicate.
    if len(allowed) == len(slugs):
        return None
    return allowed


def _sanitize_event_for_user(event: dict, has_manage: bool) -> dict:
    """Redact `waiting_input.message` for users without agents:manage."""
    if event.get("type") == "waiting_input" and not has_manage:
        return {**event, "message": ""}
    return event


@bp.get("/snapshot")
def snapshot():
    """Return the current session map for late joiners reconstructing state.

    Filters by the caller's agent allow-list (admins see everything).
    """
    if not current_user.is_authenticated:
        return jsonify({"error": "auth required"}), 401
    allowed = _allowed_agent_slugs(current_user.role)
    return jsonify({"sessions": bus.snapshot(allowed_slugs=allowed)})


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
    written: list[str] = []
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
            written.append(slug)
        conn.commit()
    finally:
        conn.close()
    # Best-effort audit log — never block the response on audit errors.
    try:
        audit(
            current_user,
            "pixel_office.seats_updated",
            resource="pixel_office_seats",
            detail=f"updated {len(written)} seat(s): {', '.join(written) if written else 'none'}",
        )
    except Exception:
        pass
    return jsonify({"ok": True})


def _build_subscriber_filter(allowed: set[str] | None):
    """Return a (event, ctx) -> bool predicate or None when no filter applies."""
    if allowed is None:
        return None

    def _filter(event: dict, _ctx: object) -> bool:
        agent = event.get("agent")
        if not agent:
            # Events without an agent (e.g. plain notifications) pass through.
            return True
        return agent in allowed

    return _filter


@bp.route("/sse", methods=["GET"])
def sse_stream():
    """Server-Sent Events fallback for clients where WebSocket is blocked.

    Auth: session cookie OR ?token=<DASHBOARD_API_TOKEN>. Token-only clients
    are treated as admin-equivalent (full access) since they're CLI / ops
    tools that already hold the master token.
    """
    authed = current_user.is_authenticated
    token_only = False
    if not authed:
        token_qs = request.args.get("token", "")
        expected = os.environ.get("DASHBOARD_API_TOKEN", "").strip()
        if token_qs and expected and secrets.compare_digest(token_qs, expected):
            authed = True
            token_only = True
    if not authed:
        return jsonify({"error": "unauthorized"}), 401

    if token_only:
        allowed = None
        has_manage = True
    else:
        allowed = _allowed_agent_slugs(current_user.role)
        has_manage = has_permission(current_user.role, "agents", "manage")

    filter_fn = _build_subscriber_filter(allowed)

    def generate():
        q = bus.subscribe(filter_fn=filter_fn)
        try:
            while True:
                event = q.get()
                event = _sanitize_event_for_user(event, has_manage)
                yield f"data: {json.dumps(event)}\n\n"
        except GeneratorExit:
            pass
        finally:
            bus.unsubscribe(q)

    return Response(
        stream_with_context(generate()),
        mimetype="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


@sock.route("/ws/pixel-office")
def ws_stream(ws):
    # Require either a logged-in session OR a valid DASHBOARD_API_TOKEN via
    # ?token= query string. Frontend uses session cookies automatically; the
    # query-string token is for CLI / headless clients (wscat, integration tests).
    authed = current_user.is_authenticated
    token_only = False
    if not authed:
        token_qs = request.args.get("token", "")
        expected = os.environ.get("DASHBOARD_API_TOKEN", "").strip()
        if token_qs and expected and secrets.compare_digest(token_qs, expected):
            authed = True
            token_only = True
    if not authed:
        try:
            ws.close(code=4401, reason="unauthorized")
        except Exception:
            pass
        return

    if token_only:
        allowed = None
        has_manage = True
    else:
        allowed = _allowed_agent_slugs(current_user.role)
        has_manage = has_permission(current_user.role, "agents", "manage")

    filter_fn = _build_subscriber_filter(allowed)
    q = bus.subscribe(filter_fn=filter_fn)
    try:
        while True:
            event = q.get()
            event = _sanitize_event_for_user(event, has_manage)
            ws.send(json.dumps(event))
    except Exception:
        pass
    finally:
        bus.unsubscribe(q)
