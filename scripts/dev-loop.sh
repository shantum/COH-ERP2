#!/bin/bash
# Crash watchdog: starts server + client once, auto-restarts only on crash
# No periodic restarts — tsx watch and vite dev handle hot-reload themselves
# Usage: bash scripts/dev-loop.sh
DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT="$(cd "$DIR/.." && pwd)"
CHECK_INTERVAL=10

trap 'echo "$(date) — Shutting down..."; kill $SERVER_WATCHER_PID $CLIENT_WATCHER_PID 2>/dev/null; bash "$DIR/dev-kill.sh"; exit 0' EXIT INT TERM

# --- Auto-restart wrapper: restarts a process whenever it exits ---
watch_process() {
  local NAME="$1"
  local WORK_DIR="$2"
  shift 2

  while true; do
    echo "$(date) — Starting $NAME..."
    cd "$WORK_DIR" && "$@" > /dev/null 2>&1
    EXIT_CODE=$?
    echo "$(date) — $NAME exited ($EXIT_CODE), restarting in 3s..."
    sleep 3
  done
}

# Clean slate
bash "$DIR/dev-kill.sh"

# Start server and client in self-healing wrappers
watch_process "server" "$PROJECT/server" pnpm dev &
SERVER_WATCHER_PID=$!

sleep 5

watch_process "client" "$PROJECT/client" pnpm dev &
CLIENT_WATCHER_PID=$!

sleep 10

# Initial health check
S=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:3001 2>/dev/null)
C=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 http://localhost:5173 2>/dev/null)
echo "$(date) — Running. server:$S client:$C (watching for crashes every ${CHECK_INTERVAL}s)"

# Periodic health log (no action, just visibility)
while true; do
  sleep "$CHECK_INTERVAL"
  # Keep the script alive — the watch_process functions handle restarts
  wait -n 2>/dev/null || true
done
