#!/bin/bash
# Kill all dev processes (server + client)
echo "Killing all dev processes..."
pkill -9 -f "pnpm dev" 2>/dev/null
pkill -9 -f "tsx watch" 2>/dev/null
pkill -9 -f "vite dev" 2>/dev/null
sleep 1
REMAINING=$(pgrep -f "pnpm dev" 2>/dev/null | wc -l | tr -d ' ')
if [ "$REMAINING" -gt 0 ]; then
  echo "WARNING: $REMAINING still alive, retrying..."
  pkill -9 -f "pnpm dev" 2>/dev/null
  pkill -9 -f "tsx watch" 2>/dev/null
  pkill -9 -f "vite dev" 2>/dev/null
  sleep 1
fi
echo "Done. Ports 3001 and 5173 free."
