#!/usr/bin/env sh
set -eu

if [ -z "${CLOUDFLARE_API_TOKEN:-}" ] && [ -n "${CLOUDFLARE_TOKEN:-}" ]; then
  export CLOUDFLARE_API_TOKEN="$CLOUDFLARE_TOKEN"
fi

if [ "${1:-}" = "pages" ] && [ "${2:-}" = "dev" ] && [ -n "${AGENT_RUNNER_DASHBOARD_TOKEN:-}" ]; then
  has_dashboard_binding=0
  for arg in "$@"; do
    if [ "$arg" = "--binding" ] || [ "$arg" = "-b" ] || [ "$arg" = "AGENT_RUNNER_DASHBOARD_TOKEN=$AGENT_RUNNER_DASHBOARD_TOKEN" ]; then
      has_dashboard_binding=1
    fi
  done
  if [ "$has_dashboard_binding" = "0" ]; then
    set -- "$@" --binding "AGENT_RUNNER_DASHBOARD_TOKEN=$AGENT_RUNNER_DASHBOARD_TOKEN"
  fi
fi

exec wrangler "$@"
