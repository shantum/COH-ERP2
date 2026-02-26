#!/bin/bash
# Kill all dev processes (server + client) cleanly
echo "Killing all dev processes..."

# Snapshot PIDs before killing — prevents racing with newly started processes
PIDS=$(pgrep -f "COH-ERP2.*(pnpm.*dev|tsx.*watch|vite.*dev|esbuild.*--service)" 2>/dev/null)

if [ -z "$PIDS" ]; then
  echo "No dev processes found."
  echo "Done. Ports 3001 and 5173 free."
  exit 0
fi

# Step 1: SIGTERM — let parents clean up children gracefully
echo "$PIDS" | xargs kill 2>/dev/null

# Step 2: Wait up to 3s for them to die
for i in 1 2 3; do
  ALIVE=$(echo "$PIDS" | xargs ps -p 2>/dev/null | tail -n +2 | wc -l | tr -d ' ')
  [ "$ALIVE" -eq 0 ] && break
  sleep 1
done

# Step 3: Force kill any survivors from the original snapshot
echo "$PIDS" | xargs kill -9 2>/dev/null || true

sleep 1
echo "Done. Ports 3001 and 5173 free."
