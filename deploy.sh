#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"

action=${1:-deploy}
case "$action" in
  deploy|update|start|stop|restart|status|logs) ;;
  help|-h|--help)
    echo "Usage: ./deploy.sh [deploy|update|start|stop|restart|status|logs]"
    exit 0 ;;
  *) echo "Unknown action: $action (use --help)" >&2; exit 2 ;;
esac

command -v docker >/dev/null || { echo "Docker Engine and Compose v2 are required." >&2; exit 1; }
docker compose version >/dev/null
docker info --format '{{.ServerVersion}}' >/dev/null

wait_for_service() {
  if ! docker compose up -d --no-build --wait --wait-timeout 60; then
    docker compose logs --tail 60 chessbrics >&2
    return 1
  fi
  docker compose port chessbrics 3000
}

case "$action" in
  deploy|update)
    docker compose build
    wait_for_service ;;
  start) wait_for_service ;;
  stop) docker compose stop ;;
  restart) docker compose restart && wait_for_service ;;
  status) docker compose ps ;;
  logs) docker compose logs --tail 100 chessbrics ;;
esac