#!/bin/bash
# Kill all dev processes (server + client) cleanly
echo "Killing all dev processes..."

# Step 1: Kill by port — the only reliable method
for PORT in 3001 5173 5174 5175 5176; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill 2>/dev/null
done

# Step 2: Kill all COH-ERP2 node process trees (pnpm, tsx, vite, esbuild)
pkill -f "COH-ERP2.*(pnpm|tsx|vite|esbuild)" 2>/dev/null

sleep 2

# Step 3: Force kill anything still on ports
for PORT in 3001 5173 5174 5175 5176; do
  PIDS=$(lsof -ti :$PORT 2>/dev/null)
  [ -n "$PIDS" ] && echo "$PIDS" | xargs kill -9 2>/dev/null
done

sleep 1
echo "Done. Ports 3001 and 5173 free."
