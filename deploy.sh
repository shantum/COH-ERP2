#!/bin/bash
# Zero-downtime deploy to Hetzner
# - Builds while old app keeps running
# - PM2 reload (not delete) for seamless switchover
# - Health check after reload
# - Auto-rollback if health check fails
set -e

git push origin main
COMMIT=$(git log -1 --oneline)
echo "🚀 Deploying to Hetzner..."

ssh root@128.140.98.253 bash -s "$COMMIT" << 'REMOTE'
set -e
COMMIT="$1"
APP=/app/COH-ERP2
PORT=3001
HEALTH_URL="http://127.0.0.1:${PORT}/api/health"
BACKUP_DIR="/app/deploy-backup"

cd "$APP"
set -a && source server/.env && set +a

# ── 1. Backup current working build ──
echo "📦 Backing up current build..."
rm -rf "$BACKUP_DIR"
mkdir -p "$BACKUP_DIR"
# Back up the client build and node_modules state
if [ -d client/dist ]; then
  cp -r client/dist "$BACKUP_DIR/client-dist"
fi
# Save current commit for rollback reference
git rev-parse HEAD > "$BACKUP_DIR/commit-sha"

# ── 2. Pull & build (old app keeps running) ──
echo "⬇️  Pulling latest code..."
git pull origin main

echo "📦 Installing dependencies..."
pnpm install --frozen-lockfile

echo "🗄️  Running Prisma generate + migrate..."
npx prisma generate
npx prisma migrate deploy --schema=prisma/schema.prisma

echo "🔨 Building client..."
cd client && pnpm build && cd ..

# Write version file for health endpoint
echo "$COMMIT" > VERSION

# ── 3. Reload (zero-downtime) ──
echo "🔄 Reloading app (zero-downtime)..."
if pm2 describe coh-erp > /dev/null 2>&1; then
  pm2 reload ecosystem.config.cjs
else
  pm2 start ecosystem.config.cjs
fi

# ── 4. Health check ──
echo "🏥 Health check..."
HEALTHY=false
for i in $(seq 1 15); do
  sleep 2
  STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
  if [ "$STATUS" = "200" ]; then
    HEALTHY=true
    echo "✅ Health check passed (attempt $i)"
    break
  fi
  echo "   Attempt $i/15 — status $STATUS, retrying..."
done

if [ "$HEALTHY" = true ]; then
  pm2 save
  bash scripts/slack-alert.sh success 'Deploy Successful' "Deployed: \`$COMMIT\`"
  echo "✅ Deployed: $COMMIT"
else
  # ── 5. Rollback ──
  echo "❌ Health check failed! Rolling back..."

  if [ -d "$BACKUP_DIR/client-dist" ]; then
    rm -rf client/dist
    cp -r "$BACKUP_DIR/client-dist" client/dist

    OLD_SHA=$(cat "$BACKUP_DIR/commit-sha" 2>/dev/null || echo "unknown")
    echo "⏪ Restored build from $OLD_SHA, reloading..."
    pm2 reload ecosystem.config.cjs

    # Verify rollback worked
    sleep 5
    ROLLBACK_STATUS=$(curl -s -o /dev/null -w "%{http_code}" "$HEALTH_URL" 2>/dev/null || echo "000")
    if [ "$ROLLBACK_STATUS" = "200" ]; then
      echo "✅ Rollback successful — old version is serving"
      bash scripts/slack-alert.sh warning 'Deploy Rolled Back' "Failed: \`$COMMIT\`\nRolled back to \`$OLD_SHA\`"
    else
      echo "🚨 Rollback also failed! Manual intervention needed."
      bash scripts/slack-alert.sh error 'Deploy CRITICAL' "Deploy AND rollback failed for \`$COMMIT\`\nManual intervention required!"
    fi
  else
    echo "🚨 No backup available! Attempting restart..."
    pm2 reload ecosystem.config.cjs
    bash scripts/slack-alert.sh error 'Deploy Failed' "Failed: \`$COMMIT\`\nNo backup to rollback to."
  fi

  exit 1
fi
REMOTE
