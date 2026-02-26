#!/bin/bash
# Kill all dev processes (server + client) cleanly
echo "Killing all dev processes..."

# Step 1: SIGTERM first — let parents clean up their children
pkill -f "pnpm.*dev" 2>/dev/null
pkill -f "tsx.*watch" 2>/dev/null
pkill -f "vite.*dev" 2>/dev/null
sleep 2

# Step 2: Kill anything still on the ports
for PORT in 3001 5173; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  if [ -n "$PIDS" ]; then
    echo "Killing PIDs on port $PORT: $PIDS"
    echo "$PIDS" | xargs kill -9 2>/dev/null
  fi
done

# Step 3: Mop up any remaining orphan esbuild processes from this project
pkill -9 -f "COH-ERP2.*esbuild.*--service" 2>/dev/null

sleep 1
echo "Done. Ports 3001 and 5173 free."
