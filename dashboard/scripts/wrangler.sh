#!/usr/bin/env sh
set -eu

script_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
dashboard_dir=$(dirname -- "$script_dir")
repo_dir=$(dirname -- "$dashboard_dir")

load_env_file() {
  file="$1"
  [ -f "$file" ] || return 0
  while IFS= read -r line || [ -n "$line" ]; do
    case "$line" in
      CLOUDFLARE_TOKEN=*|CLOUDFLARE_API_TOKEN=*|AGENT_RUNNER_DASHBOARD_TOKEN=*)
        key=${line%%=*}
        value=${line#*=}
        value=${value#\"}
        value=${value%\"}
        value=${value#\'}
        value=${value%\'}
        if [ -z "$(eval "printf '%s' \"\${$key:-}\"")" ]; then
          export "$key=$value"
        fi
        ;;
    esac
  done < "$file"
}

load_env_file "$repo_dir/.env"
load_env_file "$repo_dir/.env.local"
load_env_file "$dashboard_dir/.env"
load_env_file "$dashboard_dir/.env.local"

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
