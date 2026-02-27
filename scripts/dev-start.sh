#!/bin/bash
# Start server and client dev servers
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG_DIR="/tmp/coh-dev-logs"
mkdir -p "$LOG_DIR"

# Wait for ports to be free before starting
for PORT in 3001 5173; do
  for i in 1 2 3 4 5; do
    lsof -ti :$PORT >/dev/null 2>&1 || break
    echo "Waiting for port $PORT to free..."
    sleep 1
  done
  # Force kill if still occupied
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "Force killing PIDs on port $PORT: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null
    sleep 1
  fi
done

echo "Starting server..."
cd "$DIR/server" && pnpm dev > "$LOG_DIR/server.log" 2>&1 &
sleep 5

echo "Starting client..."
cd "$DIR/client" && pnpm dev > "$LOG_DIR/client.log" 2>&1 &
sleep 10

S=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001)
C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173)
echo "server:$S client:$C"
echo "Logs: $LOG_DIR/server.log, $LOG_DIR/client.log"
