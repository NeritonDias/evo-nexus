"""Integrations endpoint — check configured integrations via env vars."""

import os
import time
import requests as http
from flask import Blueprint, jsonify

bp = Blueprint("integrations", __name__)

INTEGRATIONS = [
    {"name": "Omie", "key": "OMIE_APP_KEY", "category": "erp"},
    {"name": "Stripe", "key": "STRIPE_SECRET_KEY", "category": "payments"},
    {"name": "Todoist", "key": "TODOIST_API_TOKEN", "category": "productivity"},
    {"name": "Fathom", "key": "FATHOM_API_KEY", "category": "meetings"},
    {"name": "Discord", "key": "DISCORD_BOT_TOKEN", "category": "community"},
    {"name": "Telegram", "key": "TELEGRAM_BOT_TOKEN", "category": "messaging"},
    {"name": "WhatsApp", "key": "WHATSAPP_API_KEY", "category": "messaging"},
    {"name": "Licensing", "key": "LICENSING_ADMIN_TOKEN", "category": "product"},
    {"name": "YouTube", "key": "SOCIAL_YOUTUBE_", "category": "social", "prefix": True},
    {"name": "Instagram", "key": "SOCIAL_INSTAGRAM_", "category": "social", "prefix": True},
    {"name": "LinkedIn", "key": "SOCIAL_LINKEDIN_", "category": "social", "prefix": True},
    {"name": "Evolution API", "key": "EVOLUTION_API_KEY", "category": "messaging"},
    {"name": "Evolution Go", "key": "EVOLUTION_GO_KEY", "category": "messaging"},
    {"name": "Evo CRM", "key": "EVO_CRM_TOKEN", "category": "crm"},
    {"name": "AI Image Creator", "key": "AI_IMG_CREATOR_", "category": "creative", "prefix": True},
]


@bp.route("/api/integrations")
def list_integrations():
    results = []
    for integ in INTEGRATIONS:
        if integ.get("prefix"):
            # Check if any env var starts with the prefix
            configured = any(k.startswith(integ["key"]) for k in os.environ)
        else:
            configured = bool(os.environ.get(integ["key"]))

        results.append({
            "name": integ["name"],
            "category": integ["category"],
            "configured": configured,
            "status": "ok" if configured else "pending",
            "type": integ["category"],
        })

    configured_count = sum(1 for r in results if r["configured"])
    return jsonify({
        "integrations": results,
        "configured_count": configured_count,
        "total_count": len(results),
    })


@bp.route("/api/integrations/<name>/test", methods=["POST"])
def test_integration(name: str):
    """Basic connectivity test for an integration."""
    t0 = time.time()

    def ok(message: str = "Conexão OK") -> "tuple[object, int]":
        latency = round((time.time() - t0) * 1000)
        return jsonify({"ok": True, "message": message, "latency_ms": latency}), 200

    def fail(error: str) -> "tuple[object, int]":
        return jsonify({"ok": False, "error": error}), 200

    slug = name.lower().replace(" ", "-").replace("_", "-")

    # --- Stripe ---
    if slug == "stripe":
        key = os.environ.get("STRIPE_SECRET_KEY", "")
        if not key:
            return fail("STRIPE_SECRET_KEY não configurado")
        try:
            r = http.get(
                "https://api.stripe.com/v1/charges",
                params={"limit": 1},
                auth=(key, ""),
                timeout=8,
            )
            if r.status_code == 200:
                return ok("Stripe conectado com sucesso")
            return fail(f"Stripe retornou {r.status_code}")
        except Exception as e:
            return fail(str(e))

    # --- Omie ---
    if slug == "omie":
        app_key = os.environ.get("OMIE_APP_KEY", "")
        app_secret = os.environ.get("OMIE_APP_SECRET", "")
        if not app_key or not app_secret:
            return fail("OMIE_APP_KEY e OMIE_APP_SECRET não configurados")
        try:
            r = http.post(
                "https://app.omie.com.br/api/v1/geral/clientes/",
                json={
                    "call": "ListarClientes",
                    "app_key": app_key,
                    "app_secret": app_secret,
                    "param": [{"pagina": 1, "registros_por_pagina": 1}],
                },
                timeout=10,
            )
            data = r.json()
            if "faultstring" in data:
                return fail(data["faultstring"])
            return ok("Omie conectado com sucesso")
        except Exception as e:
            return fail(str(e))

    # --- Evolution API ---
    if slug == "evolution-api":
        api_key = os.environ.get("EVOLUTION_API_KEY", "")
        api_url = os.environ.get("EVOLUTION_API_URL", "").rstrip("/")
        if not api_key or not api_url:
            return fail("EVOLUTION_API_KEY e EVOLUTION_API_URL não configurados")
        try:
            r = http.get(
                f"{api_url}/instance/fetchInstances",
                headers={"apikey": api_key},
                timeout=8,
            )
            if r.status_code == 200:
                return ok("Evolution API conectada com sucesso")
            return fail(f"Evolution API retornou {r.status_code}")
        except Exception as e:
            return fail(str(e))

    # --- Todoist ---
    if slug == "todoist":
        token = os.environ.get("TODOIST_API_TOKEN", "")
        if not token:
            return fail("TODOIST_API_TOKEN não configurado")
        try:
            r = http.get(
                "https://api.todoist.com/rest/v2/projects",
                headers={"Authorization": f"Bearer {token}"},
                timeout=8,
            )
            if r.status_code == 200:
                return ok("Todoist conectado com sucesso")
            return fail(f"Todoist retornou {r.status_code}")
        except Exception as e:
            return fail(str(e))

    # Passthrough for integrations without a dedicated test
    return jsonify({"ok": True, "message": "Nenhum teste disponível para esta integração"}), 200
