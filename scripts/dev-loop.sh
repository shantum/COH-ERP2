#!/bin/bash
# Health-check loop: only restarts what's actually down
# Usage: bash scripts/dev-loop.sh [check_interval_seconds]
INTERVAL=${1:-60}
DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$DIR/.." && pwd)"

trap 'echo "$(date) — Stopping loop..."; bash "$DIR/dev-kill.sh"; exit 0' EXIT INT TERM

# Initial start
bash "$DIR/dev-kill.sh"
bash "$DIR/dev-start.sh"

echo "$(date) — Watching health every ${INTERVAL}s (only restarts if down)"

while true; do
  sleep "$INTERVAL"

  S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3001 2>/dev/null)
  C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5173 2>/dev/null)

  if [ "$S" = "000" ] || [ "$S" = "" ]; then
    echo "$(date) — Server down (got $S), restarting..."
    pkill -f "COH-ERP2.*tsx.*watch" 2>/dev/null || true
    sleep 1
    cd "$PROJECT/server" && pnpm dev > /dev/null 2>&1 &
    sleep 5
    S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3001 2>/dev/null)
    echo "$(date) — Server restarted: $S"
  fi

  if [ "$C" = "000" ] || [ "$C" = "" ]; then
    echo "$(date) — Client down (got $C), restarting..."
    pkill -f "COH-ERP2.*vite.*dev" 2>/dev/null || true
    pkill -f "COH-ERP2.*esbuild.*--service" 2>/dev/null || true
    sleep 1
    cd "$PROJECT/client" && pnpm dev > /dev/null 2>&1 &
    sleep 10
    C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5173 2>/dev/null)
    echo "$(date) — Client restarted: $C"
  fi
done
