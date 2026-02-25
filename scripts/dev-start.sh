#!/bin/bash
# Start server and client dev servers
DIR="$(cd "$(dirname "$0")/.." && pwd)"

echo "Starting server..."
cd "$DIR/server" && pnpm dev > /dev/null 2>&1 &
sleep 5

echo "Starting client..."
cd "$DIR/client" && pnpm dev > /dev/null 2>&1 &
sleep 10

S=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3001)
C=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:5173)
echo "server:$S client:$C"
