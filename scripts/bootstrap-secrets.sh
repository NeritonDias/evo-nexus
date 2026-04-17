#!/usr/bin/env bash
# ============================================================================
# scripts/bootstrap-secrets.sh
#
# Interactively create the Docker Swarm secrets EvoNexus needs. Run once,
# on a Swarm manager node, before the first `docker stack deploy`.
#
# Asks for:
#   * ANTHROPIC_API_KEY         (required)
#   * EVONEXUS_SECRET_KEY       (auto-generated if left blank)
#   * TELEGRAM_BOT_TOKEN        (optional)
#   * DISCORD_BOT_TOKEN         (optional)
#   * STRIPE_SECRET_KEY         (optional)
#   * Any extra KEY=VALUE pairs
#
# Values are never printed back to the terminal. Each secret is created
# with `docker secret create NAME -` reading from stdin.
# ============================================================================
set -euo pipefail

if ! docker info 2>/dev/null | grep -q "Swarm: active"; then
    echo "ERROR: this node is not part of an active Swarm." >&2
    echo "Run 'docker swarm init' first, then retry." >&2
    exit 1
fi

create_secret() {
    local name="$1"
    local prompt="$2"
    local required="${3:-0}"
    local value

    if docker secret inspect "$name" >/dev/null 2>&1; then
        echo "  ↻ secret '$name' already exists — skipping"
        return 0
    fi

    if [ "$required" = "1" ]; then
        while :; do
            read -rsp "  $prompt: " value; echo
            [ -n "$value" ] && break
            echo "    (required, try again)"
        done
    else
        read -rsp "  $prompt (blank to skip): " value; echo
        [ -z "$value" ] && { echo "  ⊘ skipped $name"; return 0; }
    fi

    printf '%s' "$value" | docker secret create "$name" - >/dev/null
    echo "  ✓ created '$name'"
    unset value
}

echo
echo "════════════════════════════════════════════════════════"
echo "  EvoNexus — Docker Swarm secret bootstrap"
echo "════════════════════════════════════════════════════════"
echo
echo "Required:"
create_secret anthropic_api_key "Anthropic API key" 1

echo
echo "  Flask session secret (leave blank to generate a random 64-char hex)"
if ! docker secret inspect evonexus_secret_key >/dev/null 2>&1; then
    read -rsp "    EVONEXUS_SECRET_KEY: " flask_key; echo
    [ -z "$flask_key" ] && flask_key=$(openssl rand -hex 32)
    printf '%s' "$flask_key" | docker secret create evonexus_secret_key - >/dev/null
    echo "  ✓ created 'evonexus_secret_key'"
    unset flask_key
else
    echo "  ↻ secret 'evonexus_secret_key' already exists — skipping"
fi

echo
echo "Optional integrations (press Enter to skip any):"
create_secret telegram_bot_token "Telegram bot token"
create_secret discord_bot_token  "Discord bot token"
create_secret stripe_secret_key  "Stripe secret key (sk_live_...)"
create_secret openai_api_key     "OpenAI API key (for OpenClaude)"

echo
read -rp "Add any extra secret? [y/N]: " extra
while [[ "$extra" =~ ^[Yy]$ ]]; do
    read -rp "  Secret name (lowercase, matches ENV_VAR_NAME in entrypoint): " name
    if [ -n "$name" ]; then
        create_secret "$name" "Value for $name"
    fi
    read -rp "Add another? [y/N]: " extra
done

echo
echo "Done. Current EvoNexus-related secrets in this Swarm:"
docker secret ls --format 'table {{.Name}}\t{{.CreatedAt}}' | head -1
docker secret ls --format 'table {{.Name}}\t{{.CreatedAt}}' | \
    grep -E "^(anthropic_api_key|evonexus_secret_key|telegram_bot_token|discord_bot_token|stripe_secret_key|openai_api_key)" || true
echo
echo "Next: deploy the stack."
echo "  docker stack deploy -c stack.yml evonexus"
