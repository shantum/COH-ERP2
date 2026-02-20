#!/bin/bash
# Auto-rebuild watcher for Mutagen sync
# Watches for file changes and triggers appropriate rebuilds

cd /app/COH-ERP2
set -a && source server/.env && set +a

DEBOUNCE_SERVER=2
DEBOUNCE_CLIENT=5
DEBOUNCE_PRISMA=3

last_server=0
last_client=0
last_prisma=0

log() {
  echo "[$(date '+%H:%M:%S')] $1"
}

rebuild_client() {
  local now=$(date +%s)
  if (( now - last_client < DEBOUNCE_CLIENT )); then return; fi
  last_client=$now
  log "CLIENT: rebuilding..."
  cd /app/COH-ERP2/client && pnpm build 2>&1 | tail -5
  log "CLIENT: done"
}

restart_server() {
  local now=$(date +%s)
  if (( now - last_server < DEBOUNCE_SERVER )); then return; fi
  last_server=$now
  log "SERVER: restarting..."
  pm2 restart coh-erp --silent
  log "SERVER: restarted"
}

prisma_generate() {
  local now=$(date +%s)
  if (( now - last_prisma < DEBOUNCE_PRISMA )); then return; fi
  last_prisma=$now
  log "PRISMA: generating..."
  cd /app/COH-ERP2 && npx prisma generate 2>&1 | tail -3
  log "PRISMA: done"
}

log "Watching for changes..."

inotifywait -m -r \
  -e modify,create,delete,moved_to \
  --exclude '(node_modules|\.git|dist|\.output|\.vinxi)' \
  server/src client/src shared/src prisma |
while read dir event file; do
  # Only react to code files
  [[ "$file" =~ \.(ts|tsx|js|jsx|css|prisma)$ ]] || continue

  path="${dir}${file}"

  if [[ "$path" == prisma/* ]]; then
    prisma_generate &
  elif [[ "$path" == server/* ]]; then
    restart_server &
  elif [[ "$path" == client/* ]] || [[ "$path" == shared/* ]]; then
    rebuild_client &
  fi
done
