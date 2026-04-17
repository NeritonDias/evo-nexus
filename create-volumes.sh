#!/usr/bin/env bash
# ============================================================================
# create-volumes.sh
#
# Cria os 7 volumes externos que o evonexus.stack.yml referencia. Roda uma
# vez, no nó manager do Swarm, antes do primeiro `docker stack deploy`.
# Idempotente — volume que já existe é pulado.
# ============================================================================
set -euo pipefail

VOLUMES=(
    evonexus_config
    evonexus_workspace
    evonexus_dashboard_data
    evonexus_memory
    evonexus_adw_logs
    evonexus_agent_memory
    evonexus_codex_auth
)

echo "Criando volumes externos do EvoNexus..."
for v in "${VOLUMES[@]}"; do
    if docker volume inspect "$v" >/dev/null 2>&1; then
        echo "  ↻ $v (já existe, pulando)"
    else
        docker volume create "$v" >/dev/null
        echo "  ✓ $v"
    fi
done

echo
echo "Pronto. Próximo passo: colar evonexus.stack.yml no Portainer"
echo "ou rodar 'docker stack deploy -c evonexus.stack.yml evonexus'."
