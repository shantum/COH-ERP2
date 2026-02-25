#!/bin/bash
# Auto-restart server + client every 5 minutes
# Usage: bash scripts/dev-loop.sh [interval_seconds]
INTERVAL=${1:-300}
DIR="$(cd "$(dirname "$0")" && pwd)"

trap 'echo "$(date) — Stopping loop..."; bash "$DIR/dev-kill.sh"; exit 0' EXIT INT TERM

# Initial start
bash "$DIR/dev-kill.sh"
bash "$DIR/dev-start.sh"

while true; do
  sleep "$INTERVAL"
  echo ""
  echo "$(date) — Restarting (every ${INTERVAL}s)..."
  bash "$DIR/dev-restart.sh"
done
