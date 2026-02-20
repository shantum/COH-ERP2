#!/bin/bash
# COH-ERP Health Monitor — runs via cron every 60s
# Checks: PM2 process status, HTTP health, restarts
# Sends Slack alert on state changes (no spam)

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ALERT="$SCRIPT_DIR/slack-alert.sh"
STATE_FILE="/tmp/coh-erp-monitor-state"
APP_NAME="coh-erp"
HEALTH_URL="http://127.0.0.1:3001/api/health"

# Read previous state
PREV_STATE="ok"
PREV_RESTARTS=0
if [ -f "$STATE_FILE" ]; then
  PREV_STATE=$(sed -n '1p' "$STATE_FILE")
  PREV_RESTARTS=$(sed -n '2p' "$STATE_FILE")
fi

# Check PM2 process
PM2_JSON=$(pm2 jlist 2>/dev/null)
if [ -z "$PM2_JSON" ]; then
  if [ "$PREV_STATE" != "pm2_down" ]; then
    bash "$ALERT" error "PM2 Not Running" "PM2 daemon is not running. The app is completely down."
    echo "pm2_down" > "$STATE_FILE"
    echo "0" >> "$STATE_FILE"
  fi
  exit 1
fi

STATUS=$(echo "$PM2_JSON" | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.status" 2>/dev/null)
RESTARTS=$(echo "$PM2_JSON" | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.unstable_restarts" 2>/dev/null)
UPTIME=$(echo "$PM2_JSON" | jq -r ".[] | select(.name==\"$APP_NAME\") | .pm2_env.pm_uptime" 2>/dev/null)

# No process found
if [ -z "$STATUS" ]; then
  if [ "$PREV_STATE" != "not_found" ]; then
    bash "$ALERT" error "App Not Found" "Process \`$APP_NAME\` not found in PM2. Was it deleted?"
    echo "not_found" > "$STATE_FILE"
    echo "0" >> "$STATE_FILE"
  fi
  exit 1
fi

# Process crashed / stopped / errored
if [ "$STATUS" != "online" ]; then
  if [ "$PREV_STATE" != "crashed" ]; then
    bash "$ALERT" error "App Crashed" "Process \`$APP_NAME\` status: \`$STATUS\`\nRestart count: $RESTARTS"
    echo "crashed" > "$STATE_FILE"
    echo "$RESTARTS" >> "$STATE_FILE"
  fi
  exit 1
fi

# Process is online but had new restarts (crash loop)
if [ -n "$RESTARTS" ] && [ "$RESTARTS" -gt "$PREV_RESTARTS" ] 2>/dev/null; then
  NEW_CRASHES=$((RESTARTS - PREV_RESTARTS))
  bash "$ALERT" warning "App Restarted" "Process \`$APP_NAME\` had *$NEW_CRASHES new restart(s)* (total: $RESTARTS).\nIt recovered but may be unstable."
fi

# HTTP health check
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" --max-time 5 "$HEALTH_URL" 2>/dev/null)
if [ "$HTTP_STATUS" != "200" ]; then
  if [ "$PREV_STATE" != "unhealthy" ]; then
    bash "$ALERT" warning "Health Check Failed" "GET \`$HEALTH_URL\` returned \`$HTTP_STATUS\`.\nPM2 says online but app may not be serving requests."
    echo "unhealthy" > "$STATE_FILE"
    echo "$RESTARTS" >> "$STATE_FILE"
  fi
  exit 0
fi

# Everything OK — clear previous alert state
if [ "$PREV_STATE" != "ok" ]; then
  bash "$ALERT" success "App Recovered" "Process \`$APP_NAME\` is back online and healthy."
fi

echo "ok" > "$STATE_FILE"
echo "${RESTARTS:-0}" >> "$STATE_FILE"
